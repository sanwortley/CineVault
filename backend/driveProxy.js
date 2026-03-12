const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

// Health Check
app.get('/ping', (req, res) => res.send('pong'));

// Stream Video Route
app.get('/stream/:fileId', async (req, res) => {
    try {
        const driveApi = require('./drive');
        const { fileId } = req.params;
        const rangeHeader = req.headers.range;
        const shouldTranscode = req.query.transcode === 'true';
        const startTime = parseFloat(req.query.t || 0);
        
        if (shouldTranscode) {
            // Get the auth token and URL to stream directly via FFmpeg
            const token = await driveApi.getAuthToken();
            const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

            const ffmpeg = require('fluent-ffmpeg');
            const passThrough = require('stream').PassThrough;
            const pt = new passThrough();

            let command = ffmpeg(driveUrl);
            if (startTime > 0) command = command.seekInput(startTime);

            command
                .videoCodec('copy')
                .audioCodec('aac')
                .audioChannels(2)
                .audioFrequency(44100)
                .format('matroska') // More compatible for live copy+transcode
                .inputOptions([
                    '-headers',
                    `Authorization: Bearer ${token}`,
                    '-fflags +fastseek'
                ])
                .outputOptions([
                    '-map 0:v?', '-map 0:a?', '-map 0:s?', // map all streams
                    '-c:s copy', // copy subtitles
                    '-preset ultrafast',
                    '-tune zerolatency',
                    '-max_muxing_queue_size 1024',
                    '-x264-params keyint=30:min-keyint=30:scenecut=0', // Force keyframes every 30 frames
                    '-force_key_frames expr:gte(t,n_forced*1)', // Force keyframe every second
                    '-movflags +faststart',
                    '-flush_packets 1'
                ])
                .on('error', (err) => {
                    console.error('[Drive Proxy] Transcode Error:', err.message);
                    if (!res.headersSent) pt.end();
                })
                .pipe(pt);

            res.setHeader('Content-Type', 'video/x-matroska');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            pt.pipe(res);
            return;
        }

        await driveApi.streamVideo(fileId, rangeHeader, res);
    } catch (error) {
        console.error('[Drive Proxy] Stream Error:', error);
        if (!res.headersSent) res.status(500).send('Streaming Error');
    }
});

let server = null;

const driveProxy = {
    start: (port = 19998) => {
        if (server) return;
        return new Promise((resolve, reject) => {
            try {
                // IMPORTANT: We need our server to coexist with the OAuth callback route
                // If it's already running because of the OAuth flow, we shouldn't crash.
                server = app.listen(port, () => {
                    resolve(true);
                }).on('error', (err) => {
                    if (err.code === 'EADDRINUSE') {
                        resolve(true); // Treat as success if it's already there
                    } else {
                        console.error('[Drive Proxy] Failed to start:', err);
                        reject(err);
                    }
                });
            } catch(e) { reject(e); }
        });
    },
    
    stop: () => {
        if (server) {
            server.close();
            server = null;
        }
    }
};

module.exports = driveProxy;
