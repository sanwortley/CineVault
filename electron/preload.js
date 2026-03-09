const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    getFolders: () => ipcRenderer.invoke('library:getFolders'),
    removeFolder: (folderPath) => ipcRenderer.invoke('library:removeFolder', folderPath),
    refreshLibrary: () => ipcRenderer.invoke('library:refresh'),
    getMovies: () => ipcRenderer.invoke('library:getMovies'),
    getTMDBKey: () => ipcRenderer.invoke('config:getTMDBKey'),
    playVideo: (filePath) => ipcRenderer.invoke('player:play', filePath),
});
