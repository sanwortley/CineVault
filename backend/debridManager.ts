import axios, { AxiosInstance } from 'axios'
import 'dotenv/config'

const BASE_URL = 'https://api.real-debrid.com/rest/1.0'

interface AddMagnetResult {
  id: string
  uri: string
}

interface TorrentFile {
  id: number
  path: string
  bytes: number
}

interface TorrentInfo {
  id: string
  filename: string
  progress: number
  status: string
  files: TorrentFile[]
  links: string[]
}

interface ProcessMagnetResult {
  id: string
  downloadUrl: string
  filename: string
}

type ProgressCallback = (progress: number, status: string) => void

const getRD = (): AxiosInstance => {
  const token = process.env.REAL_DEBRID_API_TOKEN
  return axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000,
  })
}

class DebridManager {
  constructor() {
    if (!process.env.REAL_DEBRID_API_TOKEN) {
      console.warn('[DebridManager] No REAL_DEBRID_API_TOKEN found in environment')
    }
  }

  async addMagnet(magnet: string): Promise<AddMagnetResult> {
    const params = new URLSearchParams()
    params.append('magnet', magnet)
    const response = await getRD().post<AddMagnetResult>('/torrents/addMagnet', params)
    return response.data
  }

  async getTorrentInfo(id: string): Promise<TorrentInfo> {
    const response = await getRD().get<TorrentInfo>(`/torrents/info/${id}`)
    return response.data
  }

  async selectFile(id: string, fileId: string): Promise<void> {
    const params = new URLSearchParams()
    params.append('files', fileId)
    await getRD().post(`/torrents/selectFiles/${id}`, params)
  }

  async unrestrictLink(link: string): Promise<string> {
    const params = new URLSearchParams()
    params.append('link', link)
    const response = await getRD().post<{ download: string }>('/unrestrict/link', params)
    return response.data.download
  }

  async processMagnet(
    magnet: string,
    progressCallback?: ProgressCallback
  ): Promise<ProcessMagnetResult> {
    try {
      console.log('[Debrid] Añadiendo magnet...')
      const addResult = await this.addMagnet(magnet)
      const torrentId = addResult.id

      console.log('[Debrid] Obteniendo información de archivos...')
      let info = await this.getTorrentInfo(torrentId)

      const videoFiles = info.files.filter((f) =>
        f.path.match(/\.(mp4|mkv|avi|webm)$/i)
      )
      let selectedFileId = 'all'

      if (videoFiles.length > 0) {
        const largestFile = videoFiles.sort((a, b) => b.bytes - a.bytes)[0]
        selectedFileId = largestFile.id.toString()
        console.log(`[Debrid] Seleccionando archivo de video principal: ${largestFile.path}`)
      } else if (info.files.length > 0) {
        const largestFile = info.files.sort((a, b) => b.bytes - a.bytes)[0]
        selectedFileId = largestFile.id.toString()
        console.log(
          `[Debrid] No se encontraron extensiones de video, seleccionando archivo más grande: ${largestFile.path}`
        )
      }

      await this.selectFile(torrentId, selectedFileId)

      let isReady = false
      let attempts = 0

      while (!isReady && attempts < 120) {
        info = await this.getTorrentInfo(torrentId)

        console.log(
          `[Debrid] Polling torrent ${torrentId}: ${info.progress}% - status: ${info.status} (attempt ${attempts + 1}/120)`
        )

        if (progressCallback) {
          progressCallback(info.progress, info.status)
        }

        if (info.status === 'downloaded' || info.links.length > 0) {
          isReady = true
        } else if (info.status === 'error' || info.status === 'dead') {
          throw new Error(`Error en Real-Debrid: ${info.status}`)
        } else {
          attempts++
          await new Promise((r) => setTimeout(r, 5000))
        }
      }

      if (!isReady) throw new Error('Tiempo de espera de Real-Debrid agotado')

      console.log('[Debrid] Desacoplando link final...')
      const internalLink = info.links[0]
      const directLink = await this.unrestrictLink(internalLink)

      return {
        id: torrentId,
        downloadUrl: directLink,
        filename: info.filename,
      }
    } catch (err: unknown) {
      const error = err as { response?: { status?: number }; message: string }
      if (error.response?.status === 429) {
        console.error('[Debrid] ERROR 429: Límite de peticiones excedido.')
        throw new Error(
          'Límite de peticiones de Real-Debrid excedido. Por favor, espera un minuto e intenta de nuevo.'
        )
      }
      if (error.response?.status === 451) {
        console.error('[Debrid] ERROR 451: Torrent bloqueado por razones legales (DMCA).')
        throw new Error(
          'Este torrent ha sido bloqueado por Real-Debrid debido a restricciones legales (DMCA). Por favor, intenta con otra fuente.'
        )
      }
      console.error('[Debrid] Error en proceso:', error.message)
      throw err
    }
  }
}

const debridManager = new DebridManager()
export { DebridManager }
export default debridManager
