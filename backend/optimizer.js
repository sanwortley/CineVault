const ffmpeg = require('fluent-ffmpeg');
const { PassThrough } = require('stream');
const ffprobePath = require('ffprobe-static').path;

// Configure paths - prefer system ffmpeg (from nixpacks) over static binary
try {
    const { execSync } = require('child_process');
    let systemFfmpeg = 'ffmpeg';
    
    // Check if it's in common Linux paths or PATH
    try {
        execSync('which ffmpeg');
    } catch (e) {
        if (require('fs').existsSync('/usr/bin/ffmpeg')) systemFfmpeg = '/usr/bin/ffmpeg';
        else if (require('fs').existsSync('/usr/local/bin/ffmpeg')) systemFfmpeg = '/usr/local/bin/ffmpeg';
        else throw new Error('Not found in common paths');
    }

    execSync(`${systemFfmpeg} -version`);
    ffmpeg.setFfmpegPath(systemFfmpeg);
    console.log(`[Optimizer] Using system FFmpeg: ${systemFfmpeg}`);
} catch (e) {
    console.log('[Optimizer] System FFmpeg not found, falling back to ffmpeg-static');
    const ffmpegPath = require('ffmpeg-static');
    ffmpeg.setFfmpegPath(ffmpegPath);
}
ffmpeg.setFfprobePath(ffprobePath);

/**
 * Returns a stream that compresses a video file for uploading.
 */
function getOptimizedUploadStream(inputPath) {
    const passThrough = new PassThrough();
    ffmpeg(inputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .format('mp4')
        .outputOptions([
            '-preset', 'ultrafast',
            '-crf', '28',
            '-movflags', 'frag_keyframe+empty_moov'
        ])
        .on('start', (cmd) => console.log(`[Optimizer] FFmpeg started: ${cmd}`))
        .on('error', (err) => {
            console.error('[Optimizer] FFmpeg Error:', err.message);
            passThrough.destroy(err);
        })
        .on('end', () => {
            console.log('[Optimizer] Compression finished');
            passThrough.end();
        })
        .pipe(passThrough);

    return passThrough;
}


/**
 * Returns a stream that transcodes a video into a browser-friendly format (H.264/AAC).
 * Optimized for low-latency streaming.
 */
function getTranscodeStream(input, startTime = 0, headers = null) {
    console.log(`[Optimizer] Starting real-time transcode. Start: ${startTime}s`);
    
    const passThrough = new PassThrough();
    const command = ffmpeg(input);

    // CRITICAL: Input options MUST come before the input is processed
    const inputOptions = [
        '-threads', '1',
        '-probesize', '30M',
        '-analyzeduration', '30M'
    ];

    if (headers) {
        // Add User-Agent to avoid Google Drive blocks
        const fullHeaders = headers.trim() + '\r\nUser-Agent: CineVault/1.0\r\n';
        inputOptions.push('-headers', fullHeaders);
    }

    if (typeof input === 'string' && input.startsWith('http')) {
        inputOptions.push('-ss', startTime.toString());
    }

    command.inputOptions(inputOptions);

    command
        .videoCodec('libx264')
        .audioCodec('aac')
        .audioChannels(2)
        .format('mp4')
        .outputOptions([
            // Only seek here if it's NOT a URL (stream fallback)
            ...(typeof input !== 'string' || !input.startsWith('http') ? ['-ss', startTime.toString()] : []),
            '-preset', 'ultrafast', 
            '-tune', 'zerolatency',
            '-profile:v', 'baseline', 
            '-level', '3.0',
            '-pix_fmt', 'yuv420p',
            '-movflags', 'frag_keyframe+empty_moov+default_base_moof+omit_tfhd_offset+frag_discont', 
            '-crf', '28', 
            '-maxrate', '800k', 
            '-bufsize', '1.6M',
            '-threads', '1',
            '-map_chapters', '-1'
        ])
        .videoFilter('scale=720:-2')
        .on('start', (cmd) => console.log(`[Optimizer] FFmpeg Stream: ${cmd}`))
        .on('stderr', (line) => {
            // Log FFmpeg stderr to a file for debugging
            try {
                const fs = require('fs');
                const path = require('path');
                const logDir = path.join(__dirname, '../scratch');
                if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
                const logFile = path.join(logDir, 'ffmpeg.log');
                fs.appendFileSync(logFile, line + '\n');
            } catch (e) {}
        })
        .on('error', (err) => {
            if (err.message.includes('SIGKILL') || err.message.includes('Output stream closed')) return;
            console.error('[Optimizer] FFmpeg Stream Error:', err.message);
            passThrough.destroy(err);
        })
        .on('end', () => {
            console.log('[Optimizer] Stream finished');
            passThrough.end();
        });

    command.pipe(passThrough);
    passThrough.ffmpegCommand = command;
    return passThrough;
}

module.exports = { getOptimizedUploadStream, getTranscodeStream };
