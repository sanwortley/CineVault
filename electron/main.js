const { app, BrowserWindow, ipcMain, dialog, shell, protocol } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const isDev = process.env.NODE_ENV === 'development';

if (process.platform === 'win32') {
    app.disableHardwareAcceleration();
}

// Register cine protocol as privileged
protocol.registerSchemesAsPrivileged([
    { scheme: 'cine', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true } }
]);

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
        win.webContents.openDevTools();
    } else {
        win.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}

app.whenReady().then(() => {
    // Register custom protocol for local video files (Modern API)
    protocol.handle('cine', (request) => {
        const filePath = decodeURIComponent(request.url.replace('cine://', ''));
        console.log('[Main] Protocol: serving file:', filePath);
        return pathToFileURL(filePath);
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

