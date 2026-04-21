const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const axios = require('axios');
const driveApi = require('./drive');
const db = require('./db');

// Cross-environment persistent storage
const QUEUE_FILE = process.platform === 'win32' 
    ? path.join(os.homedir(), 'CineVault', 'upload_queue.json') 
    : path.join(os.tmpdir(), 'cinevault_upload_queue.json');

const ensureDirectoryExists = (filePath) => {
    const dirname = path.dirname(filePath);
    if (!fs.existsSync(dirname)) {
        fs.mkdirSync(dirname, { recursive: true });
    }
};

class UploadManager extends EventEmitter {
    constructor() {
        super();
        this.queue = [];
        this.isProcessing = false;
        this.loadQueue();
    }

    loadQueue() {
        try {
            if (fs.existsSync(QUEUE_FILE)) {
                this.queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
                // Si alguna quedó en 'uploading', ponla de vuelta a 'pending' tras el reinicio
                this.queue.forEach(job => {
                    if (job.status === 'uploading') {
                        job.status = 'pending';
                    }
                });
                this.saveQueue();
            }
        } catch (e) {
            console.error('[UploadManager] Error al cargar la cola de subidas:', e.message);
            this.queue = [];
        }
    }

    saveQueue() {
        try {
            ensureDirectoryExists(QUEUE_FILE);
            fs.writeFileSync(QUEUE_FILE, JSON.stringify(this.queue, null, 2));
        } catch (e) {
            console.error('[UploadManager] Error al guardar la cola:', e.message);
        }
    }

    enqueue(movieId, title, filePath, mimeType, options = {}) {
        const existingInd = this.queue.findIndex(j => String(j.movieId) === String(movieId));
        if (existingInd !== -1) {
            // Update existing if not done
            if (this.queue[existingInd].status !== 'done') {
                this.queue[existingInd] = {
                    ...this.queue[existingInd],
                    status: 'pending',
                    progress: 0,
                    error: null,
                    filePath,
                    mimeType,
                    options
                };
            }
        } else {
            this.queue.push({
                id: Date.now().toString(),
                movieId: String(movieId),
                title: title || `Película ${movieId}`,
                filePath,
                mimeType,
                status: options.status || 'pending', // downloading, pending, uploading, done, error
                progress: 0,
                error: null,
                options
            });
        }
        
        this.saveQueue();
        this.emit('queue_updated', this.queue);
        this.processNext();
    }

    retry(movieId) {
        const job = this.queue.find(j => String(j.movieId) === String(movieId));
        if (job && job.status === 'error') {
            job.status = 'pending';
            job.progress = 0;
            job.error = null;
            this.saveQueue();
            this.emit('queue_updated', this.queue);
            this.processNext();
            return true;
        }
        return false;
    }

    remove(movieId) {
        const originalLength = this.queue.length;
        this.queue = this.queue.filter(j => String(j.movieId) !== String(movieId));
        if (this.queue.length !== originalLength) {
            this.saveQueue();
            this.emit('queue_updated', this.queue);
        }
    }

    getQueue() {
        return this.queue;
    }

    updateJob(movieId, data) {
        const index = this.queue.findIndex(j => String(j.movieId) === String(movieId));
        if (index !== -1) {
            this.queue[index] = { ...this.queue[index], ...data };
            this.saveQueue();
            this.emit('queue_updated', this.queue);
            return true;
        }
        return false;
    }

    getJobStatus(movieId) {
        return this.queue.find(j => String(j.movieId) === String(movieId));
    }

    async processNext() {
        if (this.isProcessing) return;

        // Solo procesar si hay algo 'pending'. Si está 'downloading', esperamos a que discover.js lo pase a 'pending'.
        const nextJob = this.queue.find(j => j.status === 'pending');
        if (!nextJob) return; // Nada más que procesar

        this.isProcessing = true;
        nextJob.status = 'uploading';
        this.saveQueue();
        this.emit('job_started', nextJob);
        this.emit('queue_updated', this.queue);

        try {
            let workingFilePath = nextJob.filePath;

            // 1. If it's a URL, download it first
            if (nextJob.isUrl) {
                console.log(`[UploadManager] Descargando desde nube: ${nextJob.title}`);
                const tempDir = path.join(process.cwd(), 'temp_downloads');
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                
                const tempFilePath = path.join(tempDir, `fetch_${Date.now()}.mp4`);
                const response = await axios({
                    method: 'get',
                    url: nextJob.filePath,
                    responseType: 'stream'
                });

                const totalLength = response.headers['content-length'];
                let downloadedLength = 0;

                const writer = fs.createWriteStream(tempFilePath);
                response.data.on('data', (chunk) => {
                    downloadedLength += chunk.length;
                    const progress = totalLength ? Math.round((downloadedLength / totalLength) * 100) : 0;
                    this.emit('job_progress', {
                        movieId: nextJob.movieId,
                        progress,
                        status: 'fetching'
                    });
                });

                response.data.pipe(writer);

                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });

                workingFilePath = tempFilePath;
            }

            console.log(`[UploadManager] Procesando subida: ${nextJob.title}`);
            const result = await driveApi.uploadVideo(workingFilePath, nextJob.mimeType, (progress, uploaded, total) => {
                nextJob.progress = progress;
                // Emitir progreso por SSE
                this.emit('job_progress', {
                    movieId: nextJob.movieId,
                    progress,
                    uploaded,
                    total,
                    isOptimizing: !!nextJob.options.optimize
                });
            }, nextJob.options);

            // Completado con exito
            await db.updateMovie(parseInt(nextJob.movieId), { drive_file_id: result.id });
            
            nextJob.status = 'done';
            nextJob.progress = 100;
            if (nextJob.options.deleteAfter || nextJob.isUrl) {
                try { fs.unlinkSync(workingFilePath); } catch(e){}
            }

            console.log(`[UploadManager] Subida exitosa: ${nextJob.title}`);
            this.emit('job_done', nextJob);

        } catch (error) {
            console.error(`[UploadManager] Fallo en subida ${nextJob.title}:`, error.message);
            nextJob.status = 'error';
            nextJob.error = error.message;
            this.emit('job_error', nextJob);
        }

        this.saveQueue();
        this.emit('queue_updated', this.queue);
        
        this.isProcessing = false;
        
        // Timeout ligero para no colapsar peticiones y seguir con el proximo
        setTimeout(() => this.processNext(), 2000);
    }

    updateJob(movieId, updates) {
        const job = this.queue.find(j => String(j.movieId) === String(movieId));
        if (job) {
            const oldStatus = job.status;
            Object.assign(job, updates);
            this.saveQueue();
            this.emit('queue_updated', this.queue);
            
            // Emit progress event so the SSE broadcaster in server.js picks it up
            this.emit('job_progress', {
                movieId: String(job.movieId),
                progress: job.progress ?? 0,
                status: job.status,
                ...updates
            });

            // If it just became pending, trigger processing loop
            if (updates.status === 'pending' || (oldStatus !== 'pending' && job.status === 'pending')) {
                this.processNext();
            }
            return true;
        }
        return false;
    }
}

// Singleton export
module.exports = new UploadManager();
