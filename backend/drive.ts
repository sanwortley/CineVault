import { google } from 'googleapis'
import http from 'http'
import path from 'path'
import fs from 'fs'
import os from 'os'

import type { Response } from 'express'

const getTokenPath = (): string => {
  if (process.env.DRIVE_TOKEN_PATH) return process.env.DRIVE_TOKEN_PATH
  if (process.env.DRIVE_TOKEN_VOLUME_PATH)
    return path.join(process.env.DRIVE_TOKEN_VOLUME_PATH, 'drive-token.json')
  return path.join(os.tmpdir(), 'cinevault-drive-token.json')
}

const PORT = process.env.PORT || '3001'
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${BACKEND_URL}/api/auth/callback`
)

try {
  const tokenPath = getTokenPath()
  if (fs.existsSync(tokenPath)) {
    const token = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'))
    oauth2Client.setCredentials(token)
  }
} catch (e) {
  console.error('[Drive] Invalid token file, clearing...')
}

oauth2Client.on('tokens', (tokens) => {
  const tokenPath = getTokenPath()
  let existing: Record<string, unknown> = {}
  try {
    if (fs.existsSync(tokenPath))
      existing = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'))
  } catch (_) {
    console.warn('[Drive] Could not read existing token file, starting fresh')
  }
  fs.writeFileSync(tokenPath, JSON.stringify({ ...existing, ...tokens }))
})

interface DriveFileResult {
  id: string
  webContentLink?: string
  webViewLink?: string
  name?: string
  size?: string
  mimeType?: string
  parents?: string[]
}

interface UploadOptions {
  optimize?: boolean
}

interface TranscodeOptions {
  transcode?: boolean
  t?: string | number
  quality?: string
  audioTrack?: string | number
}

interface StreamOptions {
  headers?: Record<string, string>
}

interface TranscodeOptions {
  transcode?: boolean
  t?: string | number
  quality?: string
  audioTrack?: string | number
}

// In-memory metadata cache for Drive files
const fileMetaCache = new Map<string, { size: number; mimeType: string }>()

const driveApi = {
  isAuthenticated: (): boolean =>
    !!oauth2Client.credentials &&
    !!(oauth2Client.credentials as { access_token?: string }).access_token,

  getAuthUrl: (redirectUri?: string): string => {
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive.readonly',
      ],
      redirect_uri: redirectUri,
    })
  },

  getTokens: async (code: string, redirectUri?: string) => {
    const { tokens } = await oauth2Client.getToken({ code, redirect_uri: redirectUri })
    return tokens
  },

  getAccessToken: async (): Promise<string> => {
    const { token } = await oauth2Client.getAccessToken()
    return token!
  },

  getOAuthClient: () => oauth2Client,

  authenticate: async (): Promise<boolean> => {
    return new Promise((resolve, reject) => {
      if (driveApi.isAuthenticated()) return resolve(true)
      const url = driveApi.getAuthUrl()
      const server = http
        .createServer(async (req, res) => {
          if (req.url?.startsWith('/api/auth/callback')) {
            const parsedUrl = new URL(req.url, BACKEND_URL)
            const code = parsedUrl.searchParams.get('code')
            if (code) {
              res.end(
                '<h1>Authenticacion Exitosa!</h1><script>window.close()</script>'
              )
              server.close()
              const tokens = await driveApi.getTokens(code)
              oauth2Client.setCredentials(tokens)
              fs.writeFileSync(getTokenPath(), JSON.stringify(tokens))
              resolve(true)
            }
          }
        })
        .listen(PORT)
    })
  },

  getClient: () => google.drive({ version: 'v3', auth: oauth2Client }),

  getOrCreateFolder: async (folderName: string): Promise<string> => {
    const drive = driveApi.getClient()
    const response = await drive.files.list({
      q: `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
    if (response.data.files && response.data.files.length > 0)
      return response.data.files[0].id!
    const folder = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id',
      supportsAllDrives: true,
    })
    return folder.data.id!
  },

  uploadVideo: async (
    filePath: string,
    mimeType: string,
    onProgress?: (progress: number, bytesRead: number, fileSize: number) => void,
    options: UploadOptions = {}
  ): Promise<DriveFileResult> => {
    if (!driveApi.isAuthenticated()) throw new Error('Not authenticated')
    if (!filePath || filePath.toLowerCase() === 'pending')
      throw new Error(
        'El archivo aún no está listo para subida (status: pending)'
      )
    if (!fs.existsSync(filePath))
      throw new Error(
        `Archivo no encontrado en el sistema local: ${filePath}`
      )

    const drive = driveApi.getClient()
    const fileName = path.basename(filePath)
    const fileSize = fs.statSync(filePath).size
    const folderId = await driveApi.getOrCreateFolder('CineVault')

    let body: fs.ReadStream | NodeJS.ReadableStream
    body = fs.createReadStream(filePath)
    if (options.optimize) {
      const { getOptimizedUploadStream } = require('./optimizer')
      body = getOptimizedUploadStream(filePath)
    }

    const res = await drive.files.create(
      {
        requestBody: {
          name: options.optimize
            ? fileName.replace(/\.[^/.]+$/, '') + ' (Optimized).mp4'
            : fileName,
          parents: [folderId],
        },
        media: {
          mimeType: options.optimize ? 'video/mp4' : mimeType || 'video/mp4',
          body: body as unknown as Buffer,
        },
        uploadType: 'resumable' as const,
        supportsAllDrives: true,
        fields: 'id, webContentLink, webViewLink',
      },
      {
        onUploadProgress: (evt: { bytesRead: number }) => {
          if (onProgress) {
            let progress = Math.round((evt.bytesRead / fileSize) * 100)
            if (options.optimize) progress = Math.min(progress, 99)
            else progress = Math.min(progress, 100)
            onProgress(progress, evt.bytesRead, fileSize)
          }
        },
      }
    )

    try {
      await drive.permissions.create({
        fileId: res.data.id!,
        requestBody: { role: 'reader', type: 'anyone' },
        supportsAllDrives: true,
      })
    } catch (e) {
      const error = e as Error
      console.warn('[Drive] Could not set file public permission:', error.message)
    }
    return res.data as DriveFileResult
  },

  uploadBasicFile: async (
    filePath: string,
    folderId: string,
    fileName: string
  ): Promise<DriveFileResult> => {
    if (!driveApi.isAuthenticated()) throw new Error('Not authenticated')
    const drive = driveApi.getClient()
    const res = await drive.files.create({
      requestBody: { name: fileName, parents: [folderId] },
      media: { body: fs.createReadStream(filePath) as unknown as Buffer },
      supportsAllDrives: true,
      fields: 'id',
    })
    return res.data as DriveFileResult
  },

  getFileContent: async (fileId: string): Promise<string> => {
    if (!driveApi.isAuthenticated()) throw new Error('Not authenticated')
    const drive = driveApi.getClient()
    try {
      const res = await drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'text' }
      )
      return res.data as string
    } catch (err) {
      const error = err as Error
      console.error('[Drive] Error getting file content:', error.message)
      throw err
    }
  },

  getStream: async (
    fileId: string,
    options: StreamOptions = {}
  ): Promise<NodeJS.ReadableStream> => {
    const hasToken = driveApi.isAuthenticated()
    const apiKey = process.env.GOOGLE_API_KEY

    if (hasToken) {
      try {
        const drive = driveApi.getClient()
        const driveRes = await drive.files.get(
          { fileId, alt: 'media', supportsAllDrives: true },
          { responseType: 'stream', ...options }
        )
        return driveRes.data as unknown as NodeJS.ReadableStream
      } catch (err) {
        if (apiKey) {
          const axios = require('axios')
          const driveRes = await axios.get(
            `https://www.googleapis.com/drive/v3/files/${fileId}`,
            {
              params: { alt: 'media', key: apiKey, supportsAllDrives: true },
              responseType: 'stream',
              ...options,
            }
          )
          return driveRes.data as NodeJS.ReadableStream
        }
        throw err
      }
    } else if (apiKey) {
      const axios = require('axios')
      const driveRes = await axios.get(
        `https://www.googleapis.com/drive/v3/files/${fileId}`,
        {
          params: { alt: 'media', key: apiKey, supportsAllDrives: true },
          responseType: 'stream',
          ...options,
        }
      )
      return driveRes.data as NodeJS.ReadableStream
    }
    throw new Error('No authentication method available')
  },

  getDirectStreamUrl: async (fileId: string): Promise<string | null> => {
    const hasToken = driveApi.isAuthenticated()
    const apiKey = process.env.GOOGLE_API_KEY
    if (hasToken) {
      try {
        const accessToken = (oauth2Client.credentials as { access_token?: string }).access_token
        if (accessToken) {
          return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true&access_token=${accessToken}`
        }
      } catch { }
    }
    if (apiKey) {
      return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${apiKey}&supportsAllDrives=true`
    }
    return null
  },

  getFileMeta: async (fileId: string): Promise<{ size: number; mimeType: string }> => {
    const cached = fileMetaCache.get(fileId)
    if (cached) return cached

    const drive = driveApi.getClient()
    const meta = await drive.files.get({
      fileId,
      fields: 'size, mimeType',
      supportsAllDrives: true,
    })
    const result = {
      size: parseInt(meta.data.size as string, 10),
      mimeType: meta.data.mimeType!,
    }
    fileMetaCache.set(fileId, result)
    return result
  },

  streamVideo: async (
    fileId: string,
    rangeHeader: string | undefined,
    res: Response,
    transcodeOptions: TranscodeOptions = {}
  ): Promise<void> => {
    const drive = driveApi.getClient()
    const hasToken = driveApi.isAuthenticated()
    const apiKey = process.env.GOOGLE_API_KEY

    // Fast path: redirect browser directly to Google Drive CDN
    if (!transcodeOptions.transcode) {
      const directUrl = await driveApi.getDirectStreamUrl(fileId)
      if (directUrl) {
        const meta = await driveApi.getFileMeta(fileId)
        console.log(`[DriveStream] Redirecting to direct URL for file ${fileId} (${meta.mimeType}, ${meta.size} bytes)`)
        res.set('Access-Control-Allow-Origin', '*')
        res.redirect(directUrl)
        return
      }
    }

    // Fallback: proxy through server
    try {
      let fileSize: number
      let contentType: string
      if (hasToken) {
        const meta = await driveApi.getFileMeta(fileId)
        fileSize = meta.size
        contentType = meta.mimeType
      } else if (apiKey) {
        const axios = require('axios')
        const metaRes = await axios.get(
          `https://www.googleapis.com/drive/v3/files/${fileId}`,
          {
            params: { fields: 'size,mimeType', key: apiKey, supportsAllDrives: true },
          }
        )
        fileSize = parseInt(metaRes.data.size, 10)
        contentType = metaRes.data.mimeType
      } else {
        throw new Error('No authentication method available')
      }

      if (transcodeOptions.transcode) {
        const startTime = parseFloat(String(transcodeOptions.t || 0))

        res.writeHead(200, {
          'Content-Type': 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
          'Access-Control-Allow-Origin': '*',
          'X-Accel-Buffering': 'no',
          Connection: 'keep-alive',
          'Cache-Control': 'no-cache',
        })

        try {
          const { getTranscodeStream } = require('./optimizer')
          const quality = transcodeOptions.quality || '720'
          let transcodeSource: string | NodeJS.ReadableStream
          let headers: string | null = null

          if (hasToken) {
            const accessToken = (
              oauth2Client.credentials as { access_token?: string }
            ).access_token
            headers = `Authorization: Bearer ${accessToken}`
            transcodeSource = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`
          } else if (apiKey) {
            transcodeSource = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${apiKey}&supportsAllDrives=true`
          } else {
            const axios = require('axios')
            const driveRes = await axios.get(
              `https://www.googleapis.com/drive/v3/files/${fileId}`,
              {
                params: { alt: 'media', key: apiKey, supportsAllDrives: true },
                responseType: 'stream',
              }
            )
            transcodeSource = driveRes.data
          }

          const transcodeStream = getTranscodeStream(
            transcodeSource,
            startTime,
            quality,
            headers,
            transcodeOptions.audioTrack ? Number(transcodeOptions.audioTrack) : null
          )
          transcodeStream.pipe(res)

          res.on('close', () => {
            if (transcodeStream.ffmpegCommand)
              transcodeStream.ffmpegCommand.kill()
          })
        } catch (streamErr) {
          const err = streamErr as Error
          console.error(
            '[DriveStream] Critical error during stream initialization:',
            err.message
          )
          if (
            err.message &&
            err.message.toLowerCase().includes('invalid_grant')
          ) {
            console.error(
              '[DriveStream] Authentication expired. User needs to re-link Google Drive.'
            )
            try {
              await driveApi.disconnect()
            } catch (e) {
              const disconnectErr = e as Error
              console.warn('[DriveStream] Disconnect failed:', disconnectErr.message)
            }
          }
          if (!res.headersSent) {
            res
              .status(500)
              .json({
                error: 'Error al obtener flujo de Drive',
                details: err.message,
              })
          }
        }
        return
      }

      // Direct/Range path
      const respHeaders: Record<string, string | number> = {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
      }

      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
        respHeaders['Content-Range'] = `bytes ${start}-${end}/${fileSize}`
        respHeaders['Content-Length'] = end - start + 1
        res.writeHead(206, respHeaders)
        if (hasToken) {
          const response = await drive.files.get(
            { fileId, alt: 'media', supportsAllDrives: true },
            {
              responseType: 'stream',
              headers: { Range: rangeHeader },
            }
          )
          ;(response.data as unknown as NodeJS.ReadableStream).pipe(res)
        } else {
          const axios = require('axios')
          const response = await axios.get(
            `https://www.googleapis.com/drive/v3/files/${fileId}`,
            {
              params: { alt: 'media', key: apiKey, supportsAllDrives: true },
              headers: { Range: rangeHeader },
              responseType: 'stream',
            }
          )
          ;(response.data as NodeJS.ReadableStream).pipe(res)
        }
      } else {
        respHeaders['Content-Length'] = fileSize
        res.writeHead(200, respHeaders)
        if (hasToken) {
          const response = await drive.files.get(
            { fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'stream' }
          )
          ;(response.data as unknown as NodeJS.ReadableStream).pipe(res)
        } else {
          const axios = require('axios')
          const response = await axios.get(
            `https://www.googleapis.com/drive/v3/files/${fileId}`,
            {
              params: { alt: 'media', key: apiKey, supportsAllDrives: true },
              responseType: 'stream',
            }
          )
          ;(response.data as NodeJS.ReadableStream).pipe(res)
        }
      }
    } catch (err) {
      const error = err as Error
      console.error('[Drive Stream] Error:', error.message)
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Streaming Error',
          message: error.message,
          stack:
            process.env.NODE_ENV === 'development' ? error.stack : undefined,
        })
      }
    }
  },

  list: async (folderId: string = 'root') => {
    const drive = driveApi.getClient()
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
    return res.data.files
  },

  getFileParent: async (fileId: string): Promise<string | null> => {
    const drive = driveApi.getClient()
    try {
      const res = await drive.files.get({
        fileId,
        fields: 'parents',
        supportsAllDrives: true,
      })
      return res.data.parents?.[0] || null
    } catch (e) {
      return null
    }
  },

  disconnect: async (): Promise<void> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    oauth2Client.setCredentials({} as any)
    const tokenPath = getTokenPath()
    if (fs.existsSync(tokenPath)) fs.unlinkSync(tokenPath)
  },
}

export default driveApi
