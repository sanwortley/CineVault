import { google } from 'googleapis'
import http from 'http'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { spawn } from 'child_process'

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
  fmp4?: boolean
  t?: string | number
  quality?: string
  audioTrack?: string | number
}

interface StreamOptions {
  headers?: Record<string, string>
}

interface TranscodeOptions {
  transcode?: boolean
  fmp4?: boolean
  t?: string | number
  quality?: string
  audioTrack?: string | number
}

// In-memory metadata cache for Drive files
const fileMetaCache = new Map<string, { size: number; mimeType: string }>()
const moovMetaCache = new Map<string, { ftypSize: number; moovSize: number }>()

// LRU cache tracking for local file downloads (evict old files when disk is full)
const DISK_LIMIT_BYTES = 4 * 1024 * 1024 * 1024 // 4GB
const localFileAccess = new Map<string, number>() // fileId -> last access timestamp
let localDiskUsed = 0

function touchLocalFile(fileId: string): void {
  localFileAccess.set(fileId, Date.now())
}

function ensureDiskSpace(fileId: string, fileSize: number): void {
  localDiskUsed += fileSize
  touchLocalFile(fileId)

  if (localDiskUsed <= DISK_LIMIT_BYTES) return

  const sorted = [...localFileAccess.entries()].sort((a, b) => a[1] - b[1])
  const localDir = path.join(os.tmpdir(), 'cinevault-files')

  for (const [id, _ts] of sorted) {
    if (localDiskUsed <= DISK_LIMIT_BYTES * 0.7) break
    if (id === fileId) continue
    const fp = path.join(localDir, id)
    try {
      if (fs.existsSync(fp)) {
        const stat = fs.statSync(fp)
        fs.unlinkSync(fp)
        localDiskUsed -= stat.size
        localFileAccess.delete(id)
        console.log(`[Cache] Evicted ${id} (freed ${(stat.size / 1e9).toFixed(2)}GB)`)
      }
    } catch {}
  }
}

// Recursively adjusts stco/co64 chunk offsets within a moov box by the given adjustment.
// stco entries point to absolute byte positions in the original file; after moov injection,
// all mdat content shifts right by moovSize, so every entry must be incremented.
function adjustStco(data: Buffer, adjustment: number): void {
  let offset = 0
  while (offset + 8 <= data.length) {
    const boxSize = data.readUInt32BE(offset)
    const boxType = data.toString('ascii', offset + 4, offset + 8)
    if (boxSize < 8 || offset + boxSize > data.length) break
    if (boxType === 'stco') {
      const count = data.readUInt32BE(offset + 12)
      for (let i = 0; i < count; i++) {
        const off = offset + 16 + i * 4
        if (off + 4 <= data.length)
          data.writeUInt32BE(data.readUInt32BE(off) + adjustment, off)
      }
    } else if (boxType === 'co64') {
      const count = data.readUInt32BE(offset + 12)
      for (let i = 0; i < count; i++) {
        const off = offset + 16 + i * 8
        if (off + 8 <= data.length) {
          const val = data.readBigUInt64BE(off)
          data.writeBigUInt64BE(val + BigInt(adjustment), off)
        }
      }
    } else if (['moov','trak','mdia','minf','stbl','dinf','edts','udta','mvex','moof','traf'].includes(boxType)) {
      if (boxSize > 8) adjustStco(data.subarray(offset + 8, offset + boxSize), adjustment)
    }
    if (boxSize === 0) break
    offset += boxSize
  }
}

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

  getWebContentLink: async (fileId: string): Promise<string | null> => {
    try {
      const drive = driveApi.getClient()
      const res = await drive.files.get({
        fileId,
        fields: 'webContentLink',
        supportsAllDrives: true,
      })
      return res.data.webContentLink || null
    } catch {
      return null
    }
  },

  streamVideo: async (
    fileId: string,
    rangeHeader: string | undefined,
    res: Response,
    transcodeOptions: TranscodeOptions = {}
  ): Promise<void> => {
    const tStart = Date.now()
    const drive = driveApi.getClient()
    const hasToken = driveApi.isAuthenticated()
    const apiKey = process.env.GOOGLE_API_KEY

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
      // Force video MIME type for known video extensions (Drive may store generic types)
      if (!contentType.startsWith('video/') && (fileId.endsWith('.mp4') || contentType === 'application/octet-stream')) {
        contentType = 'video/mp4'
      }
      console.log(`[DriveStream] Meta fetched for ${fileId} in ${Date.now() - tStart}ms (size=${fileSize})`)

      // ── Transcode path (FFmpeg) ──────────────────────────────────────────
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
            transcodeSource, startTime, quality, headers,
            transcodeOptions.audioTrack ? Number(transcodeOptions.audioTrack) : null
          )
          transcodeStream.pipe(res)
          res.on('close', () => {
            if (transcodeStream.ffmpegCommand) transcodeStream.ffmpegCommand.kill()
          })
        } catch (streamErr) {
          const err = streamErr as Error
          console.error('[DriveStream] Critical error during stream initialization:', err.message)
          if (err.message && err.message.toLowerCase().includes('invalid_grant')) {
            console.error('[DriveStream] Authentication expired. User needs to re-link Google Drive.')
            try { await driveApi.disconnect() } catch { /* ignore */ }
          }
          if (!res.headersSent) {
            res.status(500).json({ error: 'Error al obtener flujo de Drive', details: err.message })
          }
        }
        return
      }

      // ── FMP4 path (FFmpeg -c copy, no re-encode, for Safari) ─────────────
      if (transcodeOptions.fmp4) {
        const fmp4Start = Date.now()
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Access-Control-Allow-Origin': '*',
          'X-Accel-Buffering': 'no',
          'Cache-Control': 'no-cache',
        })
        try {
          const { getFmp4Stream } = require('./optimizer')
          let sourceUrl: string
          let headers: string | null = null
          if (hasToken) {
            const accessToken = (
              oauth2Client.credentials as { access_token?: string }
            ).access_token
            headers = `Authorization: Bearer ${accessToken}`
            sourceUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`
          } else if (apiKey) {
            sourceUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${apiKey}&supportsAllDrives=true`
          } else {
            throw new Error('No authentication method available')
          }
          const fmp4Stream = getFmp4Stream(sourceUrl, 0, headers, transcodeOptions.audioTrack ? Number(transcodeOptions.audioTrack) : null)
          fmp4Stream.pipe(res)
          res.on('close', () => {
            console.log(`[DriveStream] FMP4 client disconnected at ${Date.now() - fmp4Start}ms`)
            if (fmp4Stream.ffmpegCommand) fmp4Stream.ffmpegCommand.kill()
          })
        } catch (fmp4Err) {
          const err = fmp4Err as Error
          console.error('[DriveStream] FMP4 error:', err.message)
          if (!res.headersSent) {
            res.status(500).json({ error: 'FMP4 streaming error', details: err.message })
          }
        }
        return
      }

      // ── Direct proxy path (server-side, no CORS issues) ─────────────────
      const respHeaders: Record<string, string | number> = {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges',
      }

      const pipeFromDrive = async (range?: string) => {
        const opts: Record<string, unknown> = { responseType: 'stream' }
        if (range) opts.headers = { Range: range }
        const response = await drive.files.get(
          { fileId, alt: 'media', supportsAllDrives: true },
          opts
        )
        const driveStream = response.data as unknown as NodeJS.ReadableStream
        driveStream.pipe(res)
        driveStream.on('error', (streamErr: Error) => {
          console.error('[DriveStream] Pipe error at ${Date.now() - tStart}ms:', streamErr.message)
          if (!res.destroyed) res.destroy()
        })
        res.on('close', () => {
          console.log(`[DriveStream] Client disconnected at ${Date.now() - tStart}ms`)
          if (typeof (driveStream as any).destroy === 'function') (driveStream as any).destroy()
        })
      }

      // ── Moov detection (runs once per fileId, cached for subsequent Range requests) ──
      const TAIL_SIZE = 10 * 1024 * 1024 // 10MB
      const HEAD_SIZE = 100 * 1024 // 100KB
      let ftypSize = 0
      let moovSize = 0
      let moovBuf: Buffer | null = null
      let headBuf: Buffer | null = null

      const cachedMoov = moovMetaCache.get(fileId)
      if (cachedMoov) {
        ftypSize = cachedMoov.ftypSize
        moovSize = cachedMoov.moovSize
      }

      // Only fetch if not cached and file is large enough
      if (!cachedMoov && fileSize > HEAD_SIZE + TAIL_SIZE) {
        const accessToken = (oauth2Client.credentials as { access_token?: string }).access_token
        const baseUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`
        const authHeader = { Authorization: `Bearer ${accessToken}` }

        const [headRes, tailRes] = await Promise.all([
          fetch(baseUrl, { headers: { ...authHeader, Range: `bytes=0-${HEAD_SIZE - 1}` } }),
          fetch(baseUrl, { headers: { ...authHeader, Range: `bytes=-${TAIL_SIZE}` } }),
        ])
        if (headRes.ok && tailRes.ok) {
          headBuf = Buffer.from(await headRes.arrayBuffer())
          const tailBuf = Buffer.from(await tailRes.arrayBuffer())

          ftypSize = headBuf.readUInt32BE(0)
          const moovAtStart = headBuf.length > ftypSize + 4 &&
            headBuf.toString('ascii', ftypSize, ftypSize + 4) === 'moov'

          if (!moovAtStart) {
            for (let i = 0; i <= tailBuf.length - 8; i += 4) {
              if (tailBuf.toString('ascii', i + 4, i + 8) === 'moov') {
                const boxSize = tailBuf.readUInt32BE(i)
                if (boxSize >= 8 && i + boxSize <= tailBuf.length) {
                  moovBuf = tailBuf.subarray(i, i + boxSize)
                  break
                }
              }
            }
            if (moovBuf) {
              moovSize = moovBuf.length
              adjustStco(moovBuf, moovSize)
              console.log(`[DriveStream] Adjusted stco offsets by +${moovSize} (${Date.now() - tStart}ms)`)
            }
          }
          moovMetaCache.set(fileId, { ftypSize, moovSize })
          console.log(`[DriveStream] Moov detection: ftypSize=${ftypSize} moovSize=${moovSize} (${Date.now() - tStart}ms)`)
        }
      }

      // ── Parse Range header ──
      let rangeStart = 0
      let rangeEnd = fileSize - 1
      let isRange = false
      if (rangeHeader) {
        isRange = true
        const rangeMatch = rangeHeader.replace(/bytes=/, '').split('-')
        if (rangeMatch[0] === '') {
          const suffixLen = parseInt(rangeMatch[1], 10)
          rangeStart = Math.max(0, fileSize - suffixLen)
          rangeEnd = fileSize - 1
        } else {
          rangeStart = parseInt(rangeMatch[0], 10)
          rangeEnd = rangeMatch[1] ? parseInt(rangeMatch[1], 10) : fileSize - 1
        }
        if (isNaN(rangeStart)) { res.status(416).end(); return }
      }

      const isFullFile = !isRange || (rangeStart === 0 && rangeEnd >= fileSize - 1)

      // ── Full-file request: serve with moov injection if non-faststart ──
      if (isFullFile) {
        if (moovBuf) {
          console.log(`[DriveStream] Injecting moov (${moovSize} bytes) after ftyp (${ftypSize} bytes) (${Date.now() - tStart}ms)`)
          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': fileSize,
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges',
          })
          res.write(headBuf!.subarray(0, ftypSize))
          res.write(moovBuf)

          const restEnd = Math.max(ftypSize, fileSize - moovSize - 1)
          if (restEnd > ftypSize) {
            const restRange = `bytes=${ftypSize}-${restEnd}`
            const restOpts: Record<string, unknown> = { responseType: 'stream' }
            restOpts.headers = { Range: restRange }
            const restRes = await drive.files.get(
              { fileId, alt: 'media', supportsAllDrives: true },
              restOpts
            )
            const restStream = restRes.data as unknown as NodeJS.ReadableStream
            restStream.pipe(res)
            restStream.on('error', (e: Error) => {
              console.error('[DriveStream] Rest stream error:', e.message)
              if (!res.destroyed) res.destroy()
            })
            res.on('close', () => {
              console.log(`[DriveStream] Client disconnected at ${Date.now() - tStart}ms`)
              if (typeof (restStream as any).destroy === 'function') (restStream as any).destroy()
            })
          } else {
            res.end()
          }
        } else {
          console.log(`[DriveStream] Faststart/moov-not-found, serving from byte 0 (${Date.now() - tStart}ms)`)
          respHeaders['Content-Length'] = fileSize
          res.writeHead(200, respHeaders)
          await pipeFromDrive()
        }
        return
      }

      // ── Partial Range request: adjust by moovSize and proxy to GD ──
      const browserStart = rangeStart
      const browserEnd = rangeEnd
      if (moovSize > 0) {
        rangeStart = Math.max(0, rangeStart - moovSize)
        rangeEnd = Math.max(0, rangeEnd - moovSize)
      }
      respHeaders['Content-Range'] = `bytes ${browserStart}-${browserEnd}/${fileSize}`
      respHeaders['Content-Length'] = browserEnd - browserStart + 1
      res.writeHead(206, respHeaders)
      console.log(`[DriveStream] Range: modified=${browserStart}-${browserEnd} gd=${rangeStart}-${rangeEnd} (${Date.now() - tStart}ms)`)
      await pipeFromDrive(`bytes=${rangeStart}-${rangeEnd}`)
    } catch (err) {
      const error = err as Error
      console.error(`[Drive Stream] Error at ${Date.now() - tStart}ms:`, error.message)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Streaming Error', message: error.message })
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

  ensureHlsLive: (fileId: string, startTime: number = 0): string => {
    const outputDir = path.join(os.tmpdir(), 'cinevault-hls', fileId)
    fs.mkdirSync(outputDir, { recursive: true })

    const { isHlsActive, startHlsLive } = require('./optimizer')

    if (!isHlsActive(fileId)) {
      const accessToken = (oauth2Client.credentials as { access_token?: string }).access_token
      const sourceUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`
      const headers = `Authorization: Bearer ${accessToken}`
      startHlsLive(fileId, sourceUrl, outputDir, headers, startTime)
    }

    return outputDir
  },

  getHlsPlaylistPath: (fileId: string): string | null => {
    const dir = path.join(os.tmpdir(), 'cinevault-hls', fileId)
    const playlist = path.join(dir, 'playlist.m3u8')
    return fs.existsSync(playlist) ? playlist : null
  },

  getHlsSegmentPath: (fileId: string, segment: string): string | null => {
    const dir = path.join(os.tmpdir(), 'cinevault-hls', fileId)
    const segPath = path.join(dir, segment)
    if (!segPath.startsWith(dir)) return null
    return fs.existsSync(segPath) ? segPath : null
  },

  localDownloadsInProgress: new Map<string, Promise<string>>(),

  ensureLocalFile: async (fileId: string): Promise<string> => {
    const localDir = path.join(os.tmpdir(), 'cinevault-files')
    const localPath = path.join(localDir, fileId)

    if (fs.existsSync(localPath)) return localPath

    if (driveApi.localDownloadsInProgress.has(fileId)) {
      return driveApi.localDownloadsInProgress.get(fileId)!
    }

    const promise = (async () => {
      fs.mkdirSync(localDir, { recursive: true })
      const tmpPath = localPath + '.tmp'
      console.log(`[Drive] Downloading ${fileId} to ${tmpPath}...`)

      const hasToken = driveApi.isAuthenticated()
      const apiKey = process.env.GOOGLE_API_KEY

      const runFaststart = (fromPath: string, toPath: string): Promise<void> => {
        return new Promise<void>((resolve) => {
          const proc = spawn('ffmpeg', [
            '-i', fromPath,
            '-c', 'copy',
            '-movflags', 'faststart',
            '-f', 'mp4',
            '-y',
            toPath,
          ], { stdio: ['ignore', 'ignore', 'pipe'] })
          let stderrBuf = ''
          proc.stderr!.on('data', (chunk: Buffer) => { stderrBuf += chunk.toString() })
          proc.stderr!.setEncoding('utf8')
          proc.on('close', (code) => {
            if (code === 0) {
              console.log(`[Drive] Faststart complete: ${fileId}`)
            } else {
              console.error(`[Drive] Faststart failed (code ${code})\n  stderr tail: ${stderrBuf.slice(-800)}`)
              if (fs.existsSync(toPath)) {
                try { fs.unlinkSync(toPath) } catch {}
              }
            }
            resolve()
          })
          proc.on('error', (err) => {
            console.error(`[Drive] Faststart binary error: ${err.message}`)
            if (fs.existsSync(toPath)) {
              try { fs.unlinkSync(toPath) } catch {}
            }
            resolve()
          })
        })
      }

      const afterDownload = async (): Promise<string> => {
        console.log(`[Drive] Download complete: ${fileId}`)
        // Liberar espacio ANTES de faststart (necesita 2x espacio temporal)
        try { ensureDiskSpace(fileId, fs.statSync(tmpPath).size) } catch {}
        await runFaststart(tmpPath, localPath)
        if (fs.existsSync(tmpPath)) {
          try { fs.unlinkSync(tmpPath) } catch {}
        }
        if (!fs.existsSync(localPath)) {
          console.log(`[Drive] Faststart produced no output, renaming tmp as-is`)
          try { fs.renameSync(tmpPath, localPath) } catch {}
        }
        driveApi.localDownloadsInProgress.delete(fileId)
        return localPath
      }

      const pipeDownload = (stream: NodeJS.ReadableStream): Promise<string> => {
        const writer = fs.createWriteStream(tmpPath)
        return new Promise<string>((resolve, reject) => {
          stream.pipe(writer)
          writer.on('finish', () => afterDownload().then(resolve).catch(reject))
          writer.on('error', (err) => {
            driveApi.localDownloadsInProgress.delete(fileId)
            reject(err)
          })
          stream.on('error', (err) => {
            driveApi.localDownloadsInProgress.delete(fileId)
            reject(err)
          })
        })
      }

      if (hasToken) {
        const drive = driveApi.getClient()
        const res = await drive.files.get(
          { fileId, alt: 'media', supportsAllDrives: true },
          { responseType: 'stream' }
        )
        return pipeDownload(res.data as unknown as NodeJS.ReadableStream)
      } else if (apiKey) {
        const axios = require('axios')
        const res = await axios.get(
          `https://www.googleapis.com/drive/v3/files/${fileId}`,
          {
            params: { alt: 'media', key: apiKey, supportsAllDrives: true },
            responseType: 'stream',
          }
        )
        return pipeDownload(res.data as NodeJS.ReadableStream)
      } else {
        throw new Error('No authentication method available')
      }
    })()

    driveApi.localDownloadsInProgress.set(fileId, promise)
    return promise
  },

  getLocalFilePath: (fileId: string): string | null => {
    const localPath = path.join(os.tmpdir(), 'cinevault-files', fileId)
    if (fs.existsSync(localPath)) {
      touchLocalFile(fileId)
      return localPath
    }
    return null
  },

  disconnect: async (): Promise<void> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    oauth2Client.setCredentials({} as any)
    const tokenPath = getTokenPath()
    if (fs.existsSync(tokenPath)) fs.unlinkSync(tokenPath)
  },
}

export default driveApi
