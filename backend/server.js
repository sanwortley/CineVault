/**
 * CineVault Web Backend Server
 * Standalone Express server — runs on Railway (or locally for development)
 * Exposes the same functionality as the Electron main process, but as HTTP endpoints.
 */

require('dotenv').config();
const movieSearcher = require('./movieSearcher');
const debridManager = require('./debridManager');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const mime = require('mime-types');
const cookieParser = require('cookie-parser');
const iconv = require('iconv-lite');
const chardet = require('chardet');

const driveApi = require('./drive');
const db = require('./db');
const uploadManager = require('./uploadManager');
const optimizer = require('./optimizer');
const discoverRouter = require('./discover');

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);

const { normalizeFilename } = require('./parser');
const { searchMovie, getMovieDetails } = require('./tmdb');
const { scanDirectory } = require('./scanner');
const { addMovie } = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;
const isAdmin = (email) => email === (process.env.ADMIN_EMAIL || 'admin@cinevault.local');
const { sessionMiddleware, adminMiddleware } = require('./middleware');

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
    origin: true, 
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Robust Static Serving (Railway/Production)
const distPath = path.resolve(__dirname, '../dist');
console.log(`[Server] Static assets directory: ${distPath}`);

if (fs.existsSync(distPath)) {
    console.log('[Server] Initializing static routes for:', distPath);
    
    // Serve static assets with long-term caching (since Vite hashes them)
    app.use('/assets', express.static(path.join(distPath, 'assets'), {
        immutable: true,
        maxAge: '1y',
        index: false
    }));

    // Serve other public files (favicon, robots.txt, etc.)
    app.use(express.static(distPath));
    
    const assetsPath = path.join(distPath, 'assets');
    if (fs.existsSync(assetsPath)) {
        console.log(`[Server] Assets confirmed in: ${assetsPath}`);
    } else {
        console.warn(`[Server] WARNING: No /assets folder found in dist yet.`);
    }
} else {
    console.error(`[CRITICAL] Static directory NOT FOUND: ${distPath}. Front-end will not load (502/404).`);
}

// ─── Multer Config for Movie Uploads ─────────────────────────────────────────
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const { targetPath } = req.body;
        if (targetPath && fs.existsSync(targetPath)) {
            cb(null, targetPath);
        } else {
            const defaultPath = process.env.MOVIES_PATH || '/app/library';
            if (!fs.existsSync(defaultPath)) {
                try {
                    fs.mkdirSync(defaultPath, { recursive: true });
                } catch (e) {
                    const fallback = path.join(os.tmpdir(), 'CineVault');
                    if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true });
                    return cb(null, fallback);
                }
            }
            cb(null, defaultPath);
        }
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const movieUpload = multer({ 
    storage,
    limits: { fileSize: 10 * 1024 * 1024 * 1024 } // 10GB Limit per file
});

// ─── Subtitles Serving ────────────────────────────────────────────────────────
app.get('/api/subtitles/internal', async (req, res) => {
    const { path: filePath, index } = req.query;
    if (!filePath || index === undefined) return res.status(400).send('Missing params');
    
    res.setHeader('Content-Type', 'text/vtt');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    ffmpeg(filePath)
        .outputOptions([`-map 0:s:${index}`, '-f webvtt'])
        .on('error', err => {
            console.error('[Subtitles] Extraction error:', err.message);
            if (!res.headersSent) res.status(500).send('Error extracting subtitles');
        })
        .pipe(res, { end: true });
});

app.get('/api/subtitles/external', (req, res) => {
    const { path: filePath } = req.query;
    if (!filePath) return res.status(400).send('Missing path');
    res.setHeader('Content-Type', 'text/vtt');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (fs.existsSync(filePath)) {
        ffmpeg(filePath)
            .outputOptions(['-f webvtt'])
            .on('error', err => {
                console.error('[Subtitles] Conversion error:', err.message);
                if (!res.headersSent) res.status(500).send('Error converting subtitles');
            })
            .pipe(res, { end: true });
    } else {
        res.status(404).send('Not found');
    }
});



// ─── Auth Routes ──────────────────────────────────────────────────────────────
const REDIRECT_PORT = 19999;
const WEB_OAUTH_REDIRECT = `${process.env.BACKEND_URL || `http://localhost:${PORT}`}/api/auth/callback`;

app.get('/api/auth/google', (req, res) => {
    const authUrl = driveApi.getAuthUrl();
    res.redirect(authUrl);
});

app.get('/api/auth/me', sessionMiddleware, (req, res) => {
    res.json({ 
        user: req.session,
        isAdmin: req.session?.email?.trim().toLowerCase() === (process.env.ADMIN_EMAIL || process.env.VITE_ADMIN_EMAIL || 'sanwortley@gmail.com').trim().toLowerCase()
    });
});

app.get('/api/auth/callback', async (req, res) => {
    const { code } = req.query;
    try {
        const tokens = await driveApi.getTokens(code);
        driveApi.getOAuthClient().setCredentials(tokens);
        res.send('<h1>CineVault conectado con éxito</h1><script>setTimeout(window.close, 1000)</script>');
    } catch (error) {
        console.error('[Auth Callback] Error:', error.message);
        res.status(500).send(`Error al conectar con Drive: ${error.message}`);
    }
});

app.get('/api/auth/status', (req, res) => {
    res.json({ authenticated: driveApi.isAuthenticated() });
});

// User Session Management
app.post('/api/auth/register-session', async (req, res) => {
    const { userId, email } = req.body;
    if (!userId || !email) return res.status(400).json({ error: 'UserId y Email requeridos' });

    const userAgent = req.headers['user-agent'];
    const ip = req.ip || req.headers['x-forwarded-for'];

    try {
        const result = await db.registerSession(userId, email, userAgent, ip);
        const session = Array.isArray(result) ? result[0] : result;
        res.json({ sessionId: session.id });
    } catch (err) {
        console.error('[RegisterSession] Error:', err.message);
        res.status(500).json({ error: 'Error al registrar sesión' });
    }
});

app.get('/api/auth/session-check', sessionMiddleware, (req, res) => {
    // sessionMiddleware already validated and updated last_active
    res.json({ status: 'ok', session: req.session });
});

// Admin Session Management
app.get('/api/admin/sessions', sessionMiddleware, adminMiddleware, async (req, res) => {
    try {
        const sessions = await db.listSessions();
        res.json(sessions);
    } catch (err) {
        res.status(500).json({ error: 'Error listando sesiones' });
    }
});

app.delete('/api/admin/sessions/:id', sessionMiddleware, adminMiddleware, async (req, res) => {
    try {
        await db.deleteSession(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Error eliminando sesión' });
    }
});

// ─── Drive Streaming ──────────────────────────────────────────────────────────
app.get('/api/drive/stream/:fileId', sessionMiddleware, async (req, res) => {
    if (!driveApi.isAuthenticated()) {
        return res.status(401).json({ error: 'Drive no conectado. Inicia sesión para ver películas.' });
    }
    const { fileId } = req.params;
    const range = req.headers.range;
    const transcode = req.query.transcode === 'true';
    const startTime = req.query.t || 0;
    
    try {
        if (fileId === 'pending_cloud') {
            return res.status(202).json({ 
                status: 'processing', 
                message: 'La película de la Bóveda Global todavía se está procesando. Reintenta en unos minutos.' 
            });
        }
        await driveApi.streamVideo(fileId, range, res, { transcode, t: startTime });
    } catch (err) {
        console.error('[Server] Drive streaming route error:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error interno de servidor', message: err.message });
        }
    }
});

// ─── Local Streaming ──────────────────────────────────────────────────────────
app.get('/api/stream/local', (req, res) => {
    const filePath = req.query.path;
    const transcode = req.query.transcode === 'true';
    const startTime = parseFloat(req.query.t || 0);

    if (!filePath) {
        console.error('[Stream] No path provided');
        return res.status(400).send('Path is required');
    }

    if (!fs.existsSync(filePath)) {
        console.error('[Stream] File not found:', filePath);
        return res.status(404).send('File not found');
    }

    console.log(`[Stream] Streaming ${filePath} (transcode=${transcode}, start=${startTime}s)`);

    if (transcode) {
        const { getTranscodeStream } = require('./optimizer');
        
        res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Transfer-Encoding': 'chunked'
        });
        
        const transcodeStream = getTranscodeStream(filePath, startTime);
        transcodeStream.pipe(res);

        res.on('close', () => {
           if (transcodeStream.ffmpegCommand) transcodeStream.ffmpegCommand.kill();
        });
    } else {
        // Direct stream with range support
        try {
            const stat = fs.statSync(filePath);
            const fileSize = stat.size;
            const range = req.headers.range;
            const contentType = mime.lookup(filePath) || 'video/mp4';

            if (range) {
                const parts = range.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

                if (start >= fileSize) {
                    res.status(416).send('Requested range not satisfiable\n' + start + ' >= ' + fileSize);
                    return;
                }

                const chunksize = (end - start) + 1;
                const file = fs.createReadStream(filePath, { start, end });
                const head = {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunksize,
                    'Content-Type': contentType,
                };

                res.writeHead(206, head);
                file.pipe(res);
            } else {
                const head = {
                    'Content-Length': fileSize,
                    'Content-Type': contentType,
                };
                res.writeHead(200, head);
                fs.createReadStream(filePath).pipe(res);
            }
        } catch (err) {
            console.error('[Stream] Error streaming file:', err);
            res.status(500).send('Internal server error');
        }
    }
});

// ─── Drive Upload ─────────────────────────────────────────────────────────────
const upload = multer({ dest: os.tmpdir() });

// Track SSE clients for upload progress is now handled via uploadManager events

app.get('/api/drive/progress/:movieId', (req, res) => {
    const { movieId } = req.params;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 15000);

    const onProgress = (data) => {
        if (String(data.movieId) === String(movieId)) {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
    };
    const onDone = (job) => {
        if (String(job.movieId) === String(movieId)) {
            res.write(`data: ${JSON.stringify({ progress: 100, status: 'done', isOptimizing: false })}\n\n`);
        }
    };
    const onError = (job) => {
        if (String(job.movieId) === String(movieId)) {
            res.write(`data: ${JSON.stringify({ status: 'error', error: job.error })}\n\n`);
        }
    };

    uploadManager.on('job_progress', onProgress);
    uploadManager.on('job_done', onDone);
    uploadManager.on('job_error', onError);

    res.write(`data: ${JSON.stringify({ progress: 1, status: 'starting' })}\n\n`);

    req.on('close', () => {
        clearInterval(heartbeat);
        uploadManager.removeListener('job_progress', onProgress);
        uploadManager.removeListener('job_done', onDone);
        uploadManager.removeListener('job_error', onError);
    });
});

app.post('/api/drive/upload', sessionMiddleware, adminMiddleware, upload.single('file'), async (req, res) => {
    const { movieId } = req.body;
    const tempPath = req.file?.path;

    if (!tempPath || !movieId) return res.status(400).json({ error: 'Missing file or movieId' });

    // Pre-check authentication to avoid silent background failure
    if (!driveApi.isAuthenticated()) {
        fs.unlink(tempPath, () => {});
        return res.status(401).json({ error: 'No autenticado con Google Drive. Por favor, conéctate en Ajustes.' });
    }

    try {
        const mimeType = req.file.mimetype || 'video/mp4';
        let title = `Película ${movieId}`;
        try {
            const movies = await db.findMovies({ id: movieId });
            if (movies && movies.length > 0) title = movies[0].official_title || movies[0].detected_title || title;
        } catch (err) {}

        uploadManager.enqueue(movieId, title, tempPath, mimeType, { deleteAfter: true });

        res.json({ success: true, queued: true });
    } catch (e) {
        console.error('[Upload]', e.message);
        fs.unlink(tempPath, () => {});
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/drive/upload-local', sessionMiddleware, adminMiddleware, async (req, res) => {
    const { movieId, filePath, options } = req.body;

    if (!filePath || !movieId) return res.status(400).json({ error: 'Missing filePath or movieId' });

    // Ensure the path is absolute or resolve it
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);

    if (!fs.existsSync(absolutePath)) {
        console.warn('[Smart Upload] Archivo no encontrado:', absolutePath);
        return res.status(404).json({ error: 'El archivo no existe en la ruta especificada del servidor.' });
    }

    // Pre-check authentication to avoid silent background failure
    if (!driveApi.isAuthenticated()) {
        return res.status(401).json({ error: 'No autenticado con Google Drive. Por favor, conéctate en Ajustes.' });
    }

    try {
        const ext = path.extname(absolutePath).toLowerCase();
        const mimeType = { '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm' }[ext] || 'video/mp4';

        let title = `Película ${movieId}`;
        try {
            const movies = await db.findMovies({ id: movieId });
            if (movies && movies.length > 0) title = movies[0].official_title || movies[0].detected_title || title;
        } catch (err) {}

        uploadManager.enqueue(movieId, title, absolutePath, mimeType, options);

        res.json({ success: true, started: true });

    } catch (e) {
        console.error('[Smart Upload] Error fatal:', e.message);
        if (!res.headersSent) res.status(500).json({ error: e.message });
    }
});

app.get('/api/drive/ls', sessionMiddleware, async (req, res) => {
    try {
        const { folderId } = req.query;
        const files = await driveApi.list(folderId || 'root');
        res.json({ files });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/subtitles/drive', async (req, res) => {
    try {
        const { fileId } = req.query;
        if (!fileId) return res.status(400).json({ error: 'Missing fileId' });
        
        const content = await driveApi.getFileContent(fileId);
        res.setHeader('Content-Type', 'text/vtt');
        res.send(content);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Queue API routes
app.get('/api/drive/queue', sessionMiddleware, (req, res) => {
    res.json(uploadManager.getQueue());
});

app.post('/api/drive/queue/retry', sessionMiddleware, adminMiddleware, (req, res) => {
    const { movieId } = req.body;
    if (uploadManager.retry(movieId)) {
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'Tarea no encontrada o no está en estado de error' });
    }
});

app.delete('/api/drive/queue/:movieId', sessionMiddleware, adminMiddleware, (req, res) => {
    uploadManager.remove(req.params.movieId);
    res.json({ success: true });
});

// ─── Subtitles ────────────────────────────────────────────────────────────────
app.post('/api/subtitles/search', async (req, res) => {
    const { imdbId, title } = req.body;
    const apiKey = process.env.OPENSUBTITLES_API_KEY;
    const query = imdbId ? `imdb_id=${imdbId.replace('tt', '')}` : `query=${encodeURIComponent(title)}`;
    const url = `https://api.opensubtitles.com/api/v1/subtitles?${query}&languages=es,en`;

    try {
        const response = await fetch(url, {
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'CineVault v1.0', 'Api-Key': apiKey }
        });
        const data = await response.json();
        const movieTitleLower = (title || '').toLowerCase();
        
        // Key keywords to match versions (YTS, RARBG, WEBRip, 1080p, etc.)
        const keywords = ['yts', 'rarbg', 'psa', 'webrip', 'web-rip', 'bluray', 'blu-ray', 'brrip', 'x264', 'x265', '1080p', '720p', 'amzn', 'nf'];
        const activeKeywords = keywords.filter(k => movieTitleLower.includes(k));

        const results = (data.data || [])
            .filter(s => s.attributes?.files?.length > 0)
            .map(s => {
                const attr = s.attributes;
                const releaseLower = (attr.release || '').toLowerCase();
                const lang = attr.language.toLowerCase();
                
                let score = 0;
                // Language priority
                if (lang === 'es') score += 1000;
                if (lang === 'en') score += 100;
                
                // version/release matching - Better scoring for release group
                activeKeywords.forEach(k => {
                    if (releaseLower.includes(k)) score += 100; // Increased weight
                });

                // Check for exact movie file name components in release string
                const fileNameWords = movieTitleLower.split(/[\s._-]+/).filter(w => w.length > 2);
                fileNameWords.forEach(word => {
                    if (releaseLower.includes(word)) score += 10;
                });

                // Perfect match for a popular group
                if (movieTitleLower.includes('yts') && releaseLower.includes('yts')) score += 500;
                if (movieTitleLower.includes('rarbg') && releaseLower.includes('rarbg')) score += 500;

                return {
                    id: attr.files[0].file_id,
                    label: `${lang === 'es' ? '🇪🇸' : '🇺🇸'} ${lang.toUpperCase()} - ${attr.release || 'Unknown'}`,
                    language: lang,
                    release: attr.release,
                    score: score,
                    type: 'cloud'
                };
            })
            .sort((a, b) => b.score - a.score) // Order by best score first
            .slice(0, 15); // Limit to top 15 results

        res.json({ data: results });
    } catch (e) {
        console.error('[Subtitles] Search error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/subtitles/download', async (req, res) => {
    const { fileId, movieId } = req.body;
    if (!fileId) return res.status(400).json({ error: 'Missing fileId' });
    
    const apiKey = process.env.OPENSUBTITLES_API_KEY;
    try {
        console.log(`[Subtitles] Solicitando descarga para fileId: ${fileId} (MovieId: ${movieId})`);
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
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.message || `OpenSubtitles API error: ${response.status}`);
        }
        
        const data = await response.json();
        if (!data.link) throw new Error('OpenSubtitles no proporcionó un enlace de descarga (posible límite alcanzado).');

        const subRes = await fetch(data.link);
        if (!subRes.ok) throw new Error('Error al descargar el archivo desde el enlace proporcionado.');
        
        const arrayBuffer = await subRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // --- Robust Encoding Selection ---
        let finalBuffer = buffer;
        try {
            const encoding = chardet.detect(buffer);
            console.log(`[Subtitles] Detected encoding: ${encoding}`);
            if (encoding && encoding !== 'UTF-8' && encoding !== 'ascii') {
                finalBuffer = iconv.encode(iconv.decode(buffer, encoding), 'utf-8');
                console.log(`[Subtitles] Converted to UTF-8 from ${encoding}`);
            }
        } catch (encErr) {
            console.warn('[Subtitles] Encoding detection/conversion failed, using original buffer:', encErr.message);
        }

        // --- Save Location ---
        let finalPath = path.join(os.tmpdir(), `sub_${fileId}.srt`);
        let savedLocally = false;

        if (movieId) {
            try {
                const movies = await db.findMovies({ id: movieId });
                if (movies && movies.length > 0) {
                    const movie = movies[0];
                    if (movie.file_path && !movie.file_path.startsWith('remote://') && fs.existsSync(path.dirname(movie.file_path))) {
                        const movieDir = path.dirname(movie.file_path);
                        const movieName = path.basename(movie.file_path, path.extname(movie.file_path));
                        const localPath = path.join(movieDir, `${movieName}.srt`);
                        fs.writeFileSync(localPath, finalBuffer);
                        finalPath = localPath;
                        savedLocally = true;
                        console.log(`[Subtitles] Guardado junto a la película: ${finalPath}`);
                    }
                }
            } catch (dbErr) {
                console.warn('[Subtitles] Error al buscar ruta de película para guardado local:', dbErr.message);
            }
        }

        if (!savedLocally) {
            fs.writeFileSync(finalPath, finalBuffer);
            console.log(`[Subtitles] Guardado en temp: ${finalPath}`);
        }
        
        // Also ensure a VTT version exists for immediate web streaming
        const vttPath = finalPath.replace(/\.srt$/, '.vtt');
        try {
            ffmpeg(finalPath)
                .output(vttPath)
                .on('error', (err) => console.error('[Subtitles] Automatic VTT conversion failed:', err.message))
                .run();
        } catch (vttErr) {}

        res.json({ localPath: finalPath, savedLocally, success: true });
    } catch (e) {
        console.error('[Subtitles Download] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/subtitles/cloud', async (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing fileId' });
    
    const apiKey = process.env.OPENSUBTITLES_API_KEY;
    try {
        // 1. Get download link
        const dlRes = await fetch('https://api.opensubtitles.com/api/v1/download', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'Accept': 'application/json', 
                'User-Agent': 'CineVault v1.0', 
                'Api-Key': apiKey 
            },
            body: JSON.stringify({ file_id: id })
        });
        
        if (!dlRes.ok) throw new Error('OpenSubtitles API error');
        const dlData = await dlRes.json();
        if (!dlData.link) throw new Error('No download link provided');

        // 2. Fetch the actual content
        const subRes = await fetch(dlData.link);
        if (!subRes.ok) throw new Error('Failed to download subtitle content');
        
        const arrayBuffer = await subRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // 3. Normalize encoding to UTF-8
        let finalContent = buffer;
        try {
            const encoding = chardet.detect(buffer);
            if (encoding && encoding !== 'UTF-8' && encoding !== 'ascii') {
                finalContent = iconv.decode(buffer, encoding);
            } else {
                finalContent = buffer.toString('utf8');
            }
        } catch (e) {
            finalContent = buffer.toString('utf8');
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(finalContent);
    } catch (e) {
        console.error('[Subtitles Cloud Proxy] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Route to detect and return local subtitles
app.get('/api/subtitles/find-local', async (req, res) => {
    const { movieId } = req.query;
    if (!movieId) return res.status(400).json({ error: 'Missing movieId' });

    try {
        const movies = await db.findMovies({ id: movieId });
        if (!movies || movies.length === 0) return res.status(404).json({ error: 'Pelicula no encontrada' });
        
        const movie = movies[0];
        if (!movie.file_path || movie.file_path.startsWith('remote://')) {
            return res.json({ found: false });
        }

        const movieDir = path.dirname(movie.file_path);
        const movieName = path.basename(movie.file_path, path.extname(movie.file_path));
        const srtPath = path.join(movieDir, `${movieName}.srt`);
        const vttPath = path.join(movieDir, `${movieName}.vtt`);

        if (fs.existsSync(srtPath)) {
            return res.json({ 
                found: true, 
                path: srtPath, 
                type: 'local',
                label: 'Local (SRT)'
            });
        }

        if (fs.existsSync(vttPath)) {
            return res.json({ 
                found: true, 
                path: vttPath, 
                type: 'local',
                label: 'Local (VTT)'
            });
        }

        res.json({ found: false });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Folders Management ────────────────────────────────────────────────────────
app.get('/api/folders', sessionMiddleware, async (req, res) => {
    try {
        const folders = await db.getFolders();
        res.json(folders);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/folders', sessionMiddleware, adminMiddleware, async (req, res) => {
    const { folder_path } = req.body;
    if (!folder_path) return res.status(400).json({ error: 'Falta la ruta de la carpeta' });
    try {
        await db.addFolder(folder_path);
        // Trigger an initial scan in the background

        // Non-blocking scan
        (async () => {
            try {
                const files = await scanDirectory(folder_path);
                for (const file of files) {
                    const { clean_title, year } = normalizeFilename(file.file_name);
                    const movie = await searchMovie(clean_title, year);
                    let metadata = {};
                    if (movie) {
                        metadata = await getMovieDetails(movie.id);
                    }
                    
                    const existing = await db.findMovies({ file_name: file.file_name });
                    let dbResult;
                    if (existing && existing.length > 0) {
                        const existingId = existing[0].id;
                        const updatePayload = { ...file, ...metadata };
                        delete updatePayload.id;
                        await db.updateMovie(existingId, updatePayload);
                        dbResult = [{ ...existing[0], ...updatePayload }];
                    } else {
                        dbResult = await db.addMovie({ ...file, ...metadata });
                    }

                    if (dbResult && dbResult.length > 0) {
                        const movieRow = dbResult[0];
                        if (!movieRow.drive_file_id) {
                            const ext = path.extname(movieRow.file_path).toLowerCase();
                            const mimeType = { '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm' }[ext] || 'video/mp4';
                            uploadManager.enqueue(
                                movieRow.id,
                                movieRow.official_title || movieRow.detected_title || movieRow.file_name,
                                movieRow.file_path,
                                mimeType,
                                { deleteAfter: false }
                            );
                        }
                        console.log(`[Scanner] Progreso: Procesada película "${movieRow.detected_title}" (${movieRow.file_path})`);
                    }
                }
                console.log(`[Scanner] Initial scan complete for: ${folder_path}`);
            } catch (err) {
                console.error('[Scanner] Background scan failed:', err);
            }
        })();

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/folders', sessionMiddleware, adminMiddleware, async (req, res) => {
    const { folder_path } = req.body;
    try {
        await db.removeFolder(folder_path);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── Library Management ───────────────────────────────────────────────────────
app.post('/api/library/refresh', sessionMiddleware, adminMiddleware, async (req, res) => {
    try {
        const folders = await db.getFolders();

        (async () => {
            try {
                for (const folder of folders) {
                    const files = await scanDirectory(folder.folder_path);
                    for (const file of files) {
                        try {
                            const { clean_title, year } = normalizeFilename(file.file_name);
                            const movie = await searchMovie(clean_title, year);
                            let metadata = {};
                            if (movie) {
                                metadata = await getMovieDetails(movie.id);
                            }

                            const existing = await db.findMovies({ file_name: file.file_name });
                            let dbResult;
                            if (existing && existing.length > 0) {
                                const existingId = existing[0].id;
                                const updatePayload = { ...file, ...metadata };
                                delete updatePayload.id;
                                await db.updateMovie(existingId, updatePayload);
                                dbResult = [{ ...existing[0], ...updatePayload }];
                            } else {
                                dbResult = await db.addMovie({ ...file, ...metadata });
                            }

                            if (dbResult && dbResult.length > 0) {
                                const movieRow = dbResult[0];
                                if (!movieRow.drive_file_id) {
                                    const ext = path.extname(movieRow.file_path).toLowerCase();
                                    const mimeType = { '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm' }[ext] || 'video/mp4';
                                    uploadManager.enqueue(
                                        movieRow.id,
                                        movieRow.official_title || movieRow.detected_title || movieRow.file_name,
                                        movieRow.file_path,
                                        mimeType,
                                        { deleteAfter: false }
                                    );
                                }
                                console.log(`[Scanner] Progreso: Procesada película "${movieRow.detected_title || movieRow.file_name}"`);
                            }
                        } catch (movieErr) {
                            console.error(`[Scanner] Error adding movie ${file.file_name}:`, movieErr);
                        }
                    }
                }
                console.log('[Scanner] Full library refresh complete');
            } catch (err) {
                console.error('[Scanner] Full library refresh failed:', err);
            }
        })();

        res.json({ success: true, message: 'Escaneo iniciado en segundo plano' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Scanning & Library
app.get('/api/library/scan', sessionMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { path: scanPath } = req.query;
        const results = await scanDirectory(scanPath);
        for (const movie of results) {
            await addMovie(movie);
        }
        res.json({ message: 'Escaneo completado', count: results.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Discovey & Download
app.use('/api/discover', sessionMiddleware, discoverRouter);

app.post('/api/library/clear', sessionMiddleware, adminMiddleware, async (req, res) => {
    try {
        await db.clearMovies();
        await db.clearFolders();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/movies/:id', sessionMiddleware, adminMiddleware, async (req, res) => {
    const { id } = req.params;

    try {
        // 1. Get movie info to see if it has a Drive file
        const movies = await db.findMovies({ id });
        if (!movies || movies.length === 0) return res.status(404).json({ error: 'Película no encontrada' });
        
        const movie = movies[0];
        
        // 2. If it has a Drive ID, delete it (trash it)
        if (movie.drive_file_id) {
            try {
                await driveApi.deleteFile(movie.drive_file_id);
                console.log(`[Server] Archivo de Drive ${movie.drive_file_id} movido a la papelera`);
            } catch (err) {
                console.warn(`[Server] No se pudo borrar de Drive (quizás ya no existe):`, err.message);
                // We continue anyway to at least remove it from the DB
            }
        }

        // 3. Delete from Supabase
        await db.deleteMovie(id);
        console.log(`[Server] Película con ID ${id} borrada de la base de datos`);

        res.json({ success: true, message: 'Película eliminada correctamente' });
    } catch (e) {
        console.error('[Server] Error al borrar película:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ─── Remote Filesystem Browsing ───────────────────────────────────────────────
app.get('/api/fs/home', sessionMiddleware, adminMiddleware, (req, res) => {
    const home = os.homedir();
    const commonFolders = [
        { name: 'Escritorio', path: path.join(home, 'Desktop') },
        { name: 'Descargas', path: path.join(home, 'Downloads') },
        { name: 'Documentos', path: path.join(home, 'Documents') },
        { name: 'Videos', path: path.join(home, 'Videos') },
        { name: 'CineVault', path: path.join(home, 'CineVault') }
    ].filter(f => fs.existsSync(f.path));

    res.json({ home, commonFolders });
});

app.get('/api/fs/drives', sessionMiddleware, adminMiddleware, (req, res) => {
    if (process.platform !== 'win32') {
        return res.json(['/']);
    }
    const { exec } = require('child_process');
    // Use PowerShell instead of deprecated wmic
    // Add timeout to prevent hanging
    const timeout = setTimeout(() => {
        res.status(500).json({ error: 'Timeout getting drives' });
    }, 5000);
    
    exec('powershell "Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Name"', { timeout: 5000 }, (error, stdout) => {
        clearTimeout(timeout);
        if (error) return res.status(500).json({ error: error.message });
        const drives = stdout.split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.length === 1)
            .map(drive => `${drive}:\\`);
        res.json(drives);
    });
});

app.get('/api/fs/ls', sessionMiddleware, adminMiddleware, (req, res) => {
    let dirPath = req.query.path || (process.platform === 'win32' ? 'C:\\' : '/');
    
    // Security: prevent path traversal
    // Normalize and verify the path stays within reasonable bounds
    try {
        const normalized = path.normalize(dirPath);
        // Reject paths with parent directory references
        if (normalized.includes('..')) {
            return res.status(400).json({ error: 'Invalid path' });
        }
        dirPath = normalized;
    } catch (e) {
        return res.status(400).json({ error: 'Invalid path' });
    }
    
    try {
        if (!fs.existsSync(dirPath)) return res.status(404).json({ error: 'Ruta no encontrada' });
        
        const files = fs.readdirSync(dirPath, { withFileTypes: true });
        const folders = files
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name)
            .sort((a, b) => a.localeCompare(b));
            
        res.json({
            currentPath: path.resolve(dirPath),
            folders: folders,
            sep: path.sep
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── User Progress & MyList ─────────────────────────────────────────────────────
// ADMIN_EMAIL moved to top for better accessibility

app.get('/api/user/progress', sessionMiddleware, async (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    
    try {
        const progress = await db.getUserProgress(userId);
        res.json(progress);
    } catch (err) {
        console.error('[UserProgress] Error:', err);
        res.status(500).json({ error: 'Failed to get progress' });
    }
});

app.post('/api/user/progress', sessionMiddleware, async (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    
    const { movie_id, watched_duration } = req.body;
    if (!movie_id) return res.status(400).json({ error: 'movie_id required' });
    
    // Validate and sanitize input
    const sanitizedMovieId = parseInt(movie_id, 10);
    if (isNaN(sanitizedMovieId) || sanitizedMovieId < 1) {
        return res.status(400).json({ error: 'Invalid movie_id' });
    }
    
    // Cap watched_duration at 24 hours max
    let sanitizedDuration = parseInt(watched_duration, 10) || 0;
    if (sanitizedDuration < 0) sanitizedDuration = 0;
    if (sanitizedDuration > 86400) sanitizedDuration = 86400;
    
    try {
        await db.saveUserProgress(userId, sanitizedMovieId, sanitizedDuration);
        res.json({ success: true });
    } catch (err) {
        console.error('[UserProgress] Save error:', err);
        res.status(500).json({ error: 'Failed to save progress' });
    }
});

app.get('/api/user/mylist', sessionMiddleware, async (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    
    try {
        const mylist = await db.getUserMylist(userId);
        res.json(mylist);
    } catch (err) {
        console.error('[UserMylist] Error:', err);
        res.status(500).json({ error: 'Failed to get mylist' });
    }
});

app.post('/api/user/mylist', sessionMiddleware, async (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    
    const { movie_id } = req.body;
    if (!movie_id) return res.status(400).json({ error: 'movie_id required' });
    
    // Validate movie_id
    const sanitizedMovieId = parseInt(movie_id, 10);
    if (isNaN(sanitizedMovieId) || sanitizedMovieId < 1) {
        return res.status(400).json({ error: 'Invalid movie_id' });
    }
    
    try {
        await db.addToMylist(userId, sanitizedMovieId);
        res.json({ success: true });
    } catch (err) {
        console.error('[UserMylist] Add error:', err);
        res.status(500).json({ error: 'Failed to add to mylist' });
    }
});

app.delete('/api/user/mylist/:movieId', sessionMiddleware, async (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    
    const { movieId } = req.params;
    
    // Validate movieId
    const sanitizedMovieId = parseInt(movieId, 10);
    if (isNaN(sanitizedMovieId) || sanitizedMovieId < 1) {
        return res.status(400).json({ error: 'Invalid movieId' });
    }
    
    try {
        await db.removeFromMylist(userId, sanitizedMovieId);
        res.json({ success: true });
    } catch (err) {
        console.error('[UserMylist] Remove error:', err);
        res.status(500).json({ error: 'Failed to remove from mylist' });
    }
});

// ─── Movie Uploads ─────────────────────────────────────────────────────────────
app.post('/api/movies/upload', sessionMiddleware, adminMiddleware, movieUpload.array('files'), async (req, res) => {
    try {
        console.log(`[Upload] Received ${req.files?.length} files`);
        
        // Trigger background scan to catch the new files
        setTimeout(() => {
            console.log('[Upload] Triggering library scan...');
            scanDirectory()
                .then(() => console.log('[Upload] Auto-scan completed'))
                .catch(err => console.error('[Upload] Auto-scan error:', err));
        }, 1000);

        res.json({ 
            success: true, 
            message: 'Subida completada con éxito. Procesando películas...',
            files: req.files?.map(f => f.originalname) 
        });
    } catch (err) {
        console.error('[Upload] Error processing files:', err);
        res.status(500).json({ error: 'Error al procesar los archivos subidos' });
    }
});

// ─── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', version: '1.0.0' }));


// --- Config Management ---

// --- Config Management ---
app.get('/api/admin/config/rd-token', adminMiddleware, (req, res) => {
    res.json({ token: process.env.REAL_DEBRID_API_TOKEN || '' });
});

app.post('/api/admin/config/rd-token', adminMiddleware, (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token requerido' });
    
    // In a real app we'd save to DB, for now we update process.env and ideally the .env file
    process.env.REAL_DEBRID_API_TOKEN = token;
    
    // Save to .env file for persistence
    const fs = require('fs');
    const path = require('path');
    const envPath = path.resolve(__dirname, '../.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
        if (envContent.includes('REAL_DEBRID_API_TOKEN=')) {
            envContent = envContent.replace(/REAL_DEBRID_API_TOKEN=.*/, `REAL_DEBRID_API_TOKEN=${token}`);
        } else {
            envContent += `\nREAL_DEBRID_API_TOKEN=${token}`;
        }
    } else {
        envContent = `REAL_DEBRID_API_TOKEN=${token}`;
    }
    fs.writeFileSync(envPath, envContent);
    
    res.json({ message: 'Token de Real-Debrid actualizado correctamente' });
});

// --- Config Management ---
app.get('/api/admin/config/rd-token', sessionMiddleware, adminMiddleware, (req, res) => {
    res.json({ token: process.env.REAL_DEBRID_API_TOKEN || '' });
});

app.post('/api/admin/config/rd-token', sessionMiddleware, adminMiddleware, (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token requerido' });
    process.env.REAL_DEBRID_API_TOKEN = token;
    
    const envPath = path.resolve(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, 'utf8');
        if (envContent.includes('REAL_DEBRID_API_TOKEN=')) {
            envContent = envContent.replace(/REAL_DEBRID_API_TOKEN=.*/, `REAL_DEBRID_API_TOKEN=${token}`);
        } else {
            envContent += `\nREAL_DEBRID_API_TOKEN=${token}`;
        }
        fs.writeFileSync(envPath, envContent);
    }
    res.json({ message: 'Token de Real-Debrid actualizado' });
});

app.get('/api/admin/config/tmdb-key', sessionMiddleware, adminMiddleware, (req, res) => {
    res.json({ key: process.env.TMDB_API_KEY || '' });
});

app.post('/api/admin/config/tmdb-key', sessionMiddleware, adminMiddleware, (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'Key requerida' });
    process.env.TMDB_API_KEY = key;
    
    const envPath = path.resolve(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, 'utf8');
        if (envContent.includes('TMDB_API_KEY=')) {
            envContent = envContent.replace(/TMDB_API_KEY=.*/, `TMDB_API_KEY=${key}`);
        } else {
            envContent += `\nTMDB_API_KEY=${key}`;
        }
        fs.writeFileSync(envPath, envContent);
    }
    res.json({ message: 'API Key de TMDB actualizada' });
});

app.use('/api/discover', discoverRouter);

// Support SPA routing (must be AFTER static and API routes)
app.get('*splat', (req, res) => {
    if (req.path.includes('.') || req.path.startsWith('/assets/')) {
        return res.status(404).send('Not Found');
    }
    
    const indexPath = path.join(__dirname, '../dist/index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(502).send('Frontend not built yet. Please wait for the build process to finish on Railway.');
    }
});

const server = app.listen(PORT, () => {
    console.log(`[CineVault Backend] Running on http://localhost:${PORT}`);
});
server.timeout = 600000; // 10 minutes in ms
