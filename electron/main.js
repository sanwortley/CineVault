const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable, PassThrough } = require('stream');
const { pathToFileURL } = require('url');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const isDev = process.env.NODE_ENV === 'development';

// if (process.platform === 'win32') {
//     app.disableHardwareAcceleration();
// }

// Register cine protocol as privileged
protocol.registerSchemesAsPrivileged([
    { scheme: 'cine', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true } }
]);

// Allow autoplay with sound
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Function to calculate exact duration from ffprobe output
function parseDuration(timeString) {
    if (!timeString || timeString === 'N/A') return 0;
    const match = timeString.match(/(\d{2}):(\d{2}):(\d{2}\.\d+)/);
    if (match) {
        const hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const seconds = parseFloat(match[3]);
        return hours * 3600 + minutes * 60 + seconds;
    }
    return parseFloat(timeString) || 0;
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        backgroundColor: '#0f172a',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    if (isDev) {
        win.loadURL('http://localhost:5173');
        // win.webContents.openDevTools();
    } else {
        win.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}

app.whenReady().then(async () => {
    // 1. Initialise backend and IPC handlers ASAP
    loadBackend();
    
    // 2. Start streaming proxy on 19998 to avoid OAuth conflict on 19999
    const driveProxy = require('../backend/driveProxy');
    driveProxy.start(19998).catch(err => console.error('[Main] Failed to start Drive Proxy:', err));

    // 3. Register cine protocol
    protocol.handle('cine', async (request) => {
        try {
            const url = new URL(request.url);
            
            // ROBUST PATH RESOLUTION
            let filePath = decodeURIComponent(url.pathname);
            if (url.host && url.host.length === 1) {
                // Handle cine://c/path -> c:/path
                filePath = url.host + ':' + filePath;
            } else if (url.host) {
                // Handle cine://hostname/path
                filePath = url.host + filePath;
            }

            // Cleanup slashes
            filePath = filePath.replace(/\\/g, '/').replace(/\/+/g, '/');
            // If it starts with /C:/, remove the leading slash
            if (filePath.startsWith('/') && /^\/[a-zA-Z]:/.test(filePath)) {
                filePath = filePath.substring(1);
            }

            const shouldTranscode = url.searchParams.get('transcode') === 'true';
            const startTime = parseFloat(url.searchParams.get('t') || 0);

            if (!fs.existsSync(filePath)) {
                console.error(`[Protocol] File NOT Found: ${filePath}`);
                return new Response(null, { status: 404 });
            }

            if (shouldTranscode) {
                const passThrough = new PassThrough();
                let command = ffmpeg(filePath);
                if (startTime > 0) command = command.seekInput(startTime);

                command
                    .videoCodec('copy')
                    .audioCodec('aac')
                    .audioChannels(2)
                    .audioFrequency(44100)
                    .format('matroska')
                    .inputOptions([
                        '-fflags +fastseek'
                    ])
                    .outputOptions([
                        '-map 0:v?', '-map 0:a?', '-map 0:s?', // map all streams
                        '-c:s copy', // copy subtitles
                        '-preset ultrafast',
                        '-tune zerolatency',
                        '-max_muxing_queue_size 1024',
                        '-x264-params keyint=30:min-keyint=30:scenecut=0', // Force keyframes every 30 frames
                        '-force_key_frames expr:gte(t,n_forced*1)', // Force keyframe every second
                        '-movflags +faststart',
                        '-flush_packets 1'
                    ])
                    .on('error', (err) => {
                        console.error('[Main] FFmpeg Stream Error:', err.message);
                        passThrough.end();
                    })
                    .pipe(passThrough);

                return new Response(Readable.toWeb(passThrough), {
                    status: 200,
                    headers: { 'Content-Type': 'video/x-matroska', 'Cache-Control': 'no-cache', 'Accept-Ranges': 'none' }
                });
            }

            const stats = fs.statSync(filePath);
            const fileSize = stats.size;
            const range = request.headers.get('range');

            const getMimeType = (file) => {
                const ext = path.extname(file).toLowerCase();
                const map = { '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm' };
                return map[ext] || 'video/mp4';
            };

            if (range) {
                const parts = range.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                const chunksize = (end - start) + 1;
                const fileStream = fs.createReadStream(filePath, { start, end });
                return new Response(Readable.toWeb(fileStream), {
                    status: 206,
                    headers: {
                        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                        'Accept-Ranges': 'bytes',
                        'Content-Length': chunksize.toString(),
                        'Content-Type': getMimeType(filePath)
                    }
                });
            } else {
                const fileStream = fs.createReadStream(filePath);
                return new Response(Readable.toWeb(fileStream), {
                    status: 200,
                    headers: {
                        'Content-Length': fileSize.toString(),
                        'Content-Type': getMimeType(filePath),
                        'Accept-Ranges': 'bytes'
                    }
                });
            }
        } catch (error) {
            console.error('[Main] Protocol Fatal Error:', error);
            return new Response(null, { status: 500 });
        }
    });

    // 4. Create Window
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    try {
        const driveProxy = require('../backend/driveProxy');
        driveProxy.stop();
    } catch (e) {}
    if (process.platform !== 'darwin') app.quit();
});

let backendLoaded = false;
let db, driveApi, scanDirectory, normalizeFilename, searchMovie, getMovieDetails, generateSpoilerFreeSummary, findDuplicate;

function loadBackend() {
    if (backendLoaded) return;
    backendLoaded = true;
    console.log('[Main] Loading backend modules securely...');
    
    db = require('../backend/db');
    driveApi = require('../backend/drive');
    const scannerObj = require('../backend/scanner');
    scanDirectory = scannerObj.scanDirectory;
    
    const parserObj = require('../backend/parser');
    normalizeFilename = parserObj.normalizeFilename;
    
    const tmdbObj = require('../backend/tmdb');
    searchMovie = tmdbObj.searchMovie;
    getMovieDetails = tmdbObj.getMovieDetails;
    
    const summaryObj = require('../backend/summary');
    generateSpoilerFreeSummary = summaryObj.generateSpoilerFreeSummary;
    
    const duplicateObj = require('../backend/duplicateDetector');
    findDuplicate = duplicateObj.findDuplicate;

    // --- Register IPC Handlers that depend on backend modules here ---
    
    ipcMain.handle('config:getTMDBKey', () => {
        return process.env.TMDB_API_KEY || '';
    });

    ipcMain.handle('file:exists', async (event, filePath) => {
        if (!filePath) return false;
        return fs.existsSync(filePath);
    });

    ipcMain.handle('dialog:openDirectory', async () => {
        console.log('[Main] IPC: dialog:openDirectory called');
        try {
            const win = BrowserWindow.getFocusedWindow();
            const { canceled, filePaths } = await dialog.showOpenDialog(win, {
                title: 'Seleccionar carpetas de películas',
                properties: ['openDirectory', 'multiSelections']
            });

            console.log('[Main] Dialog result:', { canceled, filePaths });
            if (canceled) return [];

            console.log('[Main] Saving folders to database...');
            for (const dirPath of filePaths) {
                await db.addFolder(dirPath);
            }
            console.log('[Main] Folders saved successfully');

            return filePaths;
        } catch (error) {
            console.error('[Main] Error opening directory:', error);
            return [];
        }
    });

    ipcMain.handle('library:getFolders', async () => {
    return (await db.getFolders()) || [];
});

ipcMain.handle('library:removeFolder', async (event, folderPath) => {
    // Normalize path to ensure consistency (especially for Windows)
    const normalizedPath = path.normalize(folderPath);
    console.log('[Main] Removing folder and associated movies:', normalizedPath);

    // 1. Delete associated movies first
    // We use LIKE 'path\%' to match all files inside that folder
    // Note: path.join appends the platform separator
    const matchPath = normalizedPath.endsWith(path.sep) ? normalizedPath : normalizedPath + path.sep;
    await db.removeMoviesLike(`${matchPath}%`);

    // 2. Delete the folder entry
    await db.removeFolder(folderPath);
    return { success: true };
});

ipcMain.handle('library:refresh', async () => {
    console.log('[Main] Starting library refresh...');
    const folders = (await db.getFolders()) || [];
    console.log(`[Main] Scanned folders from DB: ${folders.length}`);
    let allFiles = [];

    for (const { folder_path } of folders) {
        console.log(`[Main] Scanning folder: ${folder_path}`);
        const files = await scanDirectory(folder_path);
        console.log(`[Main] Found ${files.length} files in ${folder_path}`);
        allFiles = allFiles.concat(files);
    }

    console.log(`[Main] Total video files found: ${allFiles.length}`);

    // --- CLEANUP PHASE ---
    const existingMovies = (await db.getMovies()) || [];
    console.log(`[Main] Checking ${existingMovies.length} existing movies for ghosts...`);
    for (const movie of existingMovies) {
        const localExists = movie.file_path && fs.existsSync(movie.file_path);
        const onDrive = !!movie.drive_file_id;

        if (!localExists && !onDrive) {
            console.log(`[Main] Pruning ghost movie: ${movie.official_title || movie.file_name}`);
            await db.deleteMovie(movie.id);
        }
    }

    // --- ADDITION PHASE ---
    let addedCount = 0;
    let skippedCount = 0;

    for (const file of allFiles) {
        const { clean_title, year } = normalizeFilename(file.file_name);
        const existing = await findDuplicate(file.file_path, file.file_name, file.file_size, null, year);
        
        if (existing) {
            skippedCount++;
            continue;
        }

        console.log(`[Main] Adding new movie: ${clean_title} (${year})`);

        // 3. Metadata Lookup
        let movieData = await searchMovie(clean_title, year);
        let details = {};
        let status = 'not_found';

        if (movieData) {
            details = await getMovieDetails(movieData.id);
            status = 'identified';
        }

        // 4. Summary
        const summary = generateSpoilerFreeSummary(details.overview);

        // 5. Save to DB
        await db.addMovie({
            file_name: file.file_name,
            file_path: file.file_path,
            file_size: file.file_size,
            extension: file.extension,
            detected_title: clean_title,
            detected_year: year,
            official_title: details.official_title || null,
            overview: details.overview || null,
            spoiler_free_summary: summary,
            poster_url: details.poster_url || null,
            backdrop_url: details.backdrop_url || null,
            genres: details.genres || null,
            runtime: details.runtime || null,
            director: details.director || null,
            cast: details.cast || null,
            rating: details.rating || null,
            release_date: details.release_date || null,
            identified_status: status
        });
        addedCount++;
    }

    console.log(`[Main] Refresh finished. Added: ${addedCount}, Skipped: ${skippedCount}`);
    return (await db.getMovies()) || [];
});

ipcMain.handle('library:clear', async () => {
    console.log('[Main] Clearing entire library...');
    await db.clearMovies();
    await db.clearFolders();
    return { success: true };
});

ipcMain.handle('library:getMovies', async () => {
    return (await db.getMovies()) || [];
});

ipcMain.handle('library:updateProgress', async (event, movieId, duration) => {
    console.log(`[Main] Updating progress for movie ${movieId}: ${duration}s`);
    return await db.updateMovieProgress(movieId, duration);
});

ipcMain.handle('player:play', async (event, filePath) => {
    console.log('[Main] Playing video:', filePath);
    try {
        await shell.openPath(filePath);
        return { success: true };
    } catch (error) {
        console.error('[Main] Play error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('player:openExternal', async (event, filePath) => {
    console.log('[Main] Opening external:', filePath);
    try {
        await shell.openPath(filePath);
        return { success: true };
    } catch (error) {
        console.error('[Main] Open external error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('player:checkAudio', async (event, filePathRaw) => {
    let filePath = filePathRaw;
    if (!filePath) return { error: 'No path provided' };

    // Robust path resolution for local files
    if (!filePath.startsWith('http')) {
        // Remove leading slashes/backslashes
        filePath = filePath.replace(/^[\\\/]+/, '');
        
        // Handle c/path or c:\path
        if (/^[a-zA-Z][\/\\:]/.test(filePath)) {
            const drive = filePath[0];
            const rest = filePath.substring(2).replace(/^[\\\/]+/, '');
            filePath = drive + ':/' + rest;
        }
        filePath = filePath.replace(/\\/g, '/');
    }

    console.log(`[Player:AudioCheck] Resolved: ${filePath}`);

    return new Promise((resolve) => {
        // Lowered to 1MB - stable sweet spot for speed/reliability
        ffmpeg(filePath)
            .inputOptions([
                '-probesize 1000000',
                '-analyzeduration 1000000'
            ])
            .ffprobe((err, metadata) => {
                if (err) {
                    console.error('[Main] ffprobe error:', err);
                    return resolve({ 
                        codec: 'unknown', 
                        needsTranscode: false, // Fallback to native if probe fails? 
                        error: err.message 
                    });
                }

            const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
            const codec = audioStream ? audioStream.codec_name.toLowerCase() : 'none';
            const durationRaw = metadata.format.duration;
            const duration = parseDuration(durationRaw ? durationRaw.toString() : '0');

            // Chrome/Electron natively supports AAC, MP3, Vorbis, Opus. 
            // AC3, EAC3, and DTS usually fail.
            const unsupportedCodecs = [
                'ac3', 'eac3', 'ec-3', 'dts', 'dca', 'dtshd', 'truehd', 
                'mlp', 'flac', 'pcm_s16le', 'pcm_s24le', 'mp2'
            ];
            const needsTranscode = unsupportedCodecs.includes(codec) || (audioStream && audioStream.channels > 6);

            resolve({
                codec,
                needsTranscode,
                duration,
                channels: audioStream ? audioStream.channels : 0
            });
        });
    });
});

// --- GOOGLE DRIVE IPC ---
ipcMain.handle('drive:checkAuth', () => {
    return driveApi.isAuthenticated();
});

ipcMain.handle('drive:authenticate', async () => {
    try {
        return await driveApi.authenticate();
    } catch (error) {
        console.error('[Main] Drive Auth Error:', error);
        throw error;
    }
});

ipcMain.handle('drive:uploadMovie', async (event, movieId, filePath, mimeType) => {
    try {
        console.log(`[Main] Uploading to Drive (ID: ${movieId}):`, filePath);
        
        // Ensure authenticated
        if (!driveApi.isAuthenticated()) {
            throw new Error('Not authenticated with Google Drive. Go to settings.');
        }

        // Send progress updates back to the specific renderer window
        const onProgress = (progress, bytesSent, totalBytes) => {
            event.sender.send(`drive:uploadProgress-${movieId}`, { progress, bytesSent, totalBytes });
        };

        const driveData = await driveApi.uploadVideo(filePath, mimeType, onProgress);
        console.log(`[Main] Uploaded successfully! Drive File ID:`, driveData.id);

        // Update Supabase Database
        await db.setDriveFileId(movieId, driveData.id);

        return { success: true, driveFileId: driveData.id };
    } catch (error) {
        console.error('[Main] Drive Upload Error:', error);
        return { success: false, error: error.message };
    }
});

} // End of loadBackend function

