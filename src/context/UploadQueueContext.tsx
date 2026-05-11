import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import { api } from '../api'
import type { UploadProgressEvent } from '../types'

interface QueueItem {
  id: string
  title: string
  progress: number
  status: string
  errorMsg?: string | null
  isOptimizing: boolean
}

interface QueueMovie {
  id: number | string
  official_title?: string | null
  detected_title?: string | null
  file_path?: string | null
  _directQueue?: boolean
}

interface UploadQueueContextValue {
  queue: QueueItem[]
  addToQueue: (movie: QueueMovie) => Promise<void>
  removeFromQueue: (id: string | number) => Promise<void>
  retryQueueItem: (id: string | number) => Promise<void>
}

const UploadQueueContext = createContext<UploadQueueContextValue | null>(null)

export function UploadQueueProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingMovieRef = useRef<QueueMovie | null>(null)

  const updateItem = useCallback((id: string | number, updates: Partial<QueueItem>) =>
    setQueue(prev => prev.map(item => item.id === String(id) ? { ...item, ...updates } : item)), [])

  useEffect(() => {
    let isMounted = true
    let pollInterval: ReturnType<typeof setInterval> | null = null

    const syncQueue = async () => {
      try {
        const serverQueue = await api.getUploadQueue() as { movieId: number; title: string; status: string; progress?: number; error?: string; options?: { optimize?: boolean } }[]
        if (Array.isArray(serverQueue) && isMounted) {
          setQueue(prev => {
            const newQueue: QueueItem[] = serverQueue.map(item => {
              const existing = prev.find(p => String(p.id) === String(item.movieId))
              return {
                id: String(item.movieId),
                title: item.title,
                progress: item.status === 'done' ? 100 : (item.progress ?? (existing?.progress || 0)),
                status: item.status,
                errorMsg: item.error,
                isOptimizing: !!(item.options && item.options.optimize)
              }
            })
            return newQueue
          })

          serverQueue.forEach(item => {
            const isWorking = ['uploading', 'pending', 'fetching', 'downloading', 'converting'].some(s => item.status.includes(s))
            if (isWorking) {
              api.onDriveUploadProgress(item.movieId, (data: UploadProgressEvent) => {
                if (data && isMounted) {
                  if (data.status === 'error') {
                    updateItem(item.movieId, { status: 'error', errorMsg: data.error })
                  } else {
                    const prog = data.progress ?? 0
                    updateItem(item.movieId, { progress: prog, status: data.status || item.status, isOptimizing: data.isOptimizing ?? false })
                    if (data.status === 'done' || prog === 100) {
                      updateItem(item.movieId, { status: 'done', progress: 100 })
                    }
                  }
                }
              })
            }
          })
        }
      } catch(e) {
        const error = e as Error
        console.warn('[QueueSync] Fetch error:', error.message)
      }
    }

    syncQueue()
    pollInterval = setInterval(syncQueue, 3000)

    const handleVisibility = () => { if (!document.hidden) syncQueue() }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      isMounted = false
      if (pollInterval) clearInterval(pollInterval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [updateItem])

  const startWebUpload = useCallback(async (movie: QueueMovie, file: File) => {
    try {
      const result = await api.uploadMovieFile(movie.id, file, (progress: number) => {
        updateItem(movie.id, { progress, isOptimizing: false })
      }) as { success?: boolean; error?: string }
      if (result.success) { updateItem(movie.id, { status: 'done', progress: 100 }) }
      else { updateItem(movie.id, { status: 'error', errorMsg: result.error }) }
    } catch (err) {
      const error = err as Error
      updateItem(movie.id, { status: 'error', errorMsg: error.message })
    }
  }, [updateItem])

  const removeFromQueue = useCallback(async (id: string | number) => {
    try {
      await api.removeUploadFromQueue(id)
    } catch (_e) {}
    setQueue(prev => prev.filter(item => String(item.id) !== String(id)))
  }, [])

  const retryQueueItem = useCallback(async (id: string | number) => {
    try {
      await api.retryUpload(id)
      updateItem(id, { status: 'pending', progress: 0, errorMsg: null })

      const unsub = api.onDriveUploadProgress(id, (data: UploadProgressEvent) => {
        if (data) {
          if (data.status === 'error') {
            updateItem(id, { status: 'error', errorMsg: data.error })
            unsub()
          } else {
            updateItem(id, { progress: data.progress ?? 0, status: data.status || 'converting', isOptimizing: data.isOptimizing ?? false })
            if (data.status === 'done' || data.progress === 100) {
              updateItem(id, { status: 'done', progress: 100 })
              unsub()
            }
          }
        }
      })
    } catch (e) {
      console.error('Retry failed:', e)
    }
  }, [updateItem])

  const addToQueue = useCallback(async (movie: QueueMovie) => {
    if (queue.some(item => String(item.id) === String(movie.id))) return

    const queueEntry: QueueItem = { id: String(movie.id), title: movie.official_title || movie.detected_title || '', progress: 0, status: 'converting', isOptimizing: false }

    if (movie._directQueue) {
      setQueue(prev => [...prev, queueEntry])
      const unsub = api.onDriveUploadProgress(String(movie.id), (data: UploadProgressEvent) => {
        if (data) {
          if (data.status === 'error') {
            updateItem(String(movie.id), { status: 'error', errorMsg: data.error })
            unsub()
          } else {
            updateItem(String(movie.id), { progress: data.progress ?? 0, status: data.status || 'converting', isOptimizing: data.isOptimizing ?? false })
            if (data.status === 'done' || data.progress === 100) {
              updateItem(String(movie.id), { status: 'done', progress: 100 })
              unsub()
            }
          }
        }
      })
      return
    }

    if (movie.file_path) {
      try {
        setQueue(prev => [...prev, queueEntry])

        const unsubscribe = api.onDriveUploadProgress(movie.id, (data: UploadProgressEvent) => {
          if (data) {
            if (data.status === 'error') {
              updateItem(movie.id, { status: 'error', errorMsg: data.error })
              unsubscribe()
            } else {
              updateItem(movie.id, { progress: data.progress ?? 0, isOptimizing: data.isOptimizing ?? false })
              if (data.progress === 100) {
                updateItem(movie.id, { status: 'done' })
                unsubscribe()
              }
            }
          }
        })

        const result = await api.uploadMovieToDrive(movie.id, movie.file_path) as { started?: boolean; success?: boolean }

        if (result.started) {
          return
        } else if (result.success) {
          updateItem(movie.id, { status: 'done', progress: 100 })
          unsubscribe()
          return
        }
      } catch (err) {
        const error = err as Error
        console.warn('[Smart Upload] Local path upload failed, falling back to file picker:', error.message)
        removeFromQueue(movie.id)
      }
    }

    pendingMovieRef.current = movie
    if (fileInputRef.current) fileInputRef.current.click()
  }, [queue, removeFromQueue, updateItem])

  const handleFileSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const movie = pendingMovieRef.current
    e.target.value = ''
    if (!file || !movie) return
    setQueue(prev => [...prev, { id: String(movie.id), title: movie.official_title || movie.detected_title || '', progress: 0, status: 'uploading', isOptimizing: false }])
    startWebUpload(movie, file)
  }, [startWebUpload])

  return (
    <UploadQueueContext.Provider value={{ queue, addToQueue, removeFromQueue, retryQueueItem }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,.mkv"
        className="hidden"
        onChange={handleFileSelected}
      />
      {children}
    </UploadQueueContext.Provider>
  )
}

export function useUploadQueue(): UploadQueueContextValue {
  const context = useContext(UploadQueueContext)
  if (!context) {
    throw new Error('useUploadQueue must be used within UploadQueueProvider')
  }
  return context
}
