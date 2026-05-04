const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const axios = require('axios');
const driveApi = require('./drive');
const db = require('./db');
const { getVideoMetadata } = require('./optimizer'); // Import new function

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
        this.setMaxListeners(30); // Prevent MaxListenersExceededWarning
        this.queue = [];
        this.isProcessing = false;
        this.loadQueue();
        
        // Auto-start loop on initialization
        setTimeout(() => this.processNext(), 5000);

        // Safety heartbeat: If isProcessing is true but no progress for 30 mins, reset it
        this.lastProgressUpdate = Date.now();
        setInterval(() => this.checkHeartbeat(), 5 * 60 * 1000); // Every 5 mins
    }

    checkHeartbeat() {
        if (!this.isProcessing) return;
        const idleTime = Date.now() - this.lastProgressUpdate;
        if (idleTime > 30 * 60 * 1000) { // 30 mins
            console.warn('[UploadManager] Proceso estancado detectado (30 min sin cambios). Reiniciando...');
            this.isProcessing = false;
            this.processNext();
        }
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
        const nextJob = this.queue.find(j => j.status === 'pending' && j.filePath && j.filePath.toLowerCase() !== 'pending');
        if (!nextJob) return; // Nada más que procesar

        this.isProcessing = true;
        nextJob.status = 'uploading';
        this.saveQueue();
        this.emit('job_started', nextJob);
        this.emit('queue_updated', this.queue);

        try {
            let workingFilePath = nextJob.filePath;
            const isActuallyUrl = nextJob.isUrl || (typeof workingFilePath === 'string' && workingFilePath.startsWith('http'));

            // 1. If it's a URL, download it first
            if (isActuallyUrl) {
                console.log(`[UploadManager] Descargando desde nube: ${nextJob.title}`);
                const tempDir = path.join(process.cwd(), 'temp_downloads');
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                
                const tempFilePath = path.join(tempDir, `fetch_${Date.now()}.mp4`);
                const response = await axios({
                    method: 'get',
                    url: nextJob.filePath,
                    responseType: 'stream',
                    timeout: 60000 // 1 minute timeout for connection
                });

                const totalLength = response.headers['content-length'];
                let downloadedLength = 0;

                const writer = fs.createWriteStream(tempFilePath);
                response.data.on('data', (chunk) => {
                    downloadedLength += chunk.length;
                    const rawProgress = totalLength ? Math.round((downloadedLength / totalLength) * 100) : 0;
                    const progress = Math.min(rawProgress, 100);
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
            
            // Extract video metadata before uploading
            let videoMetadata = {};
            try {
                if (!isActuallyUrl && fs.existsSync(workingFilePath)) {
                    console.log(`[UploadManager] Extracting metadata from: ${workingFilePath}`);
                    videoMetadata = await getVideoMetadata(workingFilePath);
                    console.log(`[UploadManager] Metadata: ${JSON.stringify(videoMetadata)}`);
                }
            } catch (metaErr) {
                console.warn('[UploadManager] Metadata extraction failed:', metaErr.message);
            }
            
            const result = await driveApi.uploadVideo(workingFilePath, nextJob.mimeType, (progress, uploaded, total) => {
                nextJob.progress = progress;
                // Emitir progreso por SSE
                this.lastProgressUpdate = Date.now();
                this.emit('job_progress', {
                    movieId: nextJob.movieId,
                    progress,
                    uploaded,
                    total,
                    isOptimizing: !!nextJob.options.optimize
                });
            }, nextJob.options);

            // Completado con exito
            await db.updateMovie(parseInt(nextJob.movieId), { 
                drive_file_id: result.id,
                cloud_source_url: null // Limpiar el enlace temporal una vez segurizado en Drive
            });
            
            nextJob.status = 'done';
            nextJob.progress = 100;
            if (nextJob.options.deleteAfter || nextJob.isUrl) {
                try { fs.unlinkSync(workingFilePath); } catch(e){}
            }

            console.log(`[UploadManager] Subida exitosa: ${nextJob.title}`);
            this.emit('job_done', nextJob);

        } catch (error) {
            console.error(`[UploadManager] Fallo en subida ${nextJob.title}:`, error.message);
            
            let errorMessage = error.message;
            if (errorMessage && errorMessage.toLowerCase().includes('invalid_grant')) {
                console.error('[UploadManager] Token de Drive revocado o expirado. Desconectando...');
                try {
                    await driveApi.disconnect();
                } catch (e) {
                    console.error('[UploadManager] Error al desconectar drive:', e.message);
                }
                errorMessage = 'Google Drive desconectado (Sesión expirada). Reconéctalo en Ajustes.';
            }

            nextJob.status = 'error';
            nextJob.error = errorMessage;
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
