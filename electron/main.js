const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } = require('electron');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fs = require('fs');
const os = require('os');
const { Readable, PassThrough } = require('stream');
const { pathToFileURL } = require('url');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const isDev = process.env.NODE_ENV === 'development';

// Register protocols
protocol.registerSchemesAsPrivileged([
    { scheme: 'cine', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true } },
    { scheme: 'sub', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true } }
]);

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

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
    } else {
        win.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}

app.whenReady().then(async () => {
    loadBackend();
    
    const driveProxy = require('../backend/driveProxy');
    driveProxy.start(19998).catch(err => console.error('[Main] Failed to start Drive Proxy:', err));

    // CINE Protocol (Streaming)
    protocol.handle('cine', async (request) => {
        try {
            const url = new URL(request.url);
            let filePath = decodeURIComponent(url.pathname);
            if (url.host && url.host.length === 1) {
                filePath = url.host + ':' + filePath;
            } else if (url.host) {
                filePath = url.host + filePath;
            }
            filePath = filePath.replace(/\\/g, '/').replace(/\/+/g, '/');
            if (filePath.startsWith('/') && /^\/[a-zA-Z]:/.test(filePath)) {
                filePath = filePath.substring(1);
            }

            const shouldTranscode = url.searchParams.get('transcode') === 'true';
            const startTime = parseFloat(url.searchParams.get('t') || 0);

            if (!fs.existsSync(filePath)) return new Response(null, { status: 404 });

            if (shouldTranscode) {
                const passThrough = new PassThrough();
                ffmpeg(filePath)
                    .seekInput(startTime)
                    .videoCodec('copy')
                    .audioCodec('aac')
                    .audioChannels(2)
                    .format('matroska')
                    .outputOptions(['-preset ultrafast', '-tune zerolatency'])
                    .on('error', (err) => {
                        console.error('[CineProtocol] FFmpeg Error:', err.message);
                        passThrough.end();
                    })
                    .on('end', () => passThrough.end())
                    .pipe(passThrough);

                return new Response(Readable.toWeb(passThrough), {
                    status: 200,
                    headers: { 'Content-Type': 'video/x-matroska', 'Cache-Control': 'no-cache' }
                });
            }

            const stats = fs.statSync(filePath);
            const fileSize = stats.size;
            const range = request.headers.get('range');
            const mimeType = path.extname(filePath).toLowerCase() === '.mkv' ? 'video/x-matroska' : 'video/mp4';

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
                        'Content-Type': mimeType
                    }
                });
            } else {
                const fileStream = fs.createReadStream(filePath);
                return new Response(Readable.toWeb(fileStream), {
                    status: 200,
                    headers: { 'Content-Length': fileSize.toString(), 'Content-Type': mimeType, 'Accept-Ranges': 'bytes' }
                });
            }
        } catch (error) {
            return new Response(null, { status: 500 });
        }
    });

    // SUB Protocol (Subtitle Extraction & Conversion)
    protocol.handle('sub', async (request) => {
        try {
            const url = new URL(request.url);
            const index = url.hostname; // 'external' or track index
            let filePath = decodeURIComponent(url.searchParams.get('path'));
            
            // Normalize path only if it's NOT a URL
            if (!filePath.startsWith('http')) {
                if (filePath.startsWith('/') && /^\/[a-zA-Z]:/.test(filePath)) filePath = filePath.substring(1);
                filePath = filePath.replace(/\\/g, '/');
                if (!fs.existsSync(filePath)) return new Response(null, { status: 404 });
            }

            console.log(`[SubProtocol] Extracting stream "${index}" from: ${filePath}`);

            const passThrough = new PassThrough();
            let command = ffmpeg(filePath);

            if (index === 'external') {
                // For external SRT/VTT, we ensure conversion to VTT
                command = command.toFormat('webvtt');
            } else {
                command = command.outputOptions([
                    `-map 0:${index}`, 
                    '-c:s webvtt', 
                    '-f webvtt'
                ]);
            }

            command
                .on('start', (cmdline) => console.log(`[SubProtocol] FFmpeg started: ${cmdline}`))
                .on('error', (err) => {
                    console.error('[SubProtocol] FFmpeg Error:', err.message);
                    if (!passThrough.destroyed) passThrough.end();
                })
                .on('end', () => {
                    console.log('[SubProtocol] FFmpeg finished');
                    passThrough.end();
                })
                .pipe(passThrough);

            return new Response(Readable.toWeb(passThrough), {
                status: 200,
                headers: { 
                    'Content-Type': 'text/vtt; charset=utf-8', 
                    'Cache-Control': 'no-cache',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': '*'
                }
            });
        } catch (e) {
            console.error('[SubProtocol] Fatal Error:', e);
            return new Response(null, { status: 500 });
        }
    });

    createWindow();
});

let db, driveApi, scanDirectory, normalizeFilename, searchMovie, getMovieDetails, generateSpoilerFreeSummary, findDuplicate;

function loadBackend() {
    db = require('../backend/db');
    driveApi = require('../backend/drive');
    const scannerModule = require('../backend/scanner');
    scanDirectory = scannerModule.scanDirectory;

    const parserModule = require('../backend/parser');
    normalizeFilename = parserModule.normalizeFilename;

    const tmdbModule = require('../backend/tmdb');
    searchMovie = tmdbModule.searchMovie;
    getMovieDetails = tmdbModule.getMovieDetails;

    const summaryModule = require('../backend/summary');
    generateSpoilerFreeSummary = summaryModule.generateSpoilerFreeSummary;

    const duplicateModule = require('../backend/duplicateDetector');
    findDuplicate = duplicateModule.findDuplicate;

    const broadcastLibraryUpdate = () => {
        BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('library:updated');
        });
    };

    ipcMain.handle('config:getTMDBKey', () => process.env.TMDB_API_KEY || '');
    ipcMain.handle('file:exists', async (event, filePath) => fs.existsSync(filePath));
    
    ipcMain.handle('dialog:openDirectory', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
            properties: ['openDirectory', 'multiSelections']
        });
        if (canceled) return [];
        for (const dirPath of filePaths) {
            const posixPath = dirPath.replace(/\\/g, '/');
            await db.addFolder(posixPath);
        }
        broadcastLibraryUpdate();
        return filePaths;
    });

    ipcMain.handle('library:refresh', async () => {
        const folders = await db.getFolders();
        for (const f of folders) {
            // Ensure runtime standardization
            const folder_path = f.folder_path.replace(/\\/g, '/');
            const files = await scanDirectory(folder_path);
            for (const file of files) {
                const { clean_title, year } = normalizeFilename(file.file_name);
                const existing = await findDuplicate(file.file_path, file.file_name, file.file_size, null, year);
                
                if (existing) {
                    // Enrich if missing crucial metadata
                    if (!existing.imdb_id || !existing.official_title) {
                        const movieData = await searchMovie(clean_title, year);
                        if (movieData) {
                            const details = await getMovieDetails(movieData.id);
                            await db.updateMovie(existing.id, {
                                official_title: details.official_title || existing.official_title,
                                overview: details.overview || existing.overview,
                                poster_url: details.poster_url || existing.poster_url,
                                backdrop_url: details.backdrop_url || existing.backdrop_url,
                                genres: details.genres || existing.genres,
                                imdb_id: details.imdb_id || existing.imdb_id,
                                cast: details.cast || existing.cast,
                                director: details.director || existing.director,
                                release_date: details.release_date || existing.release_date,
                                runtime: details.runtime || existing.runtime,
                                rating: details.rating || existing.rating,
                                identified_status: 'identified'
                            });
                        }
                    }
                    continue;
                }
                
                const movieData = await searchMovie(clean_title, year);
                const details = movieData ? await getMovieDetails(movieData.id) : {};
                const summary = generateSpoilerFreeSummary(details.overview);
                
                await db.addMovie({
                    file_name: file.file_name, file_path: file.file_path, file_size: file.file_size,
                    extension: file.extension, detected_title: clean_title, detected_year: year,
                    official_title: details.official_title || null, overview: details.overview || null,
                    spoiler_free_summary: summary, poster_url: details.poster_url || null,
                    backdrop_url: details.backdrop_url || null, genres: details.genres || null,
                    runtime: details.runtime || null, director: details.director || null,
                    cast: details.cast || null, rating: details.rating || null,
                    release_date: details.release_date || null, identified_status: movieData ? 'identified' : 'not_found',
                    imdb_id: details.imdb_id || null
                });
            }
        }

        // --- GHOST PRUNING (Sync Cleanup) ---
        console.log('[Library Refresh] Pruning dead cloud links and ghost movies...');
        const allMovies = await db.getMovies();
        for (const movie of allMovies) {
            const hasLocal = fs.existsSync(movie.file_path);
            let driveStatus = 'exists'; // Assume it exists if not on Drive
            
            if (movie.drive_file_id) {
                driveStatus = await driveApi.fileExists(movie.drive_file_id);
                // Update DB if it was deleted from Drive but still exists locally
                if (driveStatus === 'missing' && hasLocal) {
                    await db.updateMovie(movie.id, { drive_file_id: null });
                    console.log(`[Sync] Cloud file for "${movie.file_name}" was deleted from Drive. Local entry preserved.`);
                }
            }

            // If it's gone from BOTH local AND cloud (and we are sure it's missing, not an error)
            if (!hasLocal && driveStatus === 'missing') {
                console.log(`[Sync] Ghost movie found: "${movie.file_name}" (Missing local and cloud). Deleting...`);
                await db.deleteMovie(movie.id);
            }
        }

        broadcastLibraryUpdate();
        return await db.getMovies();
    });

    ipcMain.handle('library:getMovies', async () => await db.getMovies());
    ipcMain.handle('library:getFolders', async () => await db.getFolders());
    ipcMain.handle('library:removeFolder', async (event, folderPath) => {
        console.log(`[Main] Removing folder and cascading movies: ${folderPath}`);
        // Standardize to POSIX for database-side LIKE matching
        const posixPath = folderPath.replace(/\\/g, '/');
        const matchPath = posixPath.endsWith('/') ? posixPath : posixPath + '/';
        
        // Cascade: Delete ONLY local-only movies
        await db.removeMoviesLike(`${matchPath}%`, true);
        await db.removeFolder(posixPath);
        broadcastLibraryUpdate();
        return { success: true };
    });
    ipcMain.handle('library:clear', async () => {
        await db.clearMovies();
        await db.clearFolders();
        return { success: true };
    });
    ipcMain.handle('library:updateProgress', async (event, movieId, duration) => await db.updateMovieProgress(movieId, duration));

    ipcMain.handle('player:checkAudio', async (event, filePath) => {
        return new Promise((resolve) => {
            ffmpeg(filePath)
                .inputOptions(['-probesize 1000000', '-analyzeduration 1000000'])
                .ffprobe((err, metadata) => {
                    if (err) return resolve({ codec: 'unknown', needsTranscode: false, error: err.message });
                    const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
                    const subtitleStreams = metadata.streams.filter(s => s.codec_type === 'subtitle');
                    const codec = audioStream ? audioStream.codec_name.toLowerCase() : 'none';
                    const duration = parseDuration(metadata.format.duration?.toString());
                    
                    let externalSubs = [];
                    if (!filePath.startsWith('http')) {
                        try {
                            const dir = path.dirname(filePath);
                            const baseName = path.basename(filePath, path.extname(filePath));
                            const files = fs.readdirSync(dir);
                            externalSubs = files.filter(f => f.toLowerCase().endsWith('.srt') && f.toLowerCase().startsWith(baseName.toLowerCase())).map(f => ({
                                label: f.substring(baseName.length).replace(/^[._-]/, '').replace(/\.srt$/i, '') || 'Externa',
                                path: path.join(dir, f), type: 'external'
                            }));
                        } catch (e) {}
                    }

                    const unsupported = ['ac3', 'eac3', 'dts', 'truehd', 'mlp', 'flac'];
                    const imageSubCodecs = ['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvdsub', 'pgssub'];

                    resolve({
                        codec, duration,
                        needsTranscode: unsupported.includes(codec) || (audioStream?.channels > 6),
                        subtitles: [
                            ...subtitleStreams.map((s, idx) => {
                                const isImage = imageSubCodecs.includes(s.codec_name.toLowerCase());
                                return {
                                    index: s.index, 
                                    label: (s.tags?.language || `Pista ${idx + 1}`) + (isImage ? ' (Imagen - No compatible)' : ''), 
                                    format: s.codec_name, 
                                    type: 'internal',
                                    isIncompatible: isImage
                                };
                            }),
                            ...externalSubs
                        ]
                    });
                });
        });
    });

    ipcMain.handle('player:searchSubtitles', async (event, { imdbId, title }) => {
        try {
            const apiKey = process.env.OPENSUBTITLES_API_KEY || 't9vWVYW8jW0W0W0W0W0W0W0W0W0W0W0W';
            const query = imdbId ? `imdb_id=${imdbId.replace('tt', '')}` : `query=${encodeURIComponent(title)}`;
            const url = `https://api.opensubtitles.com/api/v1/subtitles?${query}&languages=es,en`;
            console.log(`[SubtitleSearch] API Request: ${url}`);
            
            const response = await fetch(url, {
                headers: { 
                    'Content-Type': 'application/json', 
                    'User-Agent': 'TemporaryUserAgent', 
                    'Api-Key': apiKey 
                }
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[SubtitleSearch] API Error ${response.status}: ${errorText}`);
                if (response.status === 403) {
                    return { error: 'auth_failed', message: 'API Key de OpenSubtitles no válida o bloqueada (403)' };
                }
                return { error: 'api_error', status: response.status };
            }
            
            const data = await response.json();
            console.log(`[SubtitleSearch] API Success. Found ${data.data?.length || 0} tracks`);
            
            const results = (data.data || [])
                .filter(sub => sub.attributes && sub.attributes.files && sub.attributes.files.length > 0)
                .map(sub => ({ 
                    id: sub.attributes.files[0].file_id, 
                    label: `☁️ ${sub.attributes.language.toUpperCase()} - ${sub.attributes.release}`, 
                    provider: 'OpenSubtitles', 
                    type: 'cloud' 
                }));
            
            return { data: results };
        } catch (e) { 
            console.error('[SubtitleSearch] Fatal Error:', e);
            return { error: 'fatal_error', message: e.message }; 
        }
    });

    ipcMain.handle('player:selectLocalSubtitle', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
            title: 'Seleccionar archivo de subtítulos',
            filters: [{ name: 'Subtítulos', extensions: ['srt', 'vtt'] }],
            properties: ['openFile']
        });
        if (canceled || filePaths.length === 0) return null;
        return {
            path: filePaths[0],
            label: path.basename(filePaths[0]),
            type: 'external'
        };
    });

    ipcMain.handle('player:downloadSubtitle', async (event, fileId) => {
        const logPath = path.join(os.tmpdir(), 'cinevault_sub_debug.log');
        const log = (msg) => {
            console.log(msg);
            fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
        };

        try {
            log(`[DownloadSubtitle] Starting download for fileId: ${fileId}`);
            const apiKey = process.env.OPENSUBTITLES_API_KEY || 'wJ2EkFEHerm9jJf9T3gUcQNg7VXQO8xN';
            
            const response = await fetch('https://api.opensubtitles.com/api/v1/download', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json', 
                    'Accept': 'application/json',
                    'User-Agent': 'CineVault v1.0', 
                    'Api-Key': apiKey 
                },
                body: JSON.stringify({ file_id: fileId })
            });

            if (!response.ok) {
                const errorText = await response.text();
                log(`[DownloadSubtitle] API Error ${response.status}: ${errorText}`);
                throw new Error(`Download request failed: ${response.status}`);
            }
            
            const data = await response.json();
            if (!data.link) {
                log(`[DownloadSubtitle] No download link received. Data: ${JSON.stringify(data)}`);
                throw new Error('No download link provided by API');
            }
            const downloadUrl = data.link;
            log(`[DownloadSubtitle] Got download link: ${downloadUrl}`);

            // Download to a temp file
            const tempDir = path.join(os.tmpdir(), 'cinevault_subs');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
            
            const tempPath = path.join(tempDir, `sub_${fileId}.srt`);
            log(`[DownloadSubtitle] Fetching content to ${tempPath}`);
            const subRes = await fetch(downloadUrl);
            const buffer = await subRes.arrayBuffer();
            fs.writeFileSync(tempPath, Buffer.from(buffer));
            
            log(`[DownloadSubtitle] Success! Local path: ${tempPath}`);
            return { localPath: tempPath };
        } catch (e) {
            log(`[DownloadSubtitle] Fatal Error: ${e.message}`);
            throw e;
        }
    });

    // --- Google Drive Handlers ---
    ipcMain.handle('drive:checkAuth', async () => {
        try {
            return driveApi.isAuthenticated();
        } catch (e) { return false; }
    });

    ipcMain.handle('drive:authenticate', async () => {
        try {
            return await driveApi.authenticate();
        } catch (e) { 
            console.error('[Drive Auth] Error:', e);
            return false; 
        }
    });

    ipcMain.handle('drive:uploadMovie', async (event, movieId, filePath, mimeType, options = {}) => {
        try {
            const stats = fs.statSync(filePath);
            const fileSize = stats.size;
            
            // Auto-optimize if > 2GB unless explicitly disabled
            const threshold = 2 * 1024 * 1024 * 1024;
            if (fileSize > threshold && options.optimize === undefined) {
                options.optimize = true;
                console.log(`[Drive Upload] File size ${fileSize} exceeds 2GB. Enabling Auto-Optimization.`);
            }

            console.log(`[Drive Upload] Starting upload for movie ${movieId}: ${filePath} (Optimize: ${options.optimize || false})`);
            
            const result = await driveApi.uploadVideo(filePath, mimeType, (progress, uploaded, total) => {
                // Send progress to all windows (important in case focus is lost during OAuth)
                BrowserWindow.getAllWindows().forEach(win => {
                    win.webContents.send(`drive:uploadProgress-${movieId}`, { 
                        progress: options.optimize ? null : progress, 
                        uploaded, 
                        total: options.optimize ? null : total,
                        isOptimizing: options.optimize
                    });
                });
            }, options);

            console.log(`[Drive Upload] Success! File ID: ${result.id}`);

            // Update database with the drive_file_id
            await db.updateMovie(movieId, { drive_file_id: result.id });
            broadcastLibraryUpdate();

            return { success: true, fileId: result.id };
        } catch (e) {
            console.error('[Drive Upload] Fatal Error:', e);
            return { error: e.message || 'Error desconocido durante la subida' };
        }
    });

    ipcMain.handle('drive:disconnect', async () => {
        try {
            return await driveApi.disconnect();
        } catch (e) {
            console.error('[Drive Disconnect] Error:', e);
            return false;
        }
    });
}
