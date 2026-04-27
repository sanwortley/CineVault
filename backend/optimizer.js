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
function getTranscodeStream(input, startTime = 0) {
    console.log(`[Optimizer] Starting real-time transcode. Start: ${startTime}s`);
    
    const passThrough = new PassThrough();
    const command = ffmpeg(input);

    command.inputOptions([
        '-threads', '1',
        '-probesize', '10M',
        '-analyzeduration', '10M'
    ]);

    command
        .videoCodec('libx264')
        .audioCodec('aac')
        .audioChannels(2)
        .format('mp4')
        .outputOptions([
            '-ss', startTime.toString(), // Seek after input for pipe stability
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

/**
 * Returns a stream for a specific HLS segment (MPEG-TS format).
 */
function getHLSSegmentStream(input, startTime = 0, duration = 10, headers = null, quality = '480') {
    const profile = QUALITY_PROFILES[quality] || QUALITY_PROFILES['480'];
    console.log(`[Optimizer] Generating HLS Segment (${quality}p): ${startTime}s to ${startTime + duration}s`);
    
    const passThrough = new PassThrough();
    const command = ffmpeg(input);

    const inputOptions = [
        '-threads', '1',
        '-probesize', '5M',
        '-analyzeduration', '5M'
    ];

    if (headers) {
        // Headers must be a single string with \r\n separators
        inputOptions.push('-headers', headers.trim() + '\r\n');
    }

    // Fast seek before input for segments (VITAL for speed)
    inputOptions.push('-ss', startTime.toString());

    command.inputOptions(inputOptions);

    command
        .videoCodec('libx264')
        .audioCodec('aac')
        .audioChannels(2)
        .format('mpegts') // HLS segments are typically MPEG-TS
        .outputOptions([
            ...(typeof input !== 'string' || !input.startsWith('http') ? ['-ss', startTime.toString()] : []),
            '-t', duration.toString(), // Only transcode the segment duration
            '-output_ts_offset', startTime.toString(), // Align timestamps with playlist
            '-preset', 'ultrafast', 
            '-profile:v', 'main', 
            '-level', '4.1',
            '-pix_fmt', 'yuv420p',
            '-g', '30', // Force keyframe every 30 frames for faster segmenting
            '-crf', profile.crf.toString(), 
            '-maxrate', profile.bitrate, 
            '-bufsize', profile.bufsize,
            '-b:a', '128k', // Standard audio bitrate
            '-threads', '1',
            '-map_chapters', '-1'
        ])
        .videoFilter(`scale=${profile.width}:${profile.height}`)
        .on('error', (err) => {
            if (err.message.includes('SIGKILL')) return;
            console.error('[Optimizer] HLS Segment Error:', err.message);
            passThrough.destroy(err);
        })
        .on('end', () => {
            passThrough.end();
        });

    command.pipe(passThrough);
    passThrough.ffmpegCommand = command;
    return passThrough;
}

const QUALITY_PROFILES = {
    '480': { width: 854, height: 480, bitrate: '600k', bufsize: '1.2M', crf: 28 },
    '720': { width: 1280, height: 720, bitrate: '1500k', bufsize: '3M', crf: 28 },
    '1080': { width: 1920, height: 1080, bitrate: '2200k', bufsize: '4.4M', crf: 30 }
};

module.exports = { getOptimizedUploadStream, getTranscodeStream, getHLSSegmentStream, QUALITY_PROFILES };
