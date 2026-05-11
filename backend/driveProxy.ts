import express, { type Request, type Response } from 'express'
import cors from 'cors'

const app = express()
app.use(cors())

app.get('/ping', (req: Request, res: Response) => res.send('pong'))

app.get('/stream/:fileId', async (req: Request, res: Response) => {
  try {
    const driveApi = require('./drive')
    const { fileId } = req.params
    const rangeHeader = req.headers.range as string | undefined
    const shouldTranscode = req.query.transcode === 'true'
    const startTime = parseFloat((req.query.t as string) || '0')

    if (shouldTranscode) {
      const token = await driveApi.getAuthToken()
      const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`

      const ffmpeg = require('fluent-ffmpeg')
      const { PassThrough } = require('stream')
      const pt = new PassThrough()

      let command = ffmpeg(driveUrl)
      if (startTime > 0) command = command.seekInput(startTime)

      command
        .videoCodec('copy')
        .audioCodec('aac')
        .audioChannels(2)
        .audioFrequency(44100)
        .format('mp4')
        .inputOptions(['-headers', `Authorization: Bearer ${token}`, '-fflags +fastseek'])
        .outputOptions([
          '-movflags frag_keyframe+empty_moov+default_base_moof+faststart',
          '-map 0:v?',
          '-map 0:a?',
          '-preset ultrafast',
          '-tune zerolatency',
          '-max_muxing_queue_size 1024',
        ])
        .on('error', (err: Error) => {
          console.error('[Drive Proxy] Transcode Error:', err.message)
          if (!res.headersSent) pt.end()
        })
        .pipe(pt)

      res.setHeader('Content-Type', 'video/mp4')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      pt.pipe(res)
      return
    }

    await driveApi.streamVideo(fileId, rangeHeader, res)
  } catch (error) {
    const err = error as Error
    console.error('[Drive Proxy] Stream Error:', err)
    if (!res.headersSent) res.status(500).send('Streaming Error')
  }
})

let server: ReturnType<typeof app.listen> | null = null

const driveProxy = {
  start: (port: number = 19998) => {
    if (server) return
    return new Promise<boolean>((resolve, reject) => {
      try {
        server = app
          .listen(port, () => {
            resolve(true)
          })
          .on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
              resolve(true)
            } else {
              console.error('[Drive Proxy] Failed to start:', err)
              reject(err)
            }
          })
      } catch (e) {
        reject(e)
      }
    })
  },

  stop: () => {
    if (server) {
      server.close()
      server = null
    }
  },
}

export default driveProxy
