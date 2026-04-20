const { EventEmitter } = require('events');

class TorrentManager extends EventEmitter {
    constructor() {
        super();
        this.activeDownloads = new Map();
    }

    async addDownload(movieId, title, magnetUri, onDone) {
        throw new Error('Descargas directas desactivadas por política de servidor (Railway).');
    }

    getDownloadStatus(movieId) {
        return null;
    }

    cancelDownload(movieId) {
        return false;
    }
}

module.exports = new TorrentManager();
