const { google } = require('googleapis');
const http = require('http');
const path = require('path');
const fs = require('fs');

// Lazy-load token path for environment compatibility
const getTokenPath = () => {
    if (process.env.DRIVE_TOKEN_PATH) return process.env.DRIVE_TOKEN_PATH;
    if (process.env.DRIVE_TOKEN_VOLUME_PATH) return path.join(process.env.DRIVE_TOKEN_VOLUME_PATH, 'drive-token.json');
    return path.join(os.tmpdir(), 'cinevault-drive-token.json');
};

const PORT = process.env.PORT || 3001;
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;
const REDIRECT_URI = `${BACKEND_URL}/api/auth/callback`;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

// Load existing token
try {
    const tokenPath = getTokenPath();
    if (fs.existsSync(tokenPath)) {
        const token = JSON.parse(fs.readFileSync(tokenPath));
        oauth2Client.setCredentials(token);
    }
} catch (e) {
    console.error('[Drive] Invalid token file, clearing...');
}

oauth2Client.on('tokens', (tokens) => {
    const tokenPath = getTokenPath();
    let existing = {};
    try {
        if (fs.existsSync(tokenPath)) existing = JSON.parse(fs.readFileSync(tokenPath));
    } catch (_) {}
    fs.writeFileSync(tokenPath, JSON.stringify({ ...existing, ...tokens }));
});

const driveApi = {
    isAuthenticated: () => !!oauth2Client.credentials && !!oauth2Client.credentials.access_token,

    getAuthUrl: () => {
        return oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: [
                'https://www.googleapis.com/auth/drive',
                'https://www.googleapis.com/auth/drive.file',
                'https://www.googleapis.com/auth/drive.readonly'
            ]
        });
    },

    getTokens: async (code) => {
        const { tokens } = await oauth2Client.getToken(code);
        return tokens;
    },

    getOAuthClient: () => oauth2Client,

    authenticate: async () => {
        return new Promise((resolve, reject) => {
            if (driveApi.isAuthenticated()) return resolve(true);
            const url = driveApi.getAuthUrl();
            const server = http.createServer(async (req, res) => {
                if (req.url.startsWith('/api/auth/callback')) {
                    const parsedUrl = new URL(req.url, BACKEND_URL);
                    const code = parsedUrl.searchParams.get('code');
                    if (code) {
                        res.end('<h1>Authenticacion Exitosa!</h1><script>window.close()</script>');
                        server.close();
                        const tokens = await driveApi.getTokens(code);
                        oauth2Client.setCredentials(tokens);
                        fs.writeFileSync(getTokenPath(), JSON.stringify(tokens));
                        resolve(true);
                    }
                }
            }).listen(PORT);
        });
    },
    
    getClient: () => google.drive({ version: 'v3', auth: oauth2Client }),

    getOrCreateFolder: async (folderName) => {
        const drive = driveApi.getClient();
        const response = await drive.files.list({
            q: `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name)',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });
        if (response.data.files && response.data.files.length > 0) return response.data.files[0].id;
        const folder = await drive.files.create({
            requestBody: { name: folderName, mimeType: 'application/vnd.google-apps.folder' },
            fields: 'id',
            supportsAllDrives: true
        });
        return folder.data.id;
    },

    uploadVideo: async (filePath, mimeType, onProgress, options = {}) => {
        if (!driveApi.isAuthenticated()) throw new Error('Not authenticated');
        if (!filePath || filePath.toLowerCase() === 'pending') throw new Error('El archivo aún no está listo para subida (status: pending)');
        if (!fs.existsSync(filePath)) throw new Error(`Archivo no encontrado en el sistema local: ${filePath}`);

        const drive = driveApi.getClient();
        const fileName = path.basename(filePath);
        const fileSize = fs.statSync(filePath).size;
        const folderId = await driveApi.getOrCreateFolder('CineVault');

        let body = fs.createReadStream(filePath);
        if (options.optimize) {
            const { getOptimizedUploadStream } = require('./optimizer');
            body = getOptimizedUploadStream(filePath);
        }

        const res = await drive.files.create({
            requestBody: { name: options.optimize ? fileName.replace(/\.[^/.]+$/, "") + " (Optimized).mkv" : fileName, parents: [folderId] },
            media: { mimeType: options.optimize ? 'video/x-matroska' : (mimeType || 'video/mp4'), body: body },
            uploadType: 'resumable',
            supportsAllDrives: true,
            fields: 'id, webContentLink, webViewLink'
        }, {
            onUploadProgress: (evt) => {
                if (onProgress) onProgress(Math.round((evt.bytesRead / fileSize) * 100), evt.bytesRead, fileSize);
            }
        });

        try {
            await drive.permissions.create({ fileId: res.data.id, requestBody: { role: 'reader', type: 'anyone' }, supportsAllDrives: true });
        } catch (e) {}
        return res.data;
    },

    uploadBasicFile: async (filePath, folderId, fileName) => {
        if (!driveApi.isAuthenticated()) throw new Error('Not authenticated');
        const drive = driveApi.getClient();
        return await drive.files.create({
            requestBody: { name: fileName, parents: [folderId] },
            media: { body: fs.createReadStream(filePath) },
            supportsAllDrives: true,
            fields: 'id'
        });
    },

    getFileContent: async (fileId) => {
        if (!driveApi.isAuthenticated()) throw new Error('Not authenticated');
        const drive = driveApi.getClient();
        try {
            const res = await drive.files.get({
                fileId,
                alt: 'media',
                supportsAllDrives: true
            }, { responseType: 'text' });
            return res.data;
        } catch (err) {
            console.error('[Drive] Error getting file content:', err.message);
            throw err;
        }
    },

    getStream: async (fileId, options = {}) => {
        const hasToken = driveApi.isAuthenticated();
        const apiKey = process.env.GOOGLE_API_KEY;

        if (hasToken) {
            try {
                const drive = driveApi.getClient();
                const driveRes = await drive.files.get(
                    { fileId, alt: 'media', supportsAllDrives: true }, 
                    { responseType: 'stream', ...options }
                );
                return driveRes.data;
            } catch (err) {
                if (apiKey) {
                    const axios = require('axios');
                    const driveRes = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
                        params: { alt: 'media', key: apiKey, supportsAllDrives: true },
                        responseType: 'stream',
                        ...options
                    });
                    return driveRes.data;
                }
                throw err;
            }
        } else if (apiKey) {
            const axios = require('axios');
            const driveRes = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
                params: { alt: 'media', key: apiKey, supportsAllDrives: true },
                responseType: 'stream',
                ...options
            });
            return driveRes.data;
        }
        throw new Error('No authentication method available');
    },

    streamVideo: async (fileId, rangeHeader, res, transcodeOptions = {}) => {
        const drive = driveApi.getClient();
        const hasToken = driveApi.isAuthenticated();
        const apiKey = process.env.GOOGLE_API_KEY;

        try {
            // 1. Metadata check with universal support
            let fileSize, contentType;
            if (hasToken) {
                const meta = await drive.files.get({ fileId, fields: 'size, mimeType', supportsAllDrives: true });
                fileSize = parseInt(meta.data.size, 10);
                contentType = meta.data.mimeType;
            } else {
                const axios = require('axios');
                const metaRes = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
                    params: { fields: 'size,mimeType', key: apiKey, supportsAllDrives: true }
                });
                fileSize = parseInt(metaRes.data.size, 10);
                console.log(`[DriveStream] Request: ${fileId}, Transcode: ${transcodeOptions.transcode}, Start: ${transcodeOptions.t}`);
                contentType = metaRes.data.mimeType;
            }

            // 2. Transcode path
            if (transcodeOptions.transcode) {
                const startTime = parseFloat(transcodeOptions.t || 0);
                const range = rangeHeader;
                
                // Safari Probe handling (0-1 bytes) - MANDATORY for iOS Safari
                if (range === 'bytes=0-1') {
                    res.writeHead(206, {
                        'Content-Type': 'video/mp4',
                        'Content-Range': 'bytes 0-1/2000000000', 
                        'Content-Length': '2',
                        'Accept-Ranges': 'bytes',
                        'Access-Control-Allow-Origin': '*'
                    });
                    return res.end(Buffer.from([0, 0]));
                }

                res.writeHead(200, { 
                    'Content-Type': 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"', 
                    'Access-Control-Allow-Origin': '*',
                    'X-Accel-Buffering': 'no',
                    'Connection': 'keep-alive',
                    'Cache-Control': 'no-cache'
                });

                let bodyStream;
                try {
                    if (hasToken) {
                        try {
                            const driveRes = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'stream' });
                            bodyStream = driveRes.data;
                        } catch (tokenErr) {
                            console.warn('[DriveStream] Token access failed, trying API Key fallback:', tokenErr.message);
                            if (apiKey) {
                                const axios = require('axios');
                                const driveRes = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
                                    params: { alt: 'media', key: apiKey, supportsAllDrives: true },
                                    responseType: 'stream'
                                });
                                bodyStream = driveRes.data;
                            } else {
                                throw tokenErr;
                            }
                        }
                    } else if (apiKey) {
                        const axios = require('axios');
                        const driveRes = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
                            params: { alt: 'media', key: apiKey, supportsAllDrives: true },
                            responseType: 'stream'
                        });
                        bodyStream = driveRes.data;
                    } else {
                        throw new Error('No authentication method available (Token or API Key)');
                    }

                    const { getTranscodeStream } = require('./optimizer');
                    const quality = transcodeOptions.quality || '720'; 
                    
                    const transcodeStream = getTranscodeStream(bodyStream, startTime, quality);
                    
                    transcodeStream.pipe(res);

                    res.on('close', () => {
                       if (transcodeStream.ffmpegCommand) transcodeStream.ffmpegCommand.kill();
                    });
                } catch (streamErr) {
                    console.error('[DriveStream] Critical error during stream initialization:', streamErr.message);
                    if (streamErr.message.includes('invalid_grant')) {
                        console.error('[DriveStream] Authentication expired. User needs to re-link Google Drive.');
                    }
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'Error al obtener flujo de Drive', details: streamErr.message });
                    }
                }
                return;
            }

            // 3. Direct/Range path
            let headers = { 'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
            if (rangeHeader) {
                const parts = rangeHeader.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`;
                headers['Content-Length'] = (end - start) + 1;
                res.writeHead(206, headers);
                if (hasToken) {
                    const response = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'stream', headers: { Range: rangeHeader } });
                    response.data.pipe(res);
                } else {
                    const axios = require('axios');
                    const response = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
                        params: { alt: 'media', key: apiKey, supportsAllDrives: true },
                        headers: { Range: rangeHeader },
                        responseType: 'stream'
                    });
                    response.data.pipe(res);
                }
            } else {
                headers['Content-Length'] = fileSize;
                res.writeHead(200, headers);
                if (hasToken) {
                    const response = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'stream' });
                    response.data.pipe(res);
                } else {
                    const axios = require('axios');
                    const response = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
                        params: { alt: 'media', key: apiKey, supportsAllDrives: true },
                        responseType: 'stream'
                    });
                    response.data.pipe(res);
                }
            }
        } catch (err) {
            console.error('[Drive Stream] Error:', err.message);
            if (!res.headersSent) {
                res.status(500).json({ 
                    error: 'Streaming Error', 
                    message: err.message,
                    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined 
                });
            }
        }
    },

    list: async (folderId = 'root') => {
        const drive = driveApi.getClient();
        const res = await drive.files.list({ q: `'${folderId}' in parents and trashed = false`, supportsAllDrives: true, includeItemsFromAllDrives: true });
        return res.data.files;
    },

    getFileParent: async (fileId) => {
        const drive = driveApi.getClient();
        try {
            const res = await drive.files.get({ fileId, fields: 'parents', supportsAllDrives: true });
            return res.data.parents?.[0];
        } catch (e) { return null; }
    },

    disconnect: async () => {
        oauth2Client.setCredentials(null);
        const tokenPath = getTokenPath();
        if (fs.existsSync(tokenPath)) fs.unlinkSync(tokenPath);
    }
};

module.exports = driveApi;
