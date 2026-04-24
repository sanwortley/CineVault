const ffmpeg = require('fluent-ffmpeg');
const { PassThrough } = require('stream');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

// Configure paths for standalone execution
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

/**
 * Returns a stream that compresses a video file on-the-fly using H.265.
 * This significantly reduces file size (often by 50-70%) at the cost of CPU usage.
 */
function getOptimizedUploadStream(filePath) {
    console.log(`[Optimizer] Starting smart compression for: ${filePath}`);
    
    const passThrough = new PassThrough();
    
    ffmpeg(filePath)
        .videoCodec('libx265') // HEVC for maximum compression
        .audioCodec('aac')
        .audioChannels(2)
        .format('matroska') // Streamable container
        .outputOptions([
            '-crf 26', // High efficiency quality setting
            '-preset ultrafast', // Fast encoding to keep up with upload speed
            '-tune zerolatency',
            '-movflags +faststart'
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
    const command = ffmpeg(input)
        .seekInput(startTime)
        .videoCodec('libx264')
        .audioCodec('aac')
        .audioChannels(2)
        .audioFrequency(44100)
        .audioBitrate('128k')
        .format('mp4')
        .outputOptions([
            '-preset ultrafast',
            '-tune zerolatency',
            '-profile:v baseline', 
            '-level 3.0',
            '-pix_fmt yuv420p',
            '-movflags +frag_keyframe+empty_moov+default_base_moof+omit_tfhd_offset+negative_cts_offsets', 
            '-metadata:s:v:0 rotate=0',
            '-crf 23',
            '-maxrate 5M',
            '-bufsize 10M',
            '-g 48',
            '-map_chapters -1'
        ])
        .videoFilters('scale=min(1280\\,iw):-2')
        .on('start', (cmd) => console.log(`[Optimizer] FFmpeg Stream: ${cmd}`))
        .on('error', (err) => {
            if (err.message.includes('SIGKILL') || err.message.includes('Output stream closed')) {
                // User stopped playback, normal behavior
                return;
            }
            console.error('[Optimizer] FFmpeg Stream Error:', err.message);
            passThrough.destroy(err);
        })
        .on('end', () => {
            console.log('[Optimizer] Stream finished');
            passThrough.end();
        });

    command.pipe(passThrough);
    
    // Allow the caller to kill the process if the client disconnects
    passThrough.ffmpegCommand = command;
    
    return passThrough;
}

module.exports = { getOptimizedUploadStream, getTranscodeStream };
