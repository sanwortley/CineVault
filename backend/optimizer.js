const ffmpeg = require('fluent-ffmpeg');
const { PassThrough } = require('stream');
const ffprobePath = require('ffprobe-static').path;

// Configure paths - prefer system ffmpeg (from nixpacks) over static binary
let CURRENT_FFMPEG_PATH = '';
let IS_SYSTEM_FFMPEG = false;
try {
    const { execSync } = require('child_process');
    let systemFfmpeg = 'ffmpeg';
    
    // Check if it's in common Linux paths or PATH
    try {
        execSync('which ffmpeg');
        systemFfmpeg = 'ffmpeg';
    } catch (e) {
        if (require('fs').existsSync('/usr/bin/ffmpeg')) systemFfmpeg = '/usr/bin/ffmpeg';
        else if (require('fs').existsSync('/bin/ffmpeg')) systemFfmpeg = '/bin/ffmpeg';
        else if (require('fs').existsSync('/usr/local/bin/ffmpeg')) systemFfmpeg = '/usr/local/bin/ffmpeg';
        else if (require('fs').existsSync('/nix/var/nix/profiles/default/bin/ffmpeg')) systemFfmpeg = '/nix/var/nix/profiles/default/bin/ffmpeg';
        else throw new Error('Not found in common paths');
    }

    execSync(`${systemFfmpeg} -version`);
    ffmpeg.setFfmpegPath(systemFfmpeg);
    IS_SYSTEM_FFMPEG = true;
    console.log(`[Optimizer] Using system FFmpeg: ${systemFfmpeg}`);
} catch (e) {
    console.log('[Optimizer] System FFmpeg not found, falling back to ffmpeg-static');
    const staticFfmpeg = require('ffmpeg-static');
    ffmpeg.setFfmpegPath(staticFfmpeg);
    IS_SYSTEM_FFMPEG = false;
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
function getHLSSegmentStream(input, startTime, duration, headers, quality, realStartTime = null) {
    const profile = QUALITY_PROFILES[quality] || QUALITY_PROFILES['480'];
    const command = ffmpeg();
    const tsOffset = realStartTime !== null ? realStartTime : startTime;

    // Use system-level seeking or pipe consumption
    const inputOptions = [
        '-threads', '2',
        '-probesize', '10M',
        '-analyzeduration', '10M',
        '-ignore_unknown',
        '-fflags', '+genpts+igndts+discardcorrupt',
        '-err_detect', 'ignore_err'
    ];

    if (typeof input === 'string' && input.startsWith('http')) {
        if (headers) inputOptions.push('-headers', headers.trim() + '\r\n');
        inputOptions.push('-ss', startTime.toString());
        command.input(input);
    } else {
        // It's a stream pipe
        command.input(input);
        command.inputOptions(inputOptions);
    }

    const stream = new PassThrough();

    command
        .inputOptions(inputOptions)
        .outputOptions([
            '-ss', typeof input === 'string' ? '0' : startTime.toString(),
            '-t', duration.toString(),
            '-output_ts_offset', tsOffset.toString(),
            '-preset', 'ultrafast', 
            '-profile:v', 'main', 
            '-level', '4.1',
            '-pix_fmt', 'yuv420p',
            '-g', '30',
            '-crf', profile.crf.toString(), 
            '-maxrate', profile.bitrate, 
            '-bufsize', profile.bufsize,
            '-b:a', '128k',
            '-threads', '1',
            '-map_chapters', '-1',
            '-f', 'mpegts'
        ])
        .on('start', (cmd) => {
            console.log(`[Optimizer] HLS Segment (${quality}p): ${startTime}s to ${startTime + duration}s`);
        })
        .on('error', (err) => {
            console.error('[Optimizer] HLS Segment Error:', err.message);
            stream.emit('error', err);
        })
        .pipe(stream, { end: true });

    stream.ffmpegCommand = command;
    return stream;
}

const QUALITY_PROFILES = {
    '480': { width: 854, height: 480, bitrate: '600k', bufsize: '1.2M', crf: 28 },
    '720': { width: 1280, height: 720, bitrate: '1500k', bufsize: '3M', crf: 28 },
    '1080': { width: 1920, height: 1080, bitrate: '2200k', bufsize: '4.4M', crf: 30 }
};

module.exports = { getOptimizedUploadStream, getTranscodeStream, getHLSSegmentStream, QUALITY_PROFILES, IS_SYSTEM_FFMPEG };
