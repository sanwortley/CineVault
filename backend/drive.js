const { google } = require('googleapis');
const http = require('http');
const path = require('path');
const fs = require('fs');

// Lazy-load token path so 'electron.app' is not evaluated on startup script load
const getTokenPath = () => {
    const os = require('os');
    
    // Priority: Env var specifically for production/Railway
    if (process.env.DRIVE_TOKEN_PATH) {
        let p = process.env.DRIVE_TOKEN_PATH;
        // If it's a Windows-style path with backslashes but we are on Linux (Railway),
        // we should try to normalize or use a local fallback if the windows path is invalid.
        if (process.platform !== 'win32' && p.includes('\\')) {
            console.warn('[DriveApi] Detected Windows path on Linux environment. Using fallback in /tmp');
            return path.join(os.tmpdir(), 'cinevault-drive-token.json');
        }
        return p;
    }
    
    // If running in a container with persistent /data volume
    if (process.env.DRIVE_TOKEN_VOLUME_PATH) {
        return path.join(process.env.DRIVE_TOKEN_VOLUME_PATH, 'drive-token.json');
    }

    try {
        const { app } = require('electron');
        return path.join(app.getPath('userData'), 'drive-token.json');
    } catch (e) {
        // Running outside Electron (web backend server)
        return path.join(os.tmpdir(), 'cinevault-drive-token.json');
    }
};

const PORT = process.env.PORT || 3001;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

// Load existing token if any - auto-clear if stale
try {
    const tokenPath = getTokenPath();
    if (fs.existsSync(tokenPath)) {
        const token = JSON.parse(fs.readFileSync(tokenPath));
        oauth2Client.setCredentials(token);
    }
} catch (e) {
    console.error('[Drive] Invalid token file, clearing...', e.message);
    try {
        const tokenPath = getTokenPath();
        if (fs.existsSync(tokenPath)) fs.unlinkSync(tokenPath);
    } catch (_) {}
}

// Intercept token refresh errors to auto-clear stale tokens
oauth2Client.on('tokens', (tokens) => {
    const tokenPath = getTokenPath();
    let existing = {};
    try {
        if (fs.existsSync(tokenPath)) existing = JSON.parse(fs.readFileSync(tokenPath));
    } catch (_) {}
    fs.writeFileSync(tokenPath, JSON.stringify({ ...existing, ...tokens }));
});

const driveApi = {
    isAuthenticated: () => {
        return !!oauth2Client.credentials && !!oauth2Client.credentials.access_token;
    },

    authenticate: async () => {
        return new Promise((resolve, reject) => {
            if (driveApi.isAuthenticated()) return resolve(true);

            const url = oauth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: ['https://www.googleapis.com/auth/drive.file']
            });

            const server = http.createServer(async (req, res) => {
                try {
                    if (req.url.startsWith('/oauth2callback')) {
                        const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
                        const code = parsedUrl.searchParams.get('code');
                        
                        if (code) {
                            res.end('<h1>Authenticacion Exitosa!</h1><p>Puedes cerrar esta ventana de forma segura y regresar a CineVault.</p><script>window.close()</script>');
                            server.destroy();
                            
                            const { tokens } = await oauth2Client.getToken(code);
                            oauth2Client.setCredentials(tokens);
                            fs.writeFileSync(getTokenPath(), JSON.stringify(tokens));
                            resolve(true);
                        } else {
                            res.end('Auth failed no code provided');
                            server.destroy();
                            reject(new Error('Auth failed'));
                        }
                    }
                } catch (e) {
                    res.end('Authentication failed');
                    server.destroy();
                    reject(e);
                }
            });

            let connections = [];
            server.on('connection', conn => {
                connections.push(conn);
                conn.on('close', () => connections = connections.filter(c => c !== conn));
            });

            server.destroy = () => {
                server.close();
                connections.forEach(conn => conn.destroy());
            };

            server.listen(PORT, () => {
                const { shell } = require('electron');
                shell.openExternal(url); // Opens user's default browser instead of an Electron popup
            });
        });
    },
    
    getClient: () => google.drive({ 
        version: 'v3', 
        auth: oauth2Client,
        retry: true,           // Auto-retry on transient errors (500, 502, 503, 429)
        retryConfig: {
            retry: 3,          // Max 3 retries
            retryDelay: 1000,  // Initial delay
            onRetryAttempt: (err) => console.warn(`[Drive] Retry attempt due to: ${err.message}`)
        }
    }),
    getOAuthClient: () => oauth2Client,

    getOrCreateFolder: async (folderName) => {
        const drive = driveApi.getClient();
        
        // Search for both folders AND shortcuts to folders with that name
        const response = await drive.files.list({
            q: `(name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false) or (name = '${folderName}' and mimeType = 'application/vnd.google-apps.shortcut' and trashed = false)`,
            fields: 'files(id, name, mimeType, shortcutDetails)',
            spaces: 'drive'
        });

        if (response.data.files && response.data.files.length > 0) {
            const folder = response.data.files[0];
            if (folder.mimeType === 'application/vnd.google-apps.shortcut') {
                return folder.shortcutDetails.targetId;
            }
            return folder.id;
        }

        const folder = await drive.files.create({
            requestBody: {
                name: folderName,
                mimeType: 'application/vnd.google-apps.folder'
            },
            fields: 'id'
        });

        return folder.data.id;
    },

    // Upload massive video files using resumable uploads to prevent memory crashes
    uploadVideo: async (filePath, mimeType, onProgress, options = {}) => {
        if (!driveApi.isAuthenticated()) throw new Error('Not authenticated with Google Drive');
        try {
            console.log('[Drive] Iniciando proceso de subida para:', filePath);
            const drive = driveApi.getClient();
        const fileName = path.basename(filePath);
        const fileSize = fs.statSync(filePath).size;

        // Get or Create CineVault folder
        console.log('[Drive] Paso 1: Buscando o creando carpeta "CineVault"...');
        const folderId = await driveApi.getOrCreateFolder('CineVault');
        console.log('[Drive] Carpeta CineVault lista (ID:', folderId, ')');

        let body = fs.createReadStream(filePath);
        let uploadMimeType = mimeType || 'video/mp4';

        // Apply on-the-fly compression if requested
        if (options.optimize) {
            console.log('[Drive] Smart Compression enabled for this upload.');
            const { getOptimizedUploadStream } = require('./optimizer');
            body = getOptimizedUploadStream(filePath);
            uploadMimeType = 'video/x-matroska'; // MKV is more reliable for streams
        }

        const media = {
            mimeType: uploadMimeType,
            body: body
        };

        console.log('[Drive] Paso 2: Iniciando solicitud de creación de archivo (resumable)...');
        const res = await drive.files.create({
            requestBody: { 
                name: options.optimize ? fileName.replace(/\.[^/.]+$/, "") + " (Optimized).mkv" : fileName,
                parents: [folderId]
            },
            media: media,
            uploadType: 'resumable',
            fields: 'id, webContentLink, webViewLink'
        }, {
            // You can tune chunk size here if needed in the future
            // retry: true, // Auto-retry on transient errors
            onUploadProgress: (evt) => {
                if (onProgress) {
                    const progress = Math.round((evt.bytesRead / fileSize) * 100);
                    // Log only every 10% to avoid flooding
                    if (progress % 10 === 0) console.log(`[Drive] Progreso: ${progress}% (${evt.bytesRead}/${fileSize})`);
                    onProgress(progress, evt.bytesRead, fileSize);
                }
            }
        });
        console.log('[Drive] Paso 3: Archivo creado con éxito. ID:', res.data.id);

        // --- CERO QUILOMBO: Automáticamente hacerlo público para que tus amigos no tengan que loguearse ---
        try {
            console.log(`[Drive] Making file ${res.data.id} public for easier sharing...`);
            await drive.permissions.create({
                fileId: res.data.id,
                requestBody: {
                    role: 'reader',
                    type: 'anyone',
                },
            });
        } catch (e) {
        }
        return res.data;
    } catch (error) {
            const isAuthError = error.message?.includes('invalid_grant') || 
                              error.message?.includes('invalid_token') || 
                              error.code === 401;

            let msg = error.message;
            if (msg.includes('<!DOCTYPE html>') || msg.includes('<title>')) {
                const titleMatch = msg.match(/<title>(.*?)<\/title>/);
                msg = `Google API returned HTML error: ${titleMatch ? titleMatch[1] : 'Unknown Server Error (502/500)'}`;
            }
            
            console.error('[Drive Upload] Fatal Error:', { msg, isAuthError });

            if (isAuthError) {
                console.warn('[Drive Upload] Auth Error detected. Clearing stale token...');
                await driveApi.disconnect();
            }

            throw new Error(isAuthError ? 'Sesión de Google Drive expirada. Reconecta en Ajustes.' : msg);
        }
    },

    // Proxy byte-range requests from Electron's web player directly to Google Drive
    // Proxy byte-range requests from Electron's web player directly to Google Drive
    // Optionally transcodes on-the-fly for browser compatibility
    streamVideo: async (fileId, rangeHeader, res, transcodeOptions = {}) => {
        const cleanId = typeof fileId === 'string' ? fileId.replace(/^\d+_/, '') : fileId;
        const hasToken = driveApi.isAuthenticated();
        const apiKey = process.env.GOOGLE_API_KEY;

        try {
            let drive;
            let fileSize;
            let contentType;

            // 1. Fetch Metadata
            console.log(`[Drive] Metadata check for: ${cleanId} (Original: ${fileId})`);
            if (hasToken) {
                drive = driveApi.getClient();
                const fileMeta = await drive.files.get({ fileId: cleanId, fields: 'size, mimeType' });
                fileSize = parseInt(fileMeta.data.size, 10);
                contentType = fileMeta.data.mimeType;
            } else {
                const metaUrl = `https://www.googleapis.com/drive/v3/files/${cleanId}?fields=size,mimeType${apiKey ? `&key=${apiKey}` : ''}`;
                const metaRes = await fetch(metaUrl);
                if (!metaRes.ok) throw new Error(`Google API returned ${metaRes.status}`);
                const metaData = await metaRes.json();
                fileSize = parseInt(metaData.size, 10);
                contentType = metaData.mimeType;
            }

            // 2. Transcoding Logic
            if (transcodeOptions.transcode) {
                const { getTranscodeStream } = require('./optimizer');
                
                // For transcoding, we can't use rangeHeader directly on the output,
                // we tell FFmpeg to seek the input.
                const startTime = parseFloat(transcodeOptions.t || 0);
                
                res.writeHead(200, {
                    'Content-Type': 'video/mp4',
                    'Accept-Ranges': 'bytes',
                    'Access-Control-Allow-Origin': '*',
                    'Transfer-Encoding': 'chunked'
                });

                let driveStream;
                if (hasToken) {
                    // For transcoding, we don't send Range to Google because we need the source for FFmpeg to seek
                    const driveRes = await drive.files.get({ fileId: cleanId, alt: 'media' }, { responseType: 'stream' });
                    driveStream = driveRes.data;
                } else {
                    const mediaUrl = `https://www.googleapis.com/drive/v3/files/${cleanId}?alt=media${apiKey ? `&key=${apiKey}` : ''}`;
                    const mediaRes = await fetch(mediaUrl);
                    const { Readable } = require('stream');
                    driveStream = Readable.fromWeb(mediaRes.body);
                }

                const transcodeStream = getTranscodeStream(driveStream, startTime);
                transcodeStream.pipe(res);

                res.on('close', () => {
                   if (transcodeStream.ffmpegCommand) transcodeStream.ffmpegCommand.kill();
                });
                return;
            }

            // 3. Normal Streaming (with Range support)
            let headers = {
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS, HEAD',
                'Access-Control-Allow-Headers': 'Range, Content-Type',
                'Cache-Control': 'no-cache, no-store, must-revalidate' // Prevent accidental caching of partial streams
            };

            if (rangeHeader) {
                const parts = rangeHeader.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

                if (start >= fileSize) {
                    res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
                    return;
                }

                const chunksize = (end - start) + 1;
                headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`;
                headers['Content-Length'] = chunksize;
                
                res.writeHead(206, headers);

                // For HEAD requests (Safari probes), don't send the body
                if (res.req.method === 'HEAD') return res.end();

                if (hasToken) {
                    const response = await drive.files.get(
                        { fileId: cleanId, alt: 'media' }, 
                        { 
                            responseType: 'stream', 
                            headers: { Range: rangeHeader } 
                        }
                    );
                    response.data.pipe(res);
                } else {
                    const mediaUrl = `https://www.googleapis.com/drive/v3/files/${cleanId}?alt=media${apiKey ? `&key=${apiKey}` : ''}`;
                    const googleRes = await fetch(mediaUrl, {
                        headers: { Range: rangeHeader }
                    });
                    const { Readable } = require('stream');
                    Readable.fromWeb(googleRes.body).pipe(res);
                }
            } else {
                headers['Content-Length'] = fileSize;
                res.writeHead(200, headers);

                if (res.req.method === 'HEAD') return res.end();

                if (hasToken) {
                    const response = await drive.files.get({ fileId: cleanId, alt: 'media' }, { responseType: 'stream' });
                    response.data.on('error', e => !res.headersSent && res.status(500).end()).pipe(res);
                } else {
                    const mediaUrl = `https://www.googleapis.com/drive/v3/files/${cleanId}?alt=media${apiKey ? `&key=${apiKey}` : ''}`;
                    const response = await fetch(mediaUrl);
                    const { Readable } = require('stream');
                    Readable.fromWeb(response.body).pipe(res);
                }
            }

        } catch (error) {
            const isAuthError = error.message?.includes('invalid_grant') || 
                              error.message?.includes('invalid_token') || 
                              error.code === 401;

            console.error('[Drive Stream] Fatal Error:', { 
                fileId, 
                message: error.message, 
                code: error.code,
                hasToken,
                isAuthError
            });
            
            if (isAuthError) {
                console.warn('[Drive Stream] Auth Error detected. Clearing stale token...');
                await driveApi.disconnect();
            }

            if (!res.headersSent) {
                res.status(isAuthError ? 401 : 500).json({ 
                    error: isAuthError ? 'Sesión de Google Drive expirada' : 'Error de servidor en streaming de Drive',
                    message: error.message,
                    code: error.code,
                    help: isAuthError ? 'Por favor, reconecta tu cuenta en Ajustes.' : (error.message.includes('403') ? 'Posible límite de cuota alcanzarlo o acceso restringido.' : 'Intenta recargar la página.')
                });
            }
        }
    },

    getDownloadStream: async (fileId) => {
        if (!driveApi.isAuthenticated()) throw new Error('Not authenticated');
        const drive = driveApi.getClient();
        const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
        return response.data;
    },

    getAuthToken: async () => {
        if (!driveApi.isAuthenticated()) throw new Error('Not authenticated');
        const { token } = await oauth2Client.getAccessToken();
        return token;
    },

    fileExists: async (fileId) => {
        if (!driveApi.isAuthenticated()) return 'error';
        const drive = driveApi.getClient();
        try {
            const res = await drive.files.get({ fileId, fields: 'id, trashed' });
            if (res.data && res.data.trashed) return 'missing';
            return 'exists';
        } catch (e) {
            if (e.code === 404) return 'missing';
            console.error(`[Drive Status] Error checking ${fileId}:`, e.message);
            return 'error';
        }
    },

    makeFilePublic: async (fileId) => {
        if (!driveApi.isAuthenticated()) throw new Error('Not authenticated');
        const drive = driveApi.getClient();
        return await drive.permissions.create({
            fileId: fileId,
            requestBody: {
                role: 'reader',
                type: 'anyone',
            },
        });
    },

    deleteFile: async (fileId) => {
        if (!driveApi.isAuthenticated()) throw new Error('Not authenticated');
        const drive = driveApi.getClient();
        try {
            console.log(`[Drive] Moviendo archivo a la papelera: ${fileId}`);
            return await drive.files.update({
                fileId: fileId,
                requestBody: { trashed: true }
            });
        } catch (e) {
            console.error(`[Drive] Error al mover a la papelera (${fileId}):`, e.message);
            throw e;
        }
    },

    list: async (folderId = 'root') => {
        if (!driveApi.isAuthenticated()) throw new Error('Not authenticated');
        const drive = driveApi.getClient();
        try {
            const response = await drive.files.list({
                q: `'${folderId}' in parents and trashed = false`,
                fields: 'files(id, name, mimeType, size, modifiedTime, thumbnailLink)',
                spaces: 'drive',
                orderBy: 'folder,name'
            });
            return response.data.files;
        } catch (e) {
            console.error(`[Drive] Error listing files in ${folderId}:`, e.message);
            throw e;
        }
    },
    getFileContent: async (fileId) => {
        if (!driveApi.isAuthenticated()) throw new Error('Not authenticated');
        const drive = driveApi.getClient();
        try {
            const response = await drive.files.get({
                fileId: fileId,
                alt: 'media'
            });
            return response.data;
        } catch (e) {
            console.error(`[Drive] Error getting content for ${fileId}:`, e.message);
            throw e;
        }
    },

    uploadBasicFile: async (filePath, folderId, fileName) => {
        if (!driveApi.isAuthenticated()) throw new Error('Not authenticated');
        const drive = driveApi.getClient();
        try {
            const media = {
                mimeType: fileName.endsWith('.vtt') ? 'text/vtt' : 'text/plain',
                body: fs.createReadStream(filePath)
            };
            const res = await drive.files.create({
                requestBody: {
                    name: fileName,
                    parents: [folderId]
                },
                media: media,
                fields: 'id'
            });
            
            // Make publicly readable
            try {
                await drive.permissions.create({
                    fileId: res.data.id,
                    requestBody: { role: 'reader', type: 'anyone' }
                });
            } catch (e) {}

            return res.data.id;
        } catch (e) {
            console.error('[Drive] Error uploading basic file:', e.message);
            throw e;
        }
    },

    getFileParent: async (fileId) => {
        if (!driveApi.isAuthenticated()) throw new Error('Not authenticated');
        const cleanId = typeof fileId === 'string' ? fileId.replace(/^\d+_/, '') : fileId;
        const drive = driveApi.getClient();
        try {
            const res = await drive.files.get({
                fileId: cleanId,
                fields: 'parents'
            });
            return res.data.parents?.[0];
        } catch (e) {
            console.error('[Drive] Error getting file parent:', e.message);
            return null;
        }
    },
    
    getTokenPath,

    disconnect: async () => {
        const tokenPath = getTokenPath();
        if (fs.existsSync(tokenPath)) {
            fs.unlinkSync(tokenPath);
        }
        oauth2Client.setCredentials({});
        return true;
    }
};

module.exports = driveApi;
