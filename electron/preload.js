const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    getFolders: () => ipcRenderer.invoke('library:getFolders'),
    removeFolder: (folderPath) => ipcRenderer.invoke('library:removeFolder', folderPath),
    refreshLibrary: () => ipcRenderer.invoke('library:refresh'),
    getMovies: () => ipcRenderer.invoke('library:getMovies'),
    clearLibrary: () => ipcRenderer.invoke('library:clear'),
    getTMDBKey: () => ipcRenderer.invoke('config:getTMDBKey'),
    playVideo: (filePath) => ipcRenderer.invoke('player:play', filePath),
    checkFileExists: (filePath) => ipcRenderer.invoke('file:exists', filePath),
    openExternal: (filePath) => ipcRenderer.invoke('player:openExternal', filePath),
    checkAudio: (filePath) => ipcRenderer.invoke('player:checkAudio', filePath),
    updateMovieProgress: (movieId, watchedDuration) => ipcRenderer.invoke('library:updateProgress', movieId, watchedDuration),
    // Drive API
    checkDriveAuth: () => ipcRenderer.invoke('drive:checkAuth'),
    authenticateDrive: () => ipcRenderer.invoke('drive:authenticate'),
    uploadMovieToDrive: (movieId, filePath, mimeType) => ipcRenderer.invoke('drive:uploadMovie', movieId, filePath, mimeType),
    onDriveUploadProgress: (movieId, callback) => {
        const channel = `drive:uploadProgress-${movieId}`;
        // Remove existing listener to prevent memory leaks if re-mounted
        ipcRenderer.removeAllListeners(channel);
        ipcRenderer.on(channel, (event, data) => callback(data));
    }
});
