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
    searchSubtitles: (data) => ipcRenderer.invoke('player:searchSubtitles', data),
    downloadSubtitle: (fileId) => ipcRenderer.invoke('player:downloadSubtitle', fileId),
    selectLocalSubtitle: () => ipcRenderer.invoke('player:selectLocalSubtitle'),
    updateMovieProgress: (movieId, watchedDuration) => ipcRenderer.invoke('library:updateProgress', movieId, watchedDuration),
    // Drive API
    checkDriveAuth: () => ipcRenderer.invoke('drive:checkAuth'),
    authenticateDrive: () => ipcRenderer.invoke('drive:authenticate'),
    disconnectDrive: () => ipcRenderer.invoke('drive:disconnect'),
    uploadMovieToDrive: (movieId, filePath, mimeType, options) => ipcRenderer.invoke('drive:uploadMovie', movieId, filePath, mimeType, options),
    onDriveUploadProgress: (movieId, callback) => {
        const channel = `drive:uploadProgress-${movieId}`;
        const listener = (event, data) => callback(data);
        ipcRenderer.on(channel, listener);
        return () => ipcRenderer.removeListener(channel, listener);
    },
    onLibraryUpdated: (callback) => {
        const listener = () => callback();
        ipcRenderer.on('library:updated', listener);
        return () => ipcRenderer.removeListener('library:updated', listener);
    }
});
