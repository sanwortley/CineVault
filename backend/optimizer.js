const ffmpeg = require('fluent-ffmpeg');
const { PassThrough } = require('stream');

// Configure paths - prefer system ffmpeg/ffprobe (from nixpacks) over static binaries
let CURRENT_FFMPEG_PATH = '';
let IS_SYSTEM_FFMPEG = false;

try {
    const { execSync } = require('child_process');
    let systemFfmpeg = 'ffmpeg';
    let systemFfprobe = 'ffprobe';
    
    // Check if it's in common Linux paths or PATH
    try {
        execSync('which ffmpeg');
        systemFfmpeg = 'ffmpeg';
    } catch (e) {
        if (require('fs').existsSync('/usr/bin/ffmpeg')) systemFfmpeg = '/usr/bin/ffmpeg';
        else if (require('fs').existsSync('/bin/ffmpeg')) systemFfmpeg = '/bin/ffmpeg';
        else if (require('fs').existsSync('/usr/local/bin/ffmpeg')) systemFfmpeg = '/usr/local/bin/ffmpeg';
        else if (require('fs').existsSync('/nix/var/nix/profiles/default/bin/ffmpeg')) systemFfmpeg = '/nix/var/nix/profiles/default/bin/ffmpeg';
        else throw new Error('FFmpeg not found in common paths');
    }
    
    // Check ffprobe
    try {
        execSync('which ffprobe');
        systemFfprobe = 'ffprobe';
    } catch (e) {
        if (require('fs').existsSync('/usr/bin/ffprobe')) systemFfprobe = '/usr/bin/ffprobe';
        else if (require('fs').existsSync('/bin/ffprobe')) systemFfprobe = '/bin/ffprobe';
        else if (require('fs').existsSync('/usr/local/bin/ffprobe')) systemFfprobe = '/usr/local/bin/ffprobe';
        else if (require('fs').existsSync('/nix/var/nix/profiles/default/bin/ffprobe')) systemFfprobe = '/nix/var/nix/profiles/default/bin/ffprobe';
        else systemFfprobe = systemFfmpeg.replace('ffmpeg', 'ffprobe'); // Fallback
    }
    
    execSync(`${systemFfmpeg} -version`);
    execSync(`${systemFfprobe} -version`);
    ffmpeg.setFfmpegPath(systemFfmpeg);
    ffmpeg.setFfprobePath(systemFfprobe);
    IS_SYSTEM_FFMPEG = true;
    console.log(`[Optimizer] Using system FFmpeg: ${systemFfmpeg}, ffprobe: ${systemFfprobe}`);
} catch (e) {
    console.error('[Optimizer] System FFmpeg/ffprobe not found:', e.message);
    console.error('[Optimizer] Please ensure ffmpeg and ffprobe are installed in the system (nixpacks.toml for Railway)');
    console.error('[Optimizer] Application may not be able to transcode videos');
}

/**
 * Get video metadata using ffprobe
 * Returns: { width, height, codec, audioCodec, duration, bitrate }
 */
function getVideoMetadata(input) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(input, (err, metadata) => {
            if (err) return reject(err);
            
            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
            
            resolve({
                width: videoStream?.width || 0,
                height: videoStream?.height || 0,
                videoCodec: videoStream?.codec_name || 'unknown',
                audioCodec: audioStream?.codec_name || 'unknown',
                duration: parseFloat(metadata.format?.duration) || 0,
                bitrate: parseInt(metadata.format?.bit_rate) || 0
            });
        });
    });
}

/**
 * Quality profiles for transcoding
 */
const QUALITY_PROFILES = {
    '480': { width: 854, height: 480, scale: '854:-2', bitrate: '1000k', bufsize: '2M', crf: 26 },
    '720': { width: 1280, height: 720, scale: '1280:-2', bitrate: '2500k', bufsize: '5M', crf: 26 },
    '1080': { width: 1920, height: 1080, scale: '1920:-2', bitrate: '4000k', bufsize: '8M', crf: 26 },
    'original': { scale: null, bitrate: null, bufsize: null, crf: 23 } // No scaling
};

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
 * Now accepts quality parameter for dynamic resolution.
 */
function getTranscodeStream(input, startTime = 0, quality = '720', headers = null) {
    console.log(`[Optimizer] Starting real-time transcode. Start: ${startTime}s, Quality: ${quality}`);
    
    const profile = QUALITY_PROFILES[quality] || QUALITY_PROFILES['720'];
    const passThrough = new PassThrough();
    const command = ffmpeg(input);

    const inputOptions = [
        '-threads', '1',
        '-probesize', '5M',
        '-analyzeduration', '5M',
        '-fflags', '+genpts+igndts',
        '-err_detect', 'ignore_err'
    ];

    if (typeof input === 'string') {
        if (headers) inputOptions.push('-headers', headers.trim() + '\r\n');
        // Fast seeking before input
        inputOptions.push('-ss', startTime.toString());
    }

    command.inputOptions(inputOptions);

    if (quality === 'original') {
        command.videoCodec('copy').audioCodec('aac'); // Still transcode audio to AAC for better compatibility
    } else {
        command.videoCodec('libx264').audioCodec('aac');
        command.audioChannels(2);
    }

    command
        .format('mp4')
        .outputOptions([
            '-preset', 'ultrafast', 
            '-tune', 'zerolatency',
            '-profile:v', profile.height <= 480 ? 'baseline' : 'main', 
            '-level', profile.height <= 480 ? '3.0' : '4.1',
            '-pix_fmt', 'yuv420p',
            '-movflags', 'frag_keyframe+empty_moov+default_base_moof+omit_tfhd_offset+frag_discont', 
            '-crf', profile.crf.toString(),
            '-threads', '1',
            '-map_chapters', '-1',
            '-max_muxing_queue_size', '1024'
        ]);

    // Slow seeking after input if it's a pipe
    if (typeof input !== 'string') {
        command.outputOptions(['-ss', startTime.toString()]);
    }

    // Add scaling only if not 'original' quality
    if (profile.scale) {
        command.videoFilter(`scale=${profile.scale}`);
    }

    // Add bitrate control only if specified
    if (profile.bitrate) {
        command.outputOptions(['-b:v', profile.bitrate, '-bufsize', profile.bufsize]);
    }

    command
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
            '-b:v', profile.bitrate, 
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

module.exports = { 
    getOptimizedUploadStream, 
    getTranscodeStream, 
    getHLSSegmentStream, 
    getVideoMetadata,  // Export new function
    QUALITY_PROFILES, 
    IS_SYSTEM_FFMPEG 
};
