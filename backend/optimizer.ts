import ffmpeg, { FfmpegCommand } from 'fluent-ffmpeg'
import { PassThrough, type Writable } from 'stream'
import { execSync } from 'child_process'
import fs from 'fs'

interface PassThroughWithCommand extends PassThrough {
  ffmpegCommand?: FfmpegCommand
}

interface VideoMetadata {
  width: number
  height: number
  videoCodec: string
  audioCodec: string
  duration: number
  bitrate: number
}

interface AudioTrack {
  index: number
  streamIndex: number
  codec: string
  language: string
  title: string
}

interface QualityProfile {
  width: number
  height: number
  scale: string | null
  bitrate: string | null
  bufsize: string | null
  crf: number
}

let activeTranscodes = 0
let CURRENT_FFMPEG_PATH = ''
let IS_SYSTEM_FFMPEG = false

try {
  let systemFfmpeg = 'ffmpeg'
  let systemFfprobe = 'ffprobe'

  try {
    execSync('which ffmpeg')
    systemFfmpeg = 'ffmpeg'
  } catch (_e) {
    if (fs.existsSync('/usr/bin/ffmpeg')) systemFfmpeg = '/usr/bin/ffmpeg'
    else if (fs.existsSync('/bin/ffmpeg')) systemFfmpeg = '/bin/ffmpeg'
    else if (fs.existsSync('/usr/local/bin/ffmpeg')) systemFfmpeg = '/usr/local/bin/ffmpeg'
    else if (fs.existsSync('/nix/var/nix/profiles/default/bin/ffmpeg'))
      systemFfmpeg = '/nix/var/nix/profiles/default/bin/ffmpeg'
    else throw new Error('FFmpeg not found in common paths')
  }

  try {
    execSync('which ffprobe')
    systemFfprobe = 'ffprobe'
  } catch (_e) {
    if (fs.existsSync('/usr/bin/ffprobe')) systemFfprobe = '/usr/bin/ffprobe'
    else if (fs.existsSync('/bin/ffprobe')) systemFfprobe = '/bin/ffprobe'
    else if (fs.existsSync('/usr/local/bin/ffprobe')) systemFfprobe = '/usr/local/bin/ffprobe'
    else if (fs.existsSync('/nix/var/nix/profiles/default/bin/ffprobe'))
      systemFfprobe = '/nix/var/nix/profiles/default/bin/ffprobe'
    else systemFfprobe = systemFfmpeg.replace('ffmpeg', 'ffprobe')
  }

  execSync(`${systemFfmpeg} -version`)
  execSync(`${systemFfprobe} -version`)
  ffmpeg.setFfmpegPath(systemFfmpeg)
  ffmpeg.setFfprobePath(systemFfprobe)
  IS_SYSTEM_FFMPEG = true
  console.log(`[Optimizer] Using system FFmpeg: ${systemFfmpeg}, ffprobe: ${systemFfprobe}`)
} catch (e) {
  const error = e as Error
  console.error('[Optimizer] System FFmpeg/ffprobe not found:', error.message)
}

function getVideoMetadata(input: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(input, (err, metadata) => {
      if (err) return reject(err)

      const videoStream = metadata.streams.find((s) => s.codec_type === 'video')
      const audioStream = metadata.streams.find((s) => s.codec_type === 'audio')

      resolve({
        width: videoStream?.width || 0,
        height: videoStream?.height || 0,
        videoCodec: videoStream?.codec_name || 'unknown',
        audioCodec: audioStream?.codec_name || 'unknown',
        duration: parseFloat(String(metadata.format?.duration)) || 0,
        bitrate: parseInt(String(metadata.format?.bit_rate), 10) || 0,
      })
    })
  })
}

function probeAudioTracks(
  input: string,
  headers: string | null = null
): Promise<AudioTrack[]> {
  const { spawn } = require('child_process')
  return new Promise((resolve, reject) => {
    const args = [
      '-v',
      'error',
      '-show_entries',
      'stream=index,codec_type,codec_name:stream_tags=language,title,LANGUAGE,TITLE',
      '-of',
      'json',
    ]

    if (headers) {
      const h = headers.endsWith('\r\n') ? headers : headers + '\r\n'
      args.push('-headers', h)
    }

    args.push(input)

    const ffprobe = spawn('ffprobe', args)
    let stdout = ''
    let stderr = ''

    ffprobe.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })
    ffprobe.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    ffprobe.on('close', (code: number) => {
      if (code !== 0) {
        console.error('[Optimizer] ffprobe error:', stderr)
        return reject(new Error(stderr || `ffprobe exited with code ${code}`))
      }

      try {
        const metadata = JSON.parse(stdout)
        const audioStreams = (metadata.streams || []).filter(
          (s: { codec_type: string }) => s.codec_type === 'audio'
        )
        const tracks: AudioTrack[] = audioStreams.map(
          (s: { index: number; codec_name: string; tags?: Record<string, string> }, idx: number) => ({
            index: idx,
            streamIndex: s.index,
            codec: s.codec_name || 'unknown',
            language: s.tags?.language || s.tags?.LANGUAGE || 'unknown',
            title: s.tags?.title || s.tags?.TITLE || `Pista ${idx + 1}`,
          })
        )

        resolve(tracks)
      } catch (e) {
        const error = e as Error
        reject(new Error('Error al parsear metadatos de audio: ' + error.message))
      }
    })
  })
}

const QUALITY_PROFILES: Record<string, QualityProfile> = {
  '480': { width: 854, height: 480, scale: '854:-2', bitrate: '1000k', bufsize: '2M', crf: 26 },
  '720': { width: 1280, height: 720, scale: '1280:-2', bitrate: '2500k', bufsize: '5M', crf: 26 },
  '1080': { width: 1920, height: 1080, scale: '1920:-2', bitrate: '4000k', bufsize: '8M', crf: 26 },
  original: { width: 0, height: 0, scale: null, bitrate: null, bufsize: null, crf: 23 },
}

function getOptimizedUploadStream(inputPath: string): PassThroughWithCommand {
  const passThrough = new PassThrough()
  ffmpeg(inputPath)
    .videoCodec('libx264')
    .audioCodec('aac')
    .format('mp4')
    .outputOptions([
      '-preset',
      'ultrafast',
      '-crf',
      '28',
      '-movflags',
      'frag_keyframe+empty_moov',
    ])
    .on('start', (cmd) => console.log(`[Optimizer] FFmpeg started: ${cmd}`))
    .on('error', (err) => {
      console.error('[Optimizer] FFmpeg Error:', err.message)
      passThrough.destroy(err)
    })
    .on('end', () => {
      console.log('[Optimizer] Compression finished')
      passThrough.end()
    })
    .pipe(passThrough as Writable)

  return passThrough
}

function getTranscodeStream(
  input: string | PassThrough,
  startTime: number = 0,
  quality: string = '720',
  headers: string | null = null,
  audioTrack: number | null = null
): PassThroughWithCommand {
  const profile = QUALITY_PROFILES[quality] || QUALITY_PROFILES['720']
  const passThrough = new PassThrough() as PassThroughWithCommand
  const command = ffmpeg(input as string)

  activeTranscodes++
  console.log(
    `[Optimizer] Starting transcode. Active: ${activeTranscodes}. Start: ${startTime}s, Quality: ${quality}, AudioTrack: ${audioTrack}`
  )

  const inputOptions = [
    '-threads',
    '0',
    '-probesize',
    '20M',
    '-analyzeduration',
    '20M',
    '-fflags',
    '+genpts+igndts',
    '-err_detect',
    'ignore_err',
    '-reconnect',
    '1',
    '-reconnect_at_eof',
    '1',
    '-reconnect_streamed',
    '1',
    '-reconnect_delay_max',
    '5',
  ]

  if (typeof input === 'string') {
    if (headers) inputOptions.push('-headers', headers.trim() + '\r\n')
    inputOptions.push('-ss', startTime.toString())
  }

  command.inputOptions(inputOptions)

  if (quality === 'original') {
    command.videoCodec('copy').audioCodec('aac')
  } else {
    command.videoCodec('libx264').audioCodec('aac')
    command.audioChannels(2)
  }

  command.format('mp4')

  const outputOpts = [
    '-preset',
    'ultrafast',
    '-tune',
    'zerolatency',
    '-profile:v',
    profile.height <= 480 ? 'baseline' : 'main',
    '-level',
    profile.height <= 480 ? '3.0' : '4.1',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    'frag_keyframe+empty_moov+default_base_moof+omit_tfhd_offset+frag_discont',
    '-crf',
    (profile.crf + 4).toString(),
    '-threads',
    '0',
    '-map_chapters',
    '-1',
    '-max_muxing_queue_size',
    '4096',
  ]

  if (audioTrack !== null && audioTrack !== undefined) {
    outputOpts.push('-map', '0:v:0')
    outputOpts.push('-map', `0:a:${audioTrack}`)
  }

  command.outputOptions(outputOpts)
  if (typeof input !== 'string') {
    command.outputOptions(['-ss', startTime.toString()])
  }

  if (profile.scale) {
    command.videoFilter(`scale=${profile.scale}`)
  }

  if (profile.bitrate) {
    command.outputOptions(['-b:v', profile.bitrate, '-bufsize', profile.bufsize!])
  }

  command
    .on('start', (cmd) => console.log(`[Optimizer] FFmpeg Stream: ${cmd}`))
    .on('error', (err) => {
      if (
        err.message.includes('SIGKILL') ||
        err.message.includes('Output stream closed')
      ) {
        activeTranscodes--
        return
      }
      console.error('[Optimizer] FFmpeg Stream Error:', err.message)
      activeTranscodes--
      passThrough.destroy(err)
    })
    .on('end', () => {
      console.log('[Optimizer] Stream finished')
      activeTranscodes--
      passThrough.end()
    })

  command.pipe(passThrough as Writable)
  passThrough.ffmpegCommand = command
  return passThrough
}

process.on('exit', () => {
  if (activeTranscodes > 0)
    console.log(`[Optimizer] ${activeTranscodes} transcodes still active on exit`)
})

function getFmp4Stream(
  input: string,
  startTime: number = 0,
  headers: string | null = null,
  audioTrack: number | null = null
): PassThroughWithCommand {
  const passThrough = new PassThrough() as PassThroughWithCommand
  const command = ffmpeg(input)

  const inputOptions = [
    '-threads', '0',
    '-probesize', '10M',
    '-analyzeduration', '20M',
    '-fflags', '+genpts',
    '-reconnect', '1',
    '-reconnect_at_eof', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
  ]

  if (headers) {
    inputOptions.push('-headers', headers.trim() + '\r\n')
  }

  if (startTime > 0) {
    inputOptions.push('-ss', startTime.toString())
  }

  command.inputOptions(inputOptions)
  command.videoCodec('copy')
  command.audioCodec('copy')
  command.format('mp4')

  const outputOpts = [
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-threads', '0',
    '-map_chapters', '-1',
  ]

  if (audioTrack !== null && audioTrack !== undefined) {
    outputOpts.push('-map', '0:v:0')
    outputOpts.push('-map', `0:a:${audioTrack}`)
  }

  command.outputOptions(outputOpts)
  command
    .on('start', (cmd) => console.log(`[Optimizer] FMP4 stream: ${cmd}`))
    .on('error', (err) => {
      if (err.message.includes('SIGKILL') || err.message.includes('Output stream closed')) return
      console.error('[Optimizer] FMP4 stream Error:', err.message)
      passThrough.destroy(err)
    })
    .on('end', () => {
      console.log('[Optimizer] FMP4 stream finished')
      passThrough.end()
    })

  command.pipe(passThrough as Writable)
  passThrough.ffmpegCommand = command
  return passThrough
}

function getHLSSegmentStream(
  input: string | PassThrough,
  startTime: number,
  duration: number,
  headers: string | null,
  quality: string,
  realStartTime: number | null = null
): PassThroughWithCommand {
  const profile = QUALITY_PROFILES[quality] || QUALITY_PROFILES['480']
  const command = ffmpeg()
  const tsOffset = realStartTime !== null ? realStartTime : startTime

  const inputOptions = [
    '-threads',
    '2',
    '-probesize',
    '10M',
    '-analyzeduration',
    '10M',
    '-ignore_unknown',
    '-fflags',
    '+genpts+igndts+discardcorrupt',
    '-err_detect',
    'ignore_err',
  ]

  if (typeof input === 'string' && input.startsWith('http')) {
    if (headers) inputOptions.push('-headers', headers.trim() + '\r\n')
    inputOptions.push('-ss', startTime.toString())
    command.input(input)
  } else {
    command.input(input)
    command.inputOptions(inputOptions)
  }

  const stream = new PassThrough() as PassThroughWithCommand

  command
    .inputOptions(inputOptions)
    .outputOptions([
      '-ss',
      typeof input === 'string' ? '0' : startTime.toString(),
      '-t',
      duration.toString(),
      '-output_ts_offset',
      tsOffset.toString(),
      '-preset',
      'ultrafast',
      '-profile:v',
      'main',
      '-level',
      '4.1',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '30',
      '-crf',
      profile.crf.toString(),
      '-b:v',
      profile.bitrate!,
      '-bufsize',
      profile.bufsize!,
      '-b:a',
      '128k',
      '-threads',
      '1',
      '-map_chapters',
      '-1',
      '-f',
      'mpegts',
    ])
    .on('start', (cmd) => {
      console.log(
        `[Optimizer] HLS Segment (${quality}p): ${startTime}s to ${startTime + duration}s`
      )
    })
    .on('error', (err) => {
      console.error('[Optimizer] HLS Segment Error:', err.message)
      stream.emit('error', err)
    })
    .pipe(stream as Writable, { end: true })

  stream.ffmpegCommand = command
  return stream
}

export {
  getOptimizedUploadStream,
  getTranscodeStream,
  getFmp4Stream,
  getHLSSegmentStream,
  getVideoMetadata,
  probeAudioTracks,
  QUALITY_PROFILES,
  IS_SYSTEM_FFMPEG,
}
