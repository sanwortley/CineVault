const { google } = require('googleapis');
const http = require('http');
const path = require('path');
const fs = require('fs');

// Lazy-load token path so 'electron.app' is not evaluated on startup script load
const getTokenPath = () => {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'drive-token.json');
};

const REDIRECT_PORT = 19999;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

// Load existing token if any
try {
    const tokenPath = getTokenPath();
    if (fs.existsSync(tokenPath)) {
        const token = JSON.parse(fs.readFileSync(tokenPath));
        oauth2Client.setCredentials(token);
    }
} catch (e) {
    console.error('[Drive] Invalid token file', e);
}

oauth2Client.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
        // Updated
    }
    const tokenPath = getTokenPath();
    let existing = {};
    if (fs.existsSync(tokenPath)) existing = JSON.parse(fs.readFileSync(tokenPath));
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
                        const parsedUrl = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
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

            server.listen(REDIRECT_PORT, () => {
                const { shell } = require('electron');
                shell.openExternal(url); // Opens user's default browser instead of an Electron popup
            });
        });
    },
    
    getClient: () => google.drive({ version: 'v3', auth: oauth2Client }),
    getOAuthClient: () => oauth2Client,

    getOrCreateFolder: async (folderName) => {
        const drive = driveApi.getClient();
        const response = await drive.files.list({
            q: `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name)',
            spaces: 'drive'
        });

        if (response.data.files && response.data.files.length > 0) {
            return response.data.files[0].id;
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
    uploadVideo: async (filePath, mimeType, onProgress) => {
        if (!driveApi.isAuthenticated()) throw new Error('Not authenticated with Google Drive');
        
        const drive = driveApi.getClient();
        const fileName = path.basename(filePath);
        const fileSize = fs.statSync(filePath).size;

        // Get or Create CineVault folder
        const folderId = await driveApi.getOrCreateFolder('CineVault');

        const media = {
            mimeType: mimeType || 'video/mp4',
            body: fs.createReadStream(filePath)
        };

        const res = await drive.files.create({
            requestBody: { 
                name: fileName,
                parents: [folderId]
            },
            media: media,
            fields: 'id, webContentLink, webViewLink'
        }, {
            onUploadProgress: (evt) => {
                if (onProgress) {
                    const progress = Math.round((evt.bytesRead / fileSize) * 100);
                    onProgress(progress, evt.bytesRead, fileSize);
                }
            }
        });

        return res.data;
    },

    // Proxy byte-range requests from Electron's web player directly to Google Drive
    streamVideo: async (fileId, rangeHeader, res) => {
        if (!driveApi.isAuthenticated()) {
            res.status(401).send('Not authenticated');
            return;
        }

        const drive = driveApi.getClient();
        
        try {
            // 1. Get file metadata (size, mimeType) required for 206 Partial Content headers
            const fileMeta = await drive.files.get({
                fileId: fileId,
                fields: 'size, mimeType'
            });

            const fileSize = parseInt(fileMeta.data.size, 10);
            const contentType = fileMeta.data.mimeType;

            let headers = {
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes'
            };

            let status = 200;
            let options = {
                fileId: fileId,
                alt: 'media'
            };

            // 2. Handle HTTP Range Requests (scrubbing/seeking in video)
            if (rangeHeader) {
                const parts = rangeHeader.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                
                if (start >= fileSize) {
                    res.status(416).send('Requested range not satisfiable\n' + start + ' >= ' + fileSize);
                    return;
                }
                
                const chunksize = (end - start) + 1;
                
                headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`;
                headers['Content-Length'] = chunksize;
                status = 206;

                // Send Range header to Google Drive
                options = {
                    ...options,
                    headers: { Range: `bytes=${start}-${end}` }
                };
            } else {
                headers['Content-Length'] = fileSize;
            }

            res.writeHead(status, headers);

            // 3. Pipe the Google Drive web stream directly to the Express/Node response
            const response = await drive.files.get(options, { responseType: 'stream' });
            response.data
                .on('error', err => {
                    console.error('[Drive Stream] Error:', err);
                    if (!res.headersSent) res.status(500).end();
                })
                .pipe(res);

        } catch (error) {
            console.error('[Drive Stream] Fatal:', error.message);
            if (!res.headersSent) res.status(500).send(error.message);
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
    }
};

module.exports = driveApi;
