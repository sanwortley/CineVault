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

if (process.platform === 'win32') {
    app.disableHardwareAcceleration();
}

// Register cine protocol as privileged
protocol.registerSchemesAsPrivileged([
    { scheme: 'cine', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true } }
]);

// Allow autoplay with sound
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

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

app.whenReady().then(() => {
    // 1. Register cine protocol
    protocol.handle('cine', async (request) => {
        try {
            const url = new URL(request.url);
            let filePath = decodeURIComponent(url.pathname);
            
            // Bulletproof Windows Path Resolution
            if (process.platform === 'win32') {
                // Combine host (drive) if it exists (cine://c/path)
                if (url.host) {
                    const host = url.host.length === 1 ? url.host + ':' : url.host;
                    filePath = host + filePath;
                }
                
                // Clean up leading slashes: /C:/ -> C:/, /C/ -> C/
                filePath = filePath.replace(/^[\\\/]+([a-zA-Z])[:\\\/]/, '$1:/');
                
                // Ensure colon exists: C/Wortfly -> C:/Wortfly
                if (filePath.length > 1 && filePath[1] !== ':' && (filePath[1] === '/' || filePath[1] === '\\')) {
                    filePath = filePath[0] + ':' + filePath.substring(1);
                }
                
                // Ensure absolute: C:Wortfly -> C:/Wortfly
                if (filePath.length > 2 && filePath[1] === ':' && filePath[2] !== '/' && filePath[2] !== '\\') {
                    filePath = filePath.substring(0, 2) + '/' + filePath.substring(2);
                }

                // Final normalization
                filePath = filePath.replace(/\\/g, '/');
            }

            const shouldTranscode = url.searchParams.get('transcode') === 'true';
            const startTime = parseFloat(url.searchParams.get('t') || 0);

            if (!fs.existsSync(filePath)) {
                console.error('[Main] Protocol: File NOT found at:', filePath);
                return new Response(null, { status: 404 });
            }

            if (shouldTranscode) {
                console.log(`[Main] Protocol: Transcoding "${filePath}" from ${startTime}s`);
                const passThrough = new PassThrough();
                
                let command = ffmpeg(filePath);
                if (startTime > 0) {
                    command = command.seekInput(startTime);
                }

                command
                    .videoCodec('copy')
                    .audioCodec('aac')
                    .format('matroska')
                    .outputOptions([
                        '-movflags frag_keyframe+empty_moov+default_base_moof',
                        '-preset ultrafast',
                        '-tune zerolatency'
                    ])
                    .on('error', (err) => {
                        console.error('[Main] FFmpeg Stream Error:', err.message);
                        passThrough.end();
                    })
                    .pipe(passThrough);

                return new Response(Readable.toWeb(passThrough), {
                    status: 200,
                    headers: {
                        'Content-Type': 'video/x-matroska',
                        'Cache-Control': 'no-cache',
                        'Accept-Ranges': 'none'
                    }
                });
            }

            const stats = fs.statSync(filePath);
            const fileSize = stats.size;
            const range = request.headers.get('range');

            const getMimeType = (file) => {
                const ext = path.extname(file).toLowerCase();
                const map = {
                    '.mp4': 'video/mp4',
                    '.mkv': 'video/x-matroska',
                    '.webm': 'video/webm'
                };
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

    // 2. Register IPC Handlers (Safe duplication prevention)
    ipcMain.removeHandler('player:checkAudio');
    ipcMain.handle('player:checkAudio', async (event, filePath) => {
        return new Promise((resolve) => {
            ffmpeg.ffprobe(filePath, (err, metadata) => {
                if (err) return resolve({ needsTranscode: false });
                const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
                if (!audioStream) return resolve({ needsTranscode: false });
                const codec = (audioStream.codec_name || '').toLowerCase();
                const unsupported = ['ac3', 'dts', 'truehd', 'eac3', 'opus'].includes(codec);
                const duration = metadata.format.duration || 0;
                resolve({ needsTranscode: unsupported, codec, duration });
            });
        });
    });

    ipcMain.removeHandler('player:openExternal');
    ipcMain.handle('player:openExternal', async (event, filePath) => {
        try {
            await shell.openPath(filePath);
            return { success: true };
        } catch (error) {
            console.error('[Main] OpenExternal Error:', error);
            return { success: false, error: error.message };
        }
    });

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});


const db = require('../backend/db');
const { scanDirectory } = require('../backend/scanner');
const { normalizeFilename } = require('../backend/parser');
const { searchMovie, getMovieDetails } = require('../backend/tmdb');
const { generateSpoilerFreeSummary } = require('../backend/summary');
const { findDuplicate } = require('../backend/duplicateDetector');

// IPC Handlers
ipcMain.handle('config:getTMDBKey', () => {
    return process.env.TMDB_API_KEY || '';
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

        // Save folders to DB
        console.log('[Main] Saving folders to database...');
        const stmt = db.prepare('INSERT OR IGNORE INTO folders (folder_path) VALUES (?)');
        for (const dirPath of filePaths) {
            await stmt.run(dirPath);
        }
        console.log('[Main] Folders saved successfully');

        return filePaths;
    } catch (error) {
        console.error('[Main] Error opening directory:', error);
        return [];
    }
});

ipcMain.handle('library:getFolders', async () => {
    return await db.prepare('SELECT * FROM folders').all();
});

ipcMain.handle('library:removeFolder', async (event, folderPath) => {
    // Normalize path to ensure consistency (especially for Windows)
    const normalizedPath = path.normalize(folderPath);
    console.log('[Main] Removing folder and associated movies:', normalizedPath);

    // 1. Delete associated movies first
    // We use LIKE 'path\%' to match all files inside that folder
    // Note: path.join appends the platform separator
    const matchPath = normalizedPath.endsWith(path.sep) ? normalizedPath : normalizedPath + path.sep;
    const deleteMovies = db.prepare('DELETE FROM movies WHERE file_path LIKE ?');
    await deleteMovies.run(`${matchPath}%`);

    // 2. Delete the folder entry
    return await db.prepare('DELETE FROM folders WHERE folder_path = ?').run(folderPath);
});

ipcMain.handle('library:refresh', async () => {
    const folders = await db.prepare('SELECT folder_path FROM folders').all();
    let allFiles = [];

    for (const { folder_path } of folders) {
        const files = await scanDirectory(folder_path);
        allFiles = allFiles.concat(files);
    }

    for (const file of allFiles) {
        // 1. Parser
        const { clean_title, year } = normalizeFilename(file.file_name);

        // 2. Duplicate Check
        const existing = await findDuplicate(file.file_path, file.file_name, file.file_size, null, year);
        if (existing) continue;

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
        const insert = db.prepare(`
            INSERT INTO movies (
                file_name, file_path, file_size, extension,
                detected_title, detected_year, official_title,
                overview, spoiler_free_summary, poster_url,
                backdrop_url, genres, runtime, director, rating,
                identified_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        await insert.run(
            file.file_name, file.file_path, file.file_size, file.extension,
            clean_title, year, details.official_title || null,
            details.overview || null, summary, details.poster_url || null,
            details.backdrop_url || null, details.genres || null,
            details.runtime || null, details.director || null,
            details.rating || null, status
        );
    }

    return await db.prepare('SELECT * FROM movies ORDER BY created_at DESC').all();
});

ipcMain.handle('library:clear', async () => {
    console.log('[Main] Clearing entire library...');
    await db.prepare('DELETE FROM movies').run();
    await db.prepare('DELETE FROM folders').run();
    return { success: true };
});

ipcMain.handle('library:getMovies', async () => {
    return await db.prepare('SELECT * FROM movies ORDER BY created_at DESC').all();
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

