import { EventEmitter } from 'events'

type OnDoneCallback = (result: unknown) => void

class TorrentManager extends EventEmitter {
  activeDownloads: Map<string, unknown>

  constructor() {
    super()
    this.activeDownloads = new Map()
  }

  async addDownload(movieId: number, title: string, magnetUri: string, onDone?: OnDoneCallback): Promise<void> {
    throw new Error('Descargas directas desactivadas por política de servidor (Railway).')
  }

  getDownloadStatus(movieId: number): null {
    return null
  }

  cancelDownload(movieId: number): boolean {
    return false
  }
}

const torrentManager = new TorrentManager()
export { TorrentManager }
export default torrentManager
