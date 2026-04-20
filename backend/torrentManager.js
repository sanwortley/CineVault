const WebTorrent = require('webtorrent');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { EventEmitter } = require('events');

// Use a persistent downloads directory
const DOWNLOADS_DIR = path.join(process.cwd(), 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

class TorrentManager extends EventEmitter {
    constructor() {
        super();
        this.client = new WebTorrent();
        this.activeDownloads = new Map(); // movieId -> torrent
    }

    async addDownload(movieId, title, magnetUri, onDone) {
        if (this.activeDownloads.has(movieId)) {
            throw new Error('Esta película ya se está descargando');
        }

        console.log(`[TorrentManager] Iniciando descarga para: ${title}`);
        
        const torrent = this.client.add(magnetUri, { path: DOWNLOADS_DIR }, (torrent) => {
            console.log(`[TorrentManager] Metadatos recibidos para: ${torrent.name}`);
            
            torrent.on('download', (bytes) => {
                const progress = (torrent.progress * 100).toFixed(2);
                this.emit('progress', {
                    movieId,
                    progress,
                    downloadSpeed: (torrent.downloadSpeed / 1024 / 1024).toFixed(2) + ' MB/s',
                    remainingTime: Math.round(torrent.timeRemaining / 1000)
                });
            });

            torrent.on('done', async () => {
                console.log(`[TorrentManager] Descarga completa: ${torrent.name}`);
                
                // Find the largest file (the movie)
                const movieFile = torrent.files.reduce((prev, curr) => {
                    return (prev.length > curr.length) ? prev : curr;
                });

                const finalPath = path.join(DOWNLOADS_DIR, movieFile.path);
                
                this.activeDownloads.delete(movieId);
                
                if (onDone) {
                    await onDone(finalPath, movieFile.name);
                }
                
                this.emit('done', { movieId, filePath: finalPath });
                
                // Destroy torrent to free resources, but keep the file!
                torrent.destroy();
            });

            torrent.on('error', (err) => {
                console.error(`[TorrentManager] Error en torrent ${movieId}:`, err.message);
                this.activeDownloads.delete(movieId);
                this.emit('error', { movieId, error: err.message });
            });
        });

        this.activeDownloads.set(movieId, torrent);
        return torrent;
    }

    getDownloadStatus(movieId) {
        const torrent = this.activeDownloads.get(movieId);
        if (!torrent) return null;

        return {
            movieId,
            progress: (torrent.progress * 100).toFixed(2),
            downloadSpeed: (torrent.downloadSpeed / 1024 / 1024).toFixed(2) + ' MB/s',
            remainingTime: Math.round(torrent.timeRemaining / 1000)
        };
    }

    cancelDownload(movieId) {
        const torrent = this.activeDownloads.get(movieId);
        if (torrent) {
            torrent.destroy();
            this.activeDownloads.delete(movieId);
            return true;
        }
        return false;
    }
}

module.exports = new TorrentManager();
