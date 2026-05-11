/**
 * CineVault Web Backend Server
 * Standalone Express server — runs on Railway (or locally for development)
 * Exposes the same functionality as the Electron main process, but as HTTP endpoints.
 */

import dotenv from 'dotenv'
dotenv.config()
import { searchAll, searchGlobal, searchSubtitlesFallback } from './movieSearcher'
import debridManager from './debridManager'
import { PassThrough } from 'stream'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import os from 'os'
import http from 'http'
import mime from 'mime-types'
import cookieParser from 'cookie-parser'
import iconv from 'iconv-lite'
import chardet from 'chardet'
import axios from 'axios'
import ffmpeg from 'fluent-ffmpeg'

import driveApi from './drive'
import db from './db'
import { searchMovie, getMovieDetails, getOMDbDetails } from './tmdb'
import { getTranscodeStream, probeAudioTracks } from './optimizer'
import discoverRouter from './discover'
import uploadManager from './uploadManager'
import { fetchMovieNews } from './newsService'
import { exec } from 'child_process'
import { normalizeFilename } from './parser'
import { scanDirectory } from './scanner'
import { sessionMiddleware, adminMiddleware } from './middleware'

// Load persistent config from DB on startup
(async () => {
    try {
        // 1. OpenSubtitles
        const osConfig = await db.getGlobalConfig('OS_CREDENTIALS') as { username?: string; password?: string } | undefined;
        if (osConfig) {
            process.env.OS_USERNAME = osConfig.username || process.env.OS_USERNAME;
            process.env.OS_PASSWORD = osConfig.password || process.env.OS_PASSWORD;
        }

        // 2. Real-Debrid
        const rdConfig = await db.getGlobalConfig('RD_TOKEN') as { token?: string } | undefined;
        if (rdConfig) {
            process.env.REAL_DEBRID_API_TOKEN = rdConfig.token || process.env.REAL_DEBRID_API_TOKEN;
        }

        // 3. TMDB
        const tmdbConfig = await db.getGlobalConfig('TMDB_KEY') as { key?: string } | undefined;
        if (tmdbConfig) {
            process.env.TMDB_API_KEY = tmdbConfig.key || process.env.TMDB_API_KEY;
        }

        const omdbConfig = await db.getGlobalConfig('OMDB_KEY') as { key?: string } | undefined;
        if (omdbConfig) {
            process.env.OMDB_API_KEY = omdbConfig.key || process.env.OMDB_API_KEY;
        }

        console.log('[Server] Persistent configurations loaded from Database');
    } catch (e) {
        console.error('[Server] Failed to load config from DB:', e.message);
    }
})();

const app = express();
const PORT = process.env.PORT || 3001;

// Validate critical environment variables on startup
const REQUIRED_ENV_VARS = ['TMDB_API_KEY', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];
REQUIRED_ENV_VARS.forEach(key => {
    if (!process.env[key]) {
        console.warn(`[Server] WARNING: Required env var "${key}" is not set. Related features will fail.`);
    }
});
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.warn('[Server] WARNING: Google OAuth credentials not configured. Drive features will be unavailable.');
}

const isAdmin = (email: string) => email === (process.env.ADMIN_EMAIL || 'admin@cinevault.local');

// Cache for OpenSubtitles tokens
let osTokenCache = {
    token: null,
    expiresAt: 0
};

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
    const { path: rawPath, index } = req.query;
    if (!rawPath || index === undefined) return res.status(400).send('Missing params');
    const rawPathStr = rawPath as string;
    const filePath = path.resolve(rawPathStr);
    if (filePath !== rawPathStr && rawPathStr.includes('..')) return res.status(403).send('Forbidden');
    
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
    const rawPath = req.query.path as string;
    if (!rawPath) return res.status(400).send('Missing path');
    const filePath = path.resolve(rawPath);
    if (filePath !== rawPath && rawPath.includes('..')) return res.status(403).send('Forbidden');
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

const getCallbackUrl = (req: any): string => {
  const origin = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`
  return `${origin}/api/auth/callback`
}

app.get('/api/auth/google', (req, res) => {
    const redirectUri = getCallbackUrl(req)
    const authUrl = driveApi.getAuthUrl(redirectUri)
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
        const redirectUri = getCallbackUrl(req)
        const tokens = await driveApi.getTokens(code as string, redirectUri);
        driveApi.getOAuthClient().setCredentials(tokens);
        res.send('<h1>CineVault conectado con éxito</h1><script>setTimeout(window.close, 1000)</script>');
    } catch (error) {
        console.error('[Auth Callback] Error:', (error as any).message);
        res.status(500).send(`Error al conectar con Drive: ${(error as any).message}`);
    }
});

app.get('/api/auth/status', (req, res) => {
    res.json({ authenticated: driveApi.isAuthenticated() });
});

// High-Performance Raw Stream Proxy (Used by FFmpeg for stable streaming)
app.get('/api/drive/raw/:fileId', async (req, res) => {
    const { fileId } = req.params;
    const startByte = req.query.start || 0;
    
    try {
        const stream = await driveApi.getStream(fileId, {
            headers: { 'Range': `bytes=${startByte}-` }
        });
        
        // Pass through essential headers
        res.set({
            'Content-Type': 'video/mp4', // Generic hint
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*'
        });
        
        stream.pipe(res);
        
        req.on('close', () => {
            if ((stream as any).destroy) (stream as any).destroy();
        });
    } catch (err) {
        console.error('[RawProxy] Error:', err.message);
        res.status(500).send(err.message);
    }
});

// User Session Management
app.post('/api/auth/register-session', async (req, res) => {
    const { userId, email } = req.body;
    if (!userId || !email) return res.status(400).json({ error: 'UserId y Email requeridos' });

    const userAgent = req.headers['user-agent'] as string;
    const ip = (req.ip || req.headers['x-forwarded-for']) as string;

    try {
        const result = await db.registerSession(userId, email, userAgent, ip);
        const session = Array.isArray(result) ? result[0] : result;
        if (!session) return res.status(500).json({ error: 'Session creation failed' });
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
        await db.deleteSession(req.params.id as string);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Error eliminando sesión' });
    }
});

// ─── Movie Audio Tracks ──────────────────────────────────────────────────────────
app.get('/api/movies/:id/audio-tracks', sessionMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const cached: any = await db.getGlobalConfig(`AUDIO_TRACKS_${id}`);
        if (cached && cached.length > 0) {
            console.log(`[Server] Returning cached audio tracks for movie ${id} (${cached.length} tracks)`);
            return res.json(cached);
        }

        const movies = await db.findMovies({ id });
        if (!movies || movies.length === 0) return res.status(404).json({ error: 'Movie not found' });
        const movie = movies[0];

        if (!movie.drive_file_id) return res.json([]);

        
        let url = `https://www.googleapis.com/drive/v3/files/${movie.drive_file_id}?alt=media&supportsAllDrives=true`;
        let headers = null;

        if (driveApi.isAuthenticated()) {
            const token = await driveApi.getAccessToken();
            headers = `Authorization: Bearer ${token}`;
        } else if (process.env.GOOGLE_API_KEY) {
            url += `&key=${process.env.GOOGLE_API_KEY}`;
        } else {
            throw new Error('Drive no está autenticado y no hay GOOGLE_API_KEY disponible.');
        }
        
        console.log(`[Server] Probing audio tracks for ${movie.official_title}...`);
        const tracks = await probeAudioTracks(url, headers);
        console.log(`[Server] Found ${tracks.length} audio tracks for ${movie.official_title}`);
        
        await db.setGlobalConfig(`AUDIO_TRACKS_${id}`, tracks);
        res.json(tracks);
    } catch (e) {
        console.error('[Server] Error fetching audio tracks:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ─── Drive Streaming ──────────────────────────────────────────────────────────
app.get('/api/drive/stream/:fileId', sessionMiddleware, async (req, res) => {
    if (!driveApi.isAuthenticated()) {
        return res.status(401).json({ error: 'Drive no conectado. Inicia sesión para ver películas.' });
    }
    const fileId = req.params.fileId as string;
    const range = req.headers.range as string;
    const isSafariUA = /^((?!chrome|android).)*safari/i.test(req.headers['user-agent'] || '');
    const fmp4 = req.query.fmp4 === 'true' || isSafariUA;
    const transcode = fmp4 ? false : (req.query.transcode === 'true');
    const startTime = req.query.t || 0;
    const audioTrack = req.query.audio || null;
    
    try {
        if (fileId === 'pending_cloud') {
            return res.status(202).json({ 
                status: 'processing', 
                message: 'La película de la Bóveda Global todavía se está procesando. Reintenta en unos minutos.' 
            });
        }
        await driveApi.streamVideo(fileId, range, res, { transcode, fmp4, t: startTime as any, audioTrack: audioTrack as any });
    } catch (err) {
        console.error('[Server] Drive streaming route error:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error interno de servidor', message: err.message });
        }
    }
});

app.get('/api/drive/hls/:fileId/playlist.m3u8', sessionMiddleware, async (req, res) => {
    if (!driveApi.isAuthenticated()) {
        return res.status(401).json({ error: 'Drive no conectado.' });
    }
    const fileId = req.params.fileId as string;
    const startTime = parseFloat(String(req.query.t || 0));

    try {
        const startTs = Date.now();
        await driveApi.ensureHlsSegments(fileId, startTime);
        const playlistPath = driveApi.getHlsPlaylistPath(fileId);
        if (!playlistPath) {
            return res.status(500).json({ error: 'HLS generation failed' });
        }
        const playlist = fs.readFileSync(playlistPath, 'utf-8');
        console.log(`[HLS] Playlist served for ${fileId} in ${Date.now() - startTs}ms`);
        res.writeHead(200, {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'max-age=3600',
        });
        res.end(playlist);
    } catch (err) {
        console.error('[HLS] Playlist error:', err.message);
        if (!res.headersSent) res.status(500).json({ error: 'HLS error', message: err.message });
    }
});

app.get('/api/drive/hls/:fileId/segments/:segment', sessionMiddleware, async (req, res) => {
    if (!driveApi.isAuthenticated()) {
        return res.status(401).json({ error: 'Drive no conectado.' });
    }
    const fileId = req.params.fileId as string;
    const segment = req.params.segment as string;

    const segPath = driveApi.getHlsSegmentPath(fileId, segment);
    if (!segPath) {
        return res.status(404).json({ error: 'Segmento no encontrado' });
    }

    const stat = fs.statSync(segPath);
    res.writeHead(200, {
        'Content-Type': 'video/MP2T',
        'Content-Length': stat.size,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'max-age=86400',
    });
    fs.createReadStream(segPath).pipe(res);
});

// ─── Local Streaming ──────────────────────────────────────────────────────────
app.get('/api/debug/ffmpeg-logs', (req, res) => {
    const logFile = path.join(__dirname, '../scratch/ffmpeg.log');
    if (fs.existsSync(logFile)) {
        res.setHeader('Content-Type', 'text/plain');
        res.sendFile(logFile);
    } else {
        res.status(404).send('No logs found');
    }
});

app.get('/api/stream/local', (req, res) => {
    const rawPath = req.query.path;
    const transcode = req.query.transcode === 'true';
    const startTime = parseFloat((req.query.t || '0') as string);

    console.log(`[Stream] Request: ${rawPath}, Transcode: ${transcode}, Start: ${startTime}`);

    if (!rawPath) {
        console.error('[Stream] No path provided');
        return res.status(400).send('Path is required');
    }

    // Path traversal protection
    const rawPathStr = rawPath as string;
    const filePath = path.resolve(rawPathStr);
    if (filePath !== rawPathStr && rawPathStr.includes('..')) {
        console.error('[Stream] Path traversal detected:', rawPath);
        return res.status(403).send('Forbidden');
    }

    if (!fs.existsSync(filePath)) {
        console.error('[Stream] File not found:', filePath);
        return res.status(404).send('File not found');
    }

    console.log(`[Stream] Streaming ${filePath} (transcode=${transcode}, start=${startTime}s)`);

    if (transcode) {
        
        const range = req.headers.range;
        
        // Safari Probe handling (bytes=0-1) - respond with progressive download (200), not ranged (206)
        // Safari's range-based requests are incompatible with transcoding (each Range request starts
        // a new FFmpeg process, byte offsets never align). 200 OK tells Safari to use progressive download.
        if (range === 'bytes=0-1') {
            res.writeHead(200, { 
                'Content-Type': 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"', 
                'Access-Control-Allow-Origin': '*',
                'X-Accel-Buffering': 'no',
                'Connection': 'keep-alive',
                'Cache-Control': 'no-cache'
            });
            const quality = (req.query.quality || '720') as string;
            const transcodeStream = getTranscodeStream(filePath, startTime, quality);
            transcodeStream.pipe(res);
            res.on('close', () => {
                if ((transcodeStream as any).ffmpegCommand) (transcodeStream as any).ffmpegCommand.kill();
            });
            return;
        }

        res.writeHead(200, { 
            'Content-Type': 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"', 
            'Access-Control-Allow-Origin': '*',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache'
        });    
        
        const quality = (req.query.quality || '720') as string;
        const transcodeStream = getTranscodeStream(filePath, startTime, quality);
        transcodeStream.pipe(res);

        res.on('close', () => {
           if ((transcodeStream as any).ffmpegCommand) (transcodeStream as any).ffmpegCommand.kill();
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

    const onProgress = (data: any) => {
        if (String(data.movieId) === String(movieId)) {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
    };
    const onDone = (job: any) => {
        if (String(job.movieId) === String(movieId)) {
            res.write(`data: ${JSON.stringify({ progress: 100, status: 'done', isOptimizing: false })}\n\n`);
        }
    };
    const onError = (job: any) => {
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
        const mimeType = req.file!.mimetype || 'video/mp4';
        let title = `Película ${movieId}`;
        try {
            const movies = await db.findMovies({ id: movieId });
            if (movies && movies.length > 0) title = movies[0].official_title || movies[0].detected_title || title;
        } catch (err) {
            console.warn('[Upload] Could not fetch movie title:', err.message);
        }

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
        const files = await driveApi.list((folderId || 'root') as string);
        res.json({ files });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/subtitles/drive', async (req, res) => {
    try {
        const { fileId } = req.query;
        if (!fileId) return res.status(400).json({ error: 'Missing fileId' });
        
        const content = await driveApi.getFileContent(fileId as string);
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
        res.status(404).json({ error: 'Tarea no encontrada o no está en estado de error' });
    }
});

// --- Instant Play & Stuck Uploads ---

/**
 * Endpoint para reproducción instantánea redirigiendo al Cloud Source (Real-Debrid)
 */
app.get('/api/drive/stream-cloud/:movieId', async (req, res) => {
    const { movieId } = req.params;
    const transcode = req.query.transcode === 'true';
    const quality = (req.query.quality || '720') as string;
    const startTime = parseFloat((req.query.t || '0') as string);

    try {
        let cloudUrl = null;
        
        // 1. Buscamos primero en el uploadManager (en memoria actual)
        const job = uploadManager.getQueue().find(j => String(j.movieId) === String(movieId));
        if (job && job.isUrl && job.filePath && job.filePath.startsWith('http')) {
            cloudUrl = job.filePath;
        } else {
            // 2. Si no está en memoria, buscamos en la base de datos el campo persistente
            const movies = await db.findMovies({ id: movieId });
            if (movies && movies.length > 0 && movies[0].cloud_source_url) {
                cloudUrl = movies[0].cloud_source_url;
            }
        }

        if (!cloudUrl) {
            return res.status(404).json({ error: 'No se encontró el enlace de origen para reproducción instantánea.' });
        }

        if (transcode) {
            console.log(`[InstantPlay] Transcodificando cloud source para movie ${movieId}: ${cloudUrl}`);
            
            // Safari Probe handling (bytes=0-1) - respond with progressive download (200)
            if (req.headers.range === 'bytes=0-1') {
                res.writeHead(200, { 
                    'Content-Type': 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"', 
                    'Access-Control-Allow-Origin': '*',
                    'X-Accel-Buffering': 'no',
                    'Connection': 'keep-alive',
                    'Cache-Control': 'no-cache'
                });
                const transcodeStream = getTranscodeStream(cloudUrl, startTime, quality as string);
                transcodeStream.pipe(res);
                res.on('close', () => {
                    if ((transcodeStream as any).ffmpegCommand) (transcodeStream as any).ffmpegCommand.kill();
                });
                return;
            }

            res.writeHead(200, { 
                'Content-Type': 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"', 
                'Access-Control-Allow-Origin': '*',
                'X-Accel-Buffering': 'no',
                'Connection': 'keep-alive',
                'Cache-Control': 'no-cache'
            });    
            
            const transcodeStream = getTranscodeStream(cloudUrl, startTime, quality as string);
            transcodeStream.pipe(res);

            res.on('close', () => {
               if ((transcodeStream as any).ffmpegCommand) (transcodeStream as any).ffmpegCommand.kill();
            });
        } else {
            console.log(`[InstantPlay] Proxying cloud source para movie ${movieId}: ${cloudUrl}`);
            const range = req.headers.range;
            
            try {
                const response = await axios({
                    method: 'get',
                    url: cloudUrl,
                    responseType: 'stream',
                    headers: range ? { Range: range } : {},
                    timeout: 15000
                });

                res.status(response.status);
                // Forward essential headers for video streaming
                const headersToForward = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
                headersToForward.forEach(h => {
                    if (response.headers[h]) res.setHeader(h, response.headers[h]);
                });
                res.setHeader('Access-Control-Allow-Origin', '*');
                
                response.data.pipe(res);
                
                res.on('close', () => {
                    if (response.data.destroy) response.data.destroy();
                });
            } catch (proxyErr) {
                console.warn(`[InstantPlay] Proxy falló para ${movieId}, usando redirección como fallback:`, proxyErr.message);
                if (!res.headersSent) {
                    return res.redirect(cloudUrl);
                }
            }
        }
    } catch (e) {
        console.error('[InstantPlay] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/stuck-uploads', sessionMiddleware, adminMiddleware, async (req, res) => {
    try {
        // Buscar pelis en pending_cloud
        const movies = await db.findMovies(); // This fetches all, might be heavy but let's filter after
        const stuck = movies.filter(m => 
            m.drive_file_id === 'pending_cloud' && 
            !uploadManager.getQueue().some(j => String(j.movieId) === String(m.id))
        );
        res.json(stuck);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/retry-stuck/:movieId', sessionMiddleware, adminMiddleware, async (req, res) => {
    const { movieId } = req.params;
    try {
        const movies = await db.findMovies({ id: movieId });
        if (!movies || movies.length === 0) return res.status(404).json({ error: 'Pelicula no encontrada' });
        
        const movie = movies[0];
        if (!movie.cloud_source_url) return res.status(400).json({ error: 'No hay URL de origen para reintentar' });

        // Re-encolar
        uploadManager.enqueue(
            movie.id, 
            (movie.official_title || movie.detected_title) as string, 
            movie.cloud_source_url, 
            'video/mp4', 
            { isUrl: true, status: 'pending', options: { deleteAfter: true, optimize: false } }
        );

        res.json({ success: true, message: 'Re-encolada correctamente' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/drive/queue/:movieId', sessionMiddleware, adminMiddleware, (req, res) => {
    uploadManager.remove(req.params.movieId as string);
    res.json({ success: true });
});

app.get('/api/subtitles/local/check', sessionMiddleware, async (req, res) => {
    // Basic implementation: Always return not found for now to avoid crashes
    // In the future, this can look for sibling files in the local FS
    res.json({ found: false });
});

app.get('/api/subtitles/cloud/check', sessionMiddleware, async (req, res) => {
    const { movieId } = req.query;
    if (!movieId) return res.status(400).json({ error: 'Missing movieId' });

    try {
        const movies = await db.findMovies({ id: movieId });
        if (!movies || movies.length === 0 || !movies[0].drive_file_id) {
            return res.json({ found: false });
        }

        const movie = movies[0];
        if (movie.drive_file_id === 'pending_cloud') return res.json({ found: false });

        const driveFileId = movie.drive_file_id as string;
        
        try {
            const parentId = await driveApi.getFileParent(driveFileId);
            if (!parentId) return res.json({ found: false });

            const files = (await driveApi.list(parentId!)) || [];
            const movieBaseName = (movie.official_title || movie.detected_title || `movie_${movie.id}`).toLowerCase();
            
            // Look for .vtt or .srt files that match the movie name
            const subFile = files.find(f => {
                const name = (f.name as string).toLowerCase();
                return (name.includes(movieBaseName) || name.startsWith('sub_')) && 
                       (name.endsWith('.vtt') || name.endsWith('.srt'));
            });

            if (subFile) {
                return res.json({ 
                    found: true, 
                    fileId: subFile.id, 
                    name: subFile.name,
                    type: 'cloud'
                });
            }
        } catch (innerError) {
            console.warn('[Cloud Sub Check] Silent fail for movie', movie.id, ':', innerError.message);
            // Fall through to found: false
        }
        
        res.json({ found: false });
    } catch (e) {
        console.error('[Cloud Sub Check] Fatal Error:', e.message);
        res.json({ found: false }); // Always return JSON found:false to avoid breaking frontend
    }
});

// ─── Subtitles ────────────────────────────────────────────────────────────────
app.post('/api/subtitles/search', async (req, res) => {
    const { imdbId, title, filename, year, query: customQuery } = req.body;
    const apiKey = process.env.OPENSUBTITLES_API_KEY;
    
    let queryStr = '';
    if (customQuery) {
        queryStr = `query=${encodeURIComponent(customQuery)}`;
    } else if (imdbId) {
        queryStr = `imdb_id=${imdbId.replace('tt', '')}`;
    } else {
        queryStr = `query=${encodeURIComponent(title)}&type=movie`;
        if (year) queryStr += `&year=${year}`;
    }
    
    const url = `https://api.opensubtitles.com/api/v1/subtitles?${queryStr}&languages=es,en`;

    try {
        const headers = { 
            'Content-Type': 'application/json', 
            'User-Agent': 'CineVault v1.0', 
            'Api-Key': apiKey 
        };

        // If user has VIP credentials, we could potentially authenticate here
        // or add them to the query if the API supports it.
        // For now, we mainly need them for the DOWNLOAD step to bypass the 5/day limit.
        
        const response = await fetch(url, { headers });
        const data = await response.json();
        const movieFileNameLower = (filename || '').toLowerCase();
        const movieTitleLower = (title || '').toLowerCase();
        const combinedContext = `${movieFileNameLower} ${movieTitleLower}`;
        
        // Key keywords to match versions (YTS, RARBG, WEBRip, 1080p, etc.)
        const keywords = ['yts', 'rarbg', 'psa', 'webrip', 'web-rip', 'bluray', 'blu-ray', 'brrip', 'x264', 'x265', '1080p', '720p', 'amzn', 'nf', 'dual', 'latino', 'ac3', 'dts', 'tigole', 'qxr', 'utp'];
        const activeKeywords = keywords.filter(k => combinedContext.includes(k));

        let results = ((data as any).data || [])
            .filter((s: any) => s.attributes?.files?.length > 0)
            .filter((s: any) => {
                const ft = (s.attributes?.feature_type || '').toLowerCase();
                if (ft === 'episode') return false;
                if (s.attributes?.season_number != null) return false;
                if (s.attributes?.episode_number != null) return false;
                return true;
            })
            .map((s: any) => {
                const attr = s.attributes;
                const releaseLower = (attr.release || '').toLowerCase();
                const lang = attr.language.toLowerCase();
                
                let score = 0;
                // Language priority
                if (lang === 'es') score += 1000;
                if (lang === 'en') score += 100;

                // Penalize episode-like releases (safety net)
                if (/s\d{1,2}e\d{1,2}|season\s*\d+|episode\s*\d+/i.test(releaseLower)) score -= 5000;
                
                // version/release matching - Better scoring for release group
                activeKeywords.forEach(k => {
                    if (releaseLower.includes(k)) {
                        score += 150; // Increased weight
                        // Double bonus for technical tags like 1080p, YTS, etc.
                        if (['yts', 'rarbg', 'psa', '1080p', '720p', 'bluray'].includes(k)) score += 100;
                    }
                });

                // Check for exact movie file name components in release string
                const fileNameWords = movieTitleLower.split(/[\s._-]+/).filter((w: any) => w.length > 2);
                fileNameWords.forEach((word: any) => {
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
            .filter((s: any) => s.score > -1000) // Remove heavily penalized (episode) results
            .sort((a: any, b: any) => b.score - a.score) // Order by best score first
            .slice(0, 15); // Limit to top 15 results
        
        // If results are empty or there was an error, try fallback
        if (!results || results.length === 0) {
            const fallback = await searchSubtitlesFallback(imdbId, title);
            results = [...(results || []), ...fallback];
        }

        res.json({ data: results });
    } catch (e) {
        // Even on error, try fallback before giving up
        try {
            const imdbId = req.query.imdbId as string;
            const title = req.query.title as string;
            const fallback = await searchSubtitlesFallback(imdbId, title);
            if (fallback.length > 0) return res.json({ data: fallback });
        } catch (_) {}

        console.error('[Subtitles Search] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Route for downloading fallback subtitles (YIFY, etc)
app.get('/api/subtitles/fallback-download', sessionMiddleware, async (req, res) => {
    const { url, movieId } = req.query;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    try {
        console.log(`[Subtitles] Downloading fallback subtitle from: ${url}`);
        const response = await axios.get(url as string, { headers: { 'User-Agent': 'CineVault v1.0' }, responseType: 'arraybuffer' });
        
        // YIFY subs often return a ZIP or a page. If it's a page, we need to extract the final download link.
        // For simplicity in this version, we assume the provided URL is direct or easily clickable.
        // Actually YIFY zip downloads require a bit more logic.
        
        res.status(501).json({ error: 'Fallback download logic not fully implemented yet.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- OpenSubtitles Helpers ---

let osLoginPromise: Promise<string | null> | null = null;

async function getOpenSubtitlesHeaders() {
    const apiKey = process.env.OPENSUBTITLES_API_KEY;
    const osUser = process.env.OS_USERNAME;
    const osPass = process.env.OS_PASSWORD;
    
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'CineVault v1.0',
        'Api-Key': apiKey
    };

    if (osUser && osPass) {
        // 1. If we have a valid cached token, use it
        if (osTokenCache.token && osTokenCache.expiresAt > Date.now()) {
            (headers as any)['Authorization'] = `Bearer ${osTokenCache.token}`;
            return headers;
        }

        // 2. If a login is already in progress, wait for it
        if (osLoginPromise) {
            console.log(`[Subtitles] Waiting for in-progress VIP login for ${osUser}...`);
            const token = await osLoginPromise;
            if (token) (headers as any)['Authorization'] = `Bearer ${token}`;
            return headers;
        }

        // 3. Start a new login and lock it
        osLoginPromise = (async () => {
            try {
                console.log(`[Subtitles] Attempting VIP login for: ${osUser}...`);
                const loginRes = await fetch('https://api.opensubtitles.com/api/v1/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'User-Agent': 'CineVault v1.0',
                        'Api-Key': apiKey
                    },
                    body: JSON.stringify({ username: osUser, password: osPass })
                });
                
                const loginData: any = await loginRes.json();
                if (loginRes.ok && loginData.token) {
                    osTokenCache.token = loginData.token;
                    osTokenCache.expiresAt = Date.now() + (23 * 60 * 60 * 1000);
                    console.log(`[Subtitles] VIP login SUCCESS for ${osUser}.`);
                    return loginData.token;
                } else {
                    console.warn(`[Subtitles] VIP login REJECTED for ${osUser}:`, loginData.message || 'Unknown error');
                    return null;
                }
            } catch (loginErr) {
                console.error('[Subtitles] VIP Login ERROR:', loginErr.message);
                return null;
            } finally {
                osLoginPromise = null; // Unlock
            }
        })();

        const token = await osLoginPromise;
        if (token) (headers as any)['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

app.post('/api/subtitles/download', async (req, res) => {
    const { fileId, movieId } = req.body;
    if (!fileId) return res.status(400).json({ error: 'Missing fileId' });

    try {
        console.log(`[Subtitles] Solicitando descarga para fileId: ${fileId} (MovieId: ${movieId || 'N/A'})`);
        const headers = await getOpenSubtitlesHeaders();
        
        const response = await fetch('https://api.opensubtitles.com/api/v1/download', {
            method: 'POST',
            headers,
            body: JSON.stringify({ file_id: fileId })
        });
        
        if (!response.ok) {
            const errData: any = await response.json().catch(() => ({}));
            const msg = errData.message || errData.error || `OpenSubtitles API error: ${response.status}`;
            const isQuota = msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('downloaded your allowed');
            const status = isQuota ? 429 : 500;
            return res.status(status).json({ error: msg, isQuota });
        }
        
        const data: any = await response.json();
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
                finalBuffer = Buffer.from(iconv.encode(iconv.decode(buffer, encoding), 'utf-8'));
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
                    } else if (movie.drive_file_id && driveApi.isAuthenticated()) {
                        // Persistent cloud storage: Upload to the same Drive folder
                        try {
                            const parentId = await driveApi.getFileParent(movie.drive_file_id);
                            if (parentId) {
                                const movieName = movie.official_title || movie.detected_title || `movie_${movie.id}`;
                                console.log(`[Subtitles] Subiendo persistencia a Drive (folder: ${parentId})...`);
                                
                                // Save locally first (to temp) then upload
                                fs.writeFileSync(finalPath, finalBuffer);
                                await driveApi.uploadBasicFile(finalPath, parentId, `${movieName}.srt`);
                                
                                // Also upload VTT for web efficiency
                                const vttPath = finalPath.replace(/\.srt$/, '.vtt');
                                ffmpeg(finalPath).output(vttPath).on('end', async () => {
                                    try {
                                        await driveApi.uploadBasicFile(vttPath, parentId, `${movieName}.vtt`);
                                        console.log(`[Subtitles] Persistencia VTT completada en Drive.`);
                                    } catch (e) {
                                    console.warn('[Subtitles] Drive VTT upload failed:', e.message);
                                }
                                }).run();
                                
                                savedLocally = true; // Mark as saved so it doesn't just sit in temp
                            }
                        } catch (driveErr) {
                            console.warn('[Subtitles] Falló persistencia en Drive:', driveErr.message);
                        }
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
        } catch (vttErr) {
            console.warn('[Subtitles] Failed to start VTT conversion:', vttErr.message);
        }

        res.json({ localPath: finalPath, savedLocally, success: true });
    } catch (e) {
        console.error('[Subtitles Download] Error:', e.message);
        if (!res.headersSent) {
            const isQuota = e.message.toLowerCase().includes('quota') || e.message.toLowerCase().includes('5 subtitles');
            res.status(isQuota ? 429 : 500).json({ error: e.message, isQuota });
        }
    }
});

app.get('/api/subtitles/cloud', async (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing fileId' });
    
    try {
        // 1. Get download link with VIP headers
        const headers = await getOpenSubtitlesHeaders();
        const dlRes = await fetch('https://api.opensubtitles.com/api/v1/download', {
            method: 'POST',
            headers,
            body: JSON.stringify({ file_id: id })
        });
        
        if (!dlRes.ok) {
            const errData: any = await dlRes.json().catch(() => ({}));
            const msg = errData.message || errData.error || 'OpenSubtitles API error';
            const isQuota = msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('downloaded your allowed');
            const status = isQuota ? 429 : 500;
            return res.status(status).json({ error: msg, isQuota });
        }
        const dlData: any = await dlRes.json();
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
                finalContent = Buffer.from(iconv.decode(buffer, encoding));
            } else {
                finalContent = Buffer.from(buffer.toString('utf8'));
            }
        } catch (e) {
            finalContent = Buffer.from(buffer.toString('utf8'));
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(finalContent);
    } catch (e) {
        console.error('[Subtitles Cloud Proxy] Error:', e.message);
        if (!res.headersSent) {
            const isQuota = e.message.toLowerCase().includes('quota') || e.message.toLowerCase().includes('5 subtitles');
            res.status(isQuota ? 429 : 500).json({ error: e.message, isQuota });
        }
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
                    const movie = await searchMovie(clean_title, year as any);
                    let metadata = {};
                    if (movie) {
                        const tmdbDetails = await getMovieDetails(movie.id);
                        if (tmdbDetails) {
                            const omdbDetails = await getOMDbDetails(tmdbDetails.official_title, year as any);
                            metadata = { ...tmdbDetails, ...omdbDetails };
                        }
                    }
                    
                    const existing = await db.findMovies({ file_name: file.file_name });
                    let dbResult;
                    if (existing && existing.length > 0) {
                        const existingId = existing[0].id;
                        const updatePayload: any = { ...file, ...metadata };
                        delete updatePayload.id;
                        await db.updateMovie(existingId, updatePayload);
                        dbResult = [{ ...existing[0], ...updatePayload }];
                    } else {
                        dbResult = await db.addMovie({ ...file, ...metadata });
                    }

                    if ((dbResult as any) && (dbResult as any).length > 0) {
                        const movieRow = (dbResult as any)[0];
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
                            const movie = await searchMovie(clean_title, year as any);
                            let metadata = {};
                            if (movie) {
                                const tmdbDetails = await getMovieDetails(movie.id);
                                if (tmdbDetails) {
                                    const omdbDetails = await getOMDbDetails(tmdbDetails.official_title, year as any);
                                    metadata = { ...tmdbDetails, ...omdbDetails };
                                }
                            }

                            const existing = await db.findMovies({ file_name: file.file_name });
                            let dbResult;
                            if (existing && existing.length > 0) {
                                const existingId = existing[0].id;
                                const updatePayload: any = { ...file, ...metadata };
                                delete updatePayload.id;
                                await db.updateMovie(existingId, updatePayload);
                                dbResult = [{ ...existing[0], ...updatePayload }];
                            } else {
                                dbResult = await db.addMovie({ ...file, ...metadata });
                            }

                            if ((dbResult as any) && (dbResult as any).length > 0) {
                                const movieRow = (dbResult as any)[0];
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
        const scanPath = req.query.path as string;
        const results = await scanDirectory(scanPath);
        for (const movie of results) {
            await db.addMovie(movie as any);
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

app.patch('/api/movies/:id', sessionMiddleware, adminMiddleware, async (req, res) => {
    const id = req.params.id as string;
    const updates = req.body;
    
    try {
        await db.updateMovie(parseInt(id, 10), updates);
        res.json({ success: true, message: 'Información actualizada correctamente' });
    } catch (e) {
        console.error('[Server] Error al actualizar película:', e.message);
        res.status(500).json({ error: 'Error al actualizar información' });
    }
});

app.post('/api/admin/refresh-all-metadata', sessionMiddleware, adminMiddleware, async (req, res) => {
    try {
        const movies = await db.getMovies();
        console.log(`[Metadata Refresh] Starting full refresh for ${movies.length} movies...`);
        
        // Use a background process to avoid blocking
        (async () => {
            for (const movie of movies) {
                try {
                    const localTitle = movie.official_title || movie.detected_title;
                    const year = movie.detected_year;
                    
                    if (localTitle) {
                        // 1. Try to find the English/Original title via TMDb if we don't have it
                        // This helps OMDb find the movie much more reliably
                        let fallbackTitle = null;
                        try {
                            const tmdbMatch = await searchMovie(localTitle, year);
                            if (tmdbMatch) {
                                fallbackTitle = tmdbMatch.original_title;
                                // If it's the same, don't bother
                                if (fallbackTitle === localTitle) fallbackTitle = null;
                            }
                        } catch (tmdbErr) {
                            console.warn(`[Metadata Refresh] TMDb lookup failed for ${localTitle}:`, tmdbErr.message);
                        }

                        // 2. Fetch from OMDb (with fallback support)
                        const omdbDetails = await getOMDbDetails(localTitle, year, fallbackTitle);
                        if (omdbDetails) {
                            await db.updateMovie(movie.id, omdbDetails as unknown as Record<string, unknown>);
                            console.log(`[Metadata Refresh] Updated ratings for: "${localTitle}" ${fallbackTitle ? `(via ${fallbackTitle})` : ''}`);
                        }
                    }
                    // Throttling to avoid rate limits
                    await new Promise(resolve => setTimeout(resolve, 800));
                } catch (err) {
                    console.error(`[Metadata Refresh] Error on movie ${movie.id}:`, err.message);
                }
            }
            console.log('[Metadata Refresh] Full library refresh complete');
        })();

        res.json({ success: true, message: 'Refresco de metadatos iniciado en segundo plano' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/movies/:id/re-identify', sessionMiddleware, adminMiddleware, async (req, res) => {
    const id = req.params.id as string;
    const { title, year } = req.body;
    
    if (!title) return res.status(400).json({ error: 'Título requerido para re-identificar' });
    
    try {
        console.log(`[Server] Re-identificando película ID ${id} con título sugerido: "${title}"`);
        
        // 1. Search TMDB
        const searchResult = await searchMovie(title, year);
        if (!searchResult) {
            return res.status(404).json({ error: 'No se encontró coincidencia en TMDB para ese título' });
        }
        
        // 2. Get full details
        const tmdbDetails = await getMovieDetails(searchResult.id);
        if (!tmdbDetails) {
            return res.status(500).json({ error: 'Error al obtener detalles del match de TMDB' });
        }
        
        const omdbDetails = await getOMDbDetails(tmdbDetails.official_title, year, tmdbDetails.original_title);
        const details = { ...tmdbDetails, ...omdbDetails };
        
        // 3. Update DB
        await db.updateMovie(parseInt(id, 10), details);
        
        res.json({ 
            success: true, 
            message: `Película re-identificada como "${details.official_title}"`,
            details 
        });
    } catch (e) {
        console.error('[Server] Error en re-identification:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/movies/:id', sessionMiddleware, adminMiddleware, async (req, res) => {
    const id = req.params.id as string;

    try {
        // 1. Get movie info to see if it has a Drive file
        const movies = await db.findMovies({ id });
        if (!movies || movies.length === 0) return res.status(404).json({ error: 'Película no encontrada' });
        
        const movie = movies[0];
        
        // 2. If it has a Drive ID, delete it (trash it)
        if (movie.drive_file_id) {
            try {
                await (driveApi as any).deleteFile(movie.drive_file_id);
                console.log(`[Server] Archivo de Drive ${movie.drive_file_id} movido a la papelera`);
            } catch (err) {
                console.warn(`[Server] No se pudo borrar de Drive (quizás ya no existe):`, err.message);
                // We continue anyway to at least remove it from the DB
            }
        }

        // 3. Delete from Supabase
        await db.deleteMovie(parseInt(id, 10));
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
        const normalized = path.normalize(dirPath as string);
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
        const progress = await db.getUserProgress(userId as string);
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
        await db.saveUserProgress(userId as string, sanitizedMovieId, sanitizedDuration);
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
        const mylist = await db.getUserMylist(userId as string);
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
        await db.addToMylist(userId as string, sanitizedMovieId);
        res.json({ success: true });
    } catch (err) {
        console.error('[UserMylist] Add error:', err);
        res.status(500).json({ error: 'Failed to add to mylist' });
    }
});

app.delete('/api/user/mylist/:movieId', sessionMiddleware, async (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    
    const movieId = req.params.movieId as string;
    
    // Validate movieId
    const sanitizedMovieId = parseInt(movieId, 10);
    if (isNaN(sanitizedMovieId) || sanitizedMovieId < 1) {
        return res.status(400).json({ error: 'Invalid movieId' });
    }
    
    try {
        await db.removeFromMylist(userId as string, sanitizedMovieId);
        res.json({ success: true });
    } catch (err) {
        console.error('[UserMylist] Remove error:', err);
        res.status(500).json({ error: 'Failed to remove from mylist' });
    }
});

app.get('/api/user/rating/:movieId', sessionMiddleware, async (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    
    try {
        const rating = await db.getUserRating(userId as string, parseInt(req.params.movieId as string, 10));
        res.json({ rating });
    } catch (err) {
        console.error('[UserRating] Get error:', err);
        res.status(500).json({ error: 'Failed to get rating' });
    }
});

app.post('/api/user/rating', sessionMiddleware, async (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    
    const { movie_id, rating } = req.body;
    if (!movie_id || !rating) return res.status(400).json({ error: 'movie_id and rating required' });
    
    try {
        await db.saveUserRating(userId as string, movie_id, parseInt(rating));
        res.json({ success: true });
    } catch (err) {
        console.error('[UserRating] Save error:', err);
        res.status(500).json({ error: 'Failed to save rating' });
    }
});

// ─── Movie Uploads ─────────────────────────────────────────────────────────────
app.post('/api/movies/upload', sessionMiddleware, adminMiddleware, movieUpload.array('files'), async (req, res) => {
    try {
        console.log(`[Upload] Received ${req.files?.length} files`);
        
        // Trigger background scan to catch the new files
        setTimeout(() => {
            console.log('[Upload] Triggering library scan...');
            (scanDirectory as any)()
                .then(() => console.log('[Upload] Auto-scan completed'))
                .catch((err: any) => console.error('[Upload] Auto-scan error:', err));
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

app.get('/api/admin/config/rd-token', sessionMiddleware, adminMiddleware, async (req, res) => {
    const config: any = await db.getGlobalConfig('RD_TOKEN');
    res.json({ token: config?.token || process.env.REAL_DEBRID_API_TOKEN || '' });
});

app.post('/api/admin/config/rd-token', sessionMiddleware, adminMiddleware, async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token requerido' });
    process.env.REAL_DEBRID_API_TOKEN = token;
    
    await db.setGlobalConfig('RD_TOKEN', { token });
    
    const envPath = path.resolve(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
        try {
            let envContent = fs.readFileSync(envPath, 'utf8');
            if (envContent.includes('REAL_DEBRID_API_TOKEN=')) {
                envContent = envContent.replace(/REAL_DEBRID_API_TOKEN=.*/, `REAL_DEBRID_API_TOKEN=${token}`);
            } else {
                envContent += `\nREAL_DEBRID_API_TOKEN=${token}`;
            }
            fs.writeFileSync(envPath, envContent);
        } catch (e) {
            console.warn('[Server] Could not persist RD token to .env file:', e.message);
        }
    }
    res.json({ message: 'Token de Real-Debrid actualizado y persistido' });
});

app.get('/api/admin/config/os-credentials', sessionMiddleware, adminMiddleware, async (req, res) => {
    const config: any = await db.getGlobalConfig('OS_CREDENTIALS');
    res.json({ 
        username: config?.username || process.env.OS_USERNAME || '',
        password: config?.password || process.env.OS_PASSWORD || ''
    });
});

app.post('/api/admin/config/os-credentials', sessionMiddleware, adminMiddleware, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    
    process.env.OS_USERNAME = username;
    process.env.OS_PASSWORD = password;
    
    // Save to DB for persistence across deploys
    await db.setGlobalConfig('OS_CREDENTIALS', { username, password });
    
    // Also save to .env if exists for local dev
    const envPath = path.resolve(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
        try {
            let envContent = fs.readFileSync(envPath, 'utf8');
            const updates = {
                'OS_USERNAME': username,
                'OS_PASSWORD': password
            };
            
            Object.entries(updates).forEach(([key, val]) => {
                if (envContent.includes(`${key}=`)) {
                    envContent = envContent.replace(new RegExp(`${key}=.*`), `${key}=${val}`);
                } else {
                    envContent += `\n${key}=${val}`;
                }
            });
            fs.writeFileSync(envPath, envContent);
        } catch (e) {
            console.warn('[Server] Failed to update .env file, but DB is updated:', e.message);
        }
    }
    res.json({ message: 'Credenciales de OpenSubtitles actualizadas y persistidas' });
});

app.get('/api/admin/config/tmdb-key', sessionMiddleware, adminMiddleware, async (req, res) => {
    try {
        const config = await db.getGlobalConfig('TMDB_KEY');
        res.json(config || { key: process.env.TMDB_API_KEY || '' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/config/tmdb-key', sessionMiddleware, adminMiddleware, async (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'Key is required' });
    
    try {
        await db.setGlobalConfig('TMDB_KEY', { key });
        process.env.TMDB_API_KEY = key;
        res.json({ success: true, message: 'API Key de TMDB actualizada' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/config/omdb-key', sessionMiddleware, adminMiddleware, async (req, res) => {
    try {
        const config = await db.getGlobalConfig('OMDB_KEY');
        res.json(config || { key: process.env.OMDB_API_KEY || '' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/config/omdb-key', sessionMiddleware, adminMiddleware, async (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'Key is required' });
    
    try {
        await db.setGlobalConfig('OMDB_KEY', { key });
        process.env.OMDB_API_KEY = key;
        res.json({ success: true, message: 'API Key de OMDb actualizada' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// --- Movie Requests ---

app.post('/api/requests', sessionMiddleware, async (req, res) => {
    const { tmdbId, title, posterPath } = req.body;
    const userEmail = req.headers['x-user-email'];
    const userId = req.headers['x-user-id'];

    if (!tmdbId || !title) {
        return res.status(400).json({ error: 'Faltan datos obligatorios (ID o título)' });
    }

    try {
        const result = await db.addRequest({
            user_id: userId || userEmail || 'anonymous',
            tmdb_id: tmdbId.toString(),
            title,
            poster_path: posterPath,
            status: 'pending'
        });
        res.json({ success: true, request: result });
    } catch (err) {
        console.error('[Requests] Error adding request:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/requests', sessionMiddleware, adminMiddleware, async (req, res) => {
    try {
        const requests = await db.getRequests();
        res.json(requests);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/admin/requests/:id', sessionMiddleware, adminMiddleware, async (req, res) => {
    const id = req.params.id as string;
    const { status } = req.body;

    try {
        await db.updateRequest(parseInt(id, 10), { status });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/news', async (req, res) => {
    try {
        const news = await fetchMovieNews();
        res.json(news);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch news' });
    }
});

// Bulk Refresh Metadata
app.post('/api/admin/refresh-metadata', async (req, res) => {
    try {
        const movies = await db.getMovies();
        console.log(`[Server] Starting bulk metadata refresh for ${movies.length} movies...`);
        
        let updatedCount = 0;
        for (const movie of movies) {
            try {
                // 1. Clean the title of any noise like [English] or (2005) before searching
                const searchTitle = movie.official_title ? movie.official_title.replace(/\[.*?\]|\(.*?\)/g, '').trim() : '';
                
                // 2. Search TMDb for the movie by title and year to get its ID
                const searchResult = await searchMovie((searchTitle || movie.official_title) as string, movie.detected_year as any);
                
                if (searchResult && searchResult.id) {
                    // 3. Fetch full details using the TMDb ID
                    const details = await getMovieDetails(searchResult.id);
                    if (details) {
                        await db.updateMovie(movie.id, {
                            official_title: details.official_title,
                            overview: details.overview,
                            poster_url: details.poster_url,
                            backdrop_url: details.backdrop_url,
                            runtime: details.runtime,
                            rating: details.rating
                        });
                        updatedCount++;
                    }
                }
            } catch (err) {
                console.warn(`[Server] Failed to refresh metadata for: ${movie.official_title}`, err.message);
            }
        }
        
        res.json({ success: true, message: `Se han actualizado ${updatedCount} películas a Español Latino.` });
    } catch (err) {
        console.error('[Server] Bulk refresh error:', err.message);
        res.status(500).json({ error: 'Error al actualizar la biblioteca.' });
    }
});

app.use('/api/discover', discoverRouter);

// Health check for Railway
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});

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
