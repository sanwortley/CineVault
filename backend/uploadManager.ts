import fs from 'fs'
import path from 'path'
import os from 'os'
import { EventEmitter } from 'events'
import axios from 'axios'
import driveApi from './drive'
import db from './db'
import { getVideoMetadata } from './optimizer'

const QUEUE_FILE =
  process.platform === 'win32'
    ? path.join(os.homedir(), 'CineVault', 'upload_queue.json')
    : path.join(os.tmpdir(), 'cinevault_upload_queue.json')

const ensureDirectoryExists = (filePath: string): void => {
  const dirname = path.dirname(filePath)
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true })
  }
}

interface QueueJob {
  id: string
  movieId: string
  title: string
  filePath: string
  mimeType: string
  status: string
  progress: number
  error: string | null
  isUrl?: boolean
  options?: Record<string, unknown>
}

interface JobProgressEvent {
  movieId: string
  progress: number
  status?: string
  uploaded?: number
  total?: number
  isOptimizing?: boolean
}

interface JobUpdateData {
  status?: string
  progress?: number
  error?: string
  filePath?: string
  isUrl?: boolean
  options?: Record<string, unknown>
}

class UploadManager extends EventEmitter {
  queue: QueueJob[]
  isProcessing: boolean
  lastProgressUpdate: number

  constructor() {
    super()
    this.setMaxListeners(200)
    this.queue = []
    this.isProcessing = false
    this.lastProgressUpdate = Date.now()
    this.loadQueue()
    setTimeout(() => this.processNext(), 5000)
    setInterval(() => this.checkHeartbeat(), 5 * 60 * 1000)
  }

  checkHeartbeat(): void {
    if (!this.isProcessing) return
    const idleTime = Date.now() - this.lastProgressUpdate
    if (idleTime > 30 * 60 * 1000) {
      console.warn(
        '[UploadManager] Proceso estancado detectado (30 min sin cambios). Reiniciando...'
      )
      this.isProcessing = false
      this.processNext()
    }
  }

  loadQueue(): void {
    try {
      if (fs.existsSync(QUEUE_FILE)) {
        this.queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8'))
        this.queue.forEach((job) => {
          if (job.status === 'uploading') {
            job.status = 'pending'
          }
        })
        this.saveQueue()
      }
    } catch (e) {
      const error = e as Error
      console.error('[UploadManager] Error al cargar la cola de subidas:', error.message)
      this.queue = []
    }
  }

  saveQueue(): void {
    try {
      ensureDirectoryExists(QUEUE_FILE)
      fs.writeFileSync(QUEUE_FILE, JSON.stringify(this.queue, null, 2))
    } catch (e) {
      const error = e as Error
      console.error('[UploadManager] Error al guardar la cola:', error.message)
    }
  }

  enqueue(
    movieId: number | string,
    title: string,
    filePath: string,
    mimeType: string,
    options: Record<string, unknown> = {}
  ): void {
    const existingInd = this.queue.findIndex(
      (j) => String(j.movieId) === String(movieId)
    )
    if (existingInd !== -1) {
      if (this.queue[existingInd].status !== 'done') {
        this.queue[existingInd] = {
          ...this.queue[existingInd],
          status: 'pending',
          progress: 0,
          error: null,
          filePath,
          mimeType,
          options,
        }
      }
    } else {
      this.queue.push({
        id: Date.now().toString(),
        movieId: String(movieId),
        title: title || `Película ${movieId}`,
        filePath,
        mimeType,
        status: (options.status as string) || 'pending',
        progress: 0,
        error: null,
        options,
      })
    }

    this.saveQueue()
    this.emit('queue_updated', this.queue)
    this.processNext()
  }

  retry(movieId: string | number): boolean {
    const job = this.queue.find((j) => String(j.movieId) === String(movieId))
    if (job && job.status === 'error') {
      job.status = 'pending'
      job.progress = 0
      job.error = null
      this.saveQueue()
      this.emit('queue_updated', this.queue)
      this.processNext()
      return true
    }
    return false
  }

  remove(movieId: string | number): void {
    const originalLength = this.queue.length
    this.queue = this.queue.filter((j) => String(j.movieId) !== String(movieId))
    if (this.queue.length !== originalLength) {
      this.saveQueue()
      this.emit('queue_updated', this.queue)
    }
  }

  getQueue(): QueueJob[] {
    return this.queue
  }

  getJobStatus(movieId: string): QueueJob | undefined {
    return this.queue.find((j) => String(j.movieId) === String(movieId))
  }

  async processNext(): Promise<void> {
    if (this.isProcessing) return

    const nextJob = this.queue.find(
      (j) =>
        j.status === 'pending' &&
        j.filePath &&
        j.filePath.toLowerCase() !== 'pending'
    )
    if (!nextJob) return

    this.isProcessing = true
    nextJob.status = 'uploading'
    this.saveQueue()
    this.emit('job_started', nextJob)
    this.emit('queue_updated', this.queue)

    try {
      let workingFilePath = nextJob.filePath
      const isActuallyUrl =
        nextJob.isUrl ||
        (typeof workingFilePath === 'string' && workingFilePath.startsWith('http'))

      if (isActuallyUrl) {
        console.log(`[UploadManager] Descargando desde nube: ${nextJob.title}`)
        const tempDir = path.join(process.cwd(), 'temp_downloads')
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

        const tempFilePath = path.join(tempDir, `fetch_${Date.now()}.mp4`)
        const response = await axios({
          method: 'get',
          url: nextJob.filePath,
          responseType: 'stream',
          timeout: 60000,
        })

        const totalLength = response.headers['content-length'] as string | undefined
        let downloadedLength = 0

        const writer = fs.createWriteStream(tempFilePath)
        response.data.on('data', (chunk: Buffer) => {
          downloadedLength += chunk.length
          const rawProgress = totalLength
            ? Math.round((downloadedLength / parseInt(totalLength)) * 100)
            : 0
          const progress = Math.min(rawProgress, 100)
          this.emit('job_progress', {
            movieId: nextJob.movieId,
            progress,
            status: 'fetching',
          })
        })

        response.data.pipe(writer)

        await new Promise<void>((resolve, reject) => {
          writer.on('finish', () => resolve())
          writer.on('error', reject)
        })

        workingFilePath = tempFilePath
      }

      console.log(`[UploadManager] Procesando subida: ${nextJob.title}`)

      let videoMetadata: Record<string, unknown> = {}
      try {
        if (!isActuallyUrl && fs.existsSync(workingFilePath)) {
          console.log(`[UploadManager] Extracting metadata from: ${workingFilePath}`)
          const meta = await getVideoMetadata(workingFilePath)
          videoMetadata = meta as unknown as Record<string, unknown>
          console.log(`[UploadManager] Metadata: ${JSON.stringify(videoMetadata)}`)
        }
      } catch (metaErr) {
        const error = metaErr as Error
        console.warn('[UploadManager] Metadata extraction failed:', error.message)
      }

      const result = await driveApi.uploadVideo(
        workingFilePath,
        nextJob.mimeType,
        (progress, uploaded, total) => {
          nextJob.progress = progress
          this.lastProgressUpdate = Date.now()
          this.emit('job_progress', {
            movieId: nextJob.movieId,
            progress,
            uploaded,
            total,
            isOptimizing: !!(nextJob.options as { optimize?: boolean })?.optimize,
          })
        },
        nextJob.options as Record<string, unknown>
      )

      await db.updateMovie(parseInt(nextJob.movieId), {
        drive_file_id: result.id,
        cloud_source_url: null,
      })

      nextJob.status = 'done'
      nextJob.progress = 100
      if ((nextJob.options as { deleteAfter?: boolean })?.deleteAfter || nextJob.isUrl) {
        try {
          fs.unlinkSync(workingFilePath)
        } catch (_e) {
          // ignore
        }
      }

      console.log(`[UploadManager] Subida exitosa: ${nextJob.title}`)
      this.emit('job_done', nextJob)
    } catch (error) {
      const err = error as Error
      console.error(`[UploadManager] Fallo en subida ${nextJob.title}:`, err.message)

      let errorMessage = err.message
      if (errorMessage.toLowerCase().includes('invalid_grant')) {
        console.error(
          '[UploadManager] Token de Drive revocado o expirado. Desconectando...'
        )
        try {
          await driveApi.disconnect()
        } catch (e) {
          const disconnectErr = e as Error
          console.error(
            '[UploadManager] Error al desconectar drive:',
            disconnectErr.message
          )
        }
        errorMessage =
          'Google Drive desconectado (Sesión expirada). Reconéctalo en Ajustes.'
      }

      nextJob.status = 'error'
      nextJob.error = errorMessage
      this.emit('job_error', nextJob)
    }

    this.saveQueue()
    this.emit('queue_updated', this.queue)

    this.isProcessing = false
    setTimeout(() => this.processNext(), 2000)
  }

  updateJob(movieId: string | number, data: JobUpdateData): boolean {
    const job = this.queue.find((j) => String(j.movieId) === String(movieId))
    if (job) {
      const oldStatus = job.status
      Object.assign(job, data)
      this.saveQueue()
      this.emit('queue_updated', this.queue)

      this.emit('job_progress', {
        movieId: String(job.movieId),
        progress: job.progress ?? 0,
        status: job.status,
        ...data,
      })

      if (
        data.status === 'pending' ||
        (oldStatus !== 'pending' && job.status === 'pending')
      ) {
        this.processNext()
      }
      return true
    }
    return false
  }
}

const uploadManager = new UploadManager()
export { UploadManager }
export default uploadManager
