import type { Movie, SubtitleSearchQuery, UploadProgressEvent } from './types'

export const BACKEND_URL: string =
  import.meta.env.VITE_BACKEND_URL ||
  (typeof window !== 'undefined' &&
  window.location.origin.includes('localhost')
    ? 'http://localhost:3001'
    : window.location.origin)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

async function supabaseFetch<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<T | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(err.message || JSON.stringify(err))
  }
  if (res.status === 204) return null
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

interface BackendFetchOptions extends RequestInit {
  headers?: Record<string, string>
}

async function backendFetch<T = unknown>(
  path: string,
  options: BackendFetchOptions = {},
  customHeaders: Record<string, string> = {}
): Promise<T> {
  const sessionId = localStorage.getItem('cinevault_session_id')
  const storedUser = localStorage.getItem('cinevault_user')
  let userEmail = ''
  if (storedUser) {
    try {
      const u = JSON.parse(storedUser)
      userEmail = u.email || ''
    } catch (_e) {
      // ignore
    }
  }

  const res = await fetch(`${BACKEND_URL}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-session-id': sessionId || '',
      'x-user-email': userEmail,
      ...(options.headers || {}),
      ...customHeaders,
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let err: { message?: string } = { message: res.statusText }
    try {
      if (text.trim().startsWith('{')) err = JSON.parse(text)
    } catch (_e) {
      // ignore
    }

    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('session-expired'))
    }
    throw new Error(err.message || JSON.stringify(err))
  }

  const contentType = res.headers.get('content-type')
  if (contentType && contentType.includes('application/json')) {
    return res.json()
  }
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch (_e) {
    return { success: res.ok, status: res.status, raw: text } as T
  }
}

interface GetStreamUrlOptions {
  startTime?: number
  seekOffset?: number
  quality?: string
  q?: string
  transcode?: boolean
  audioTrack?: number | null
}

interface DownloadMovieOptions {
  isPage?: boolean
  isHash?: boolean
}

export const api = {
  getMovies: (): Promise<Movie[]> => {
    const cached = localStorage.getItem('cinevault_movies_cache')
    const fetchRemote = supabaseFetch<Movie[]>('movies?select=*&order=created_at.desc').then((d) => {
      const data = d || []
      localStorage.setItem('cinevault_movies_cache', JSON.stringify(data))
      return data
    })

    if (cached) {
      try {
        const data: Movie[] = JSON.parse(cached)
        fetchRemote.catch((err: Error) =>
          console.warn('[api] Background cache refresh failed:', err)
        )
        return Promise.resolve(data)
      } catch (_e) {
        return fetchRemote
      }
    }
    return fetchRemote
  },

  updateProgress: (movieId: number, duration: number) => {
    return supabaseFetch(`movies?id=eq.${movieId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        watched_duration: duration,
        last_watched_at: new Date().toISOString(),
      }),
    })
  },

  deleteMovie: (id: number) => {
    const userStr = localStorage.getItem(
      'sb-tlasrdqdjznjnchmtjcc-auth-token'
    )
    let userEmail = ''
    if (userStr) {
      try {
        const session = JSON.parse(userStr)
        userEmail = session.user?.email || ''
      } catch (_e) {
        // ignore
      }
    }

    return backendFetch(`/api/movies/${id}`, {
      method: 'DELETE',
      headers: { 'x-user-email': userEmail },
    })
      .then((res) => {
        localStorage.removeItem('cinevault_movies_cache')
        return res
      })
      .catch((err: Error) => {
        if (
          err.message.includes('404') ||
          err.message.toLowerCase().includes('not found') ||
          err.message.toLowerCase().includes('no encontrada')
        ) {
          localStorage.removeItem('cinevault_movies_cache')
          return { success: true, ghostCleared: true }
        }
        throw err
      })
  },

  refreshLibrary: () => {
    return backendFetch('/api/library/refresh', { method: 'POST' })
  },

  refreshAllMetadata: () => {
    return backendFetch('/api/admin/refresh-all-metadata', { method: 'POST' })
  },

  updateMovie: (id: number, data: Record<string, unknown>) => {
    return backendFetch(`/api/movies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  },

  reIdentifyMovie: (id: number, title: string, year: string) => {
    return backendFetch(`/api/movies/${id}/re-identify`, {
      method: 'POST',
      body: JSON.stringify({ title, year }),
    })
  },

  onLibraryUpdated: (callback: () => void) => {
    const interval = setInterval(callback, 30000)
    window.addEventListener('library-updated', callback)
    return () => {
      clearInterval(interval)
      window.removeEventListener('library-updated', callback)
    }
  },

  checkFileExists: (_filePath: string) => {
    return Promise.resolve(false)
  },

  getAudioTracks: (movieId: number) => {
    return backendFetch(`/api/movies/${movieId}/audio-tracks`)
  },

  searchSubtitles: (data: SubtitleSearchQuery) => {
    return backendFetch('/api/subtitles/search', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  downloadSubtitle: (fileId: number, movieId: number) => {
    return backendFetch('/api/subtitles/download', {
      method: 'POST',
      body: JSON.stringify({ fileId, movieId }),
    })
  },

  findLocalSubtitle: (movieId: number) => {
    return backendFetch(`/api/subtitles/local/check?movieId=${movieId}`)
  },

  checkCloudSubtitle: (movieId: number) => {
    return backendFetch(`/api/subtitles/cloud/check?movieId=${movieId}`)
  },

  checkDriveAuth: () => {
    return backendFetch<{ authenticated: boolean }>('/api/auth/status')
      .then((d) => d.authenticated)
      .catch(() => false)
  },

  authenticateDrive: () => {
    return new Promise<boolean>((resolve, reject) => {
      const popup = window.open(
        `${BACKEND_URL}/api/auth/google`,
        'Drive Auth',
        'width=600,height=700'
      )
      const timer = setInterval(() => {
        if (popup?.closed) {
          clearInterval(timer)
          backendFetch<{ authenticated: boolean }>('/api/auth/status')
            .then((d) => {
              if (d.authenticated) resolve(true)
              else reject(new Error('Autenticación cancelada o fallida'))
            })
            .catch(reject)
        }
      }, 500)
    })
  },

  disconnectDrive: () => {
    return backendFetch('/api/auth/disconnect', { method: 'POST' })
  },

  listDriveFiles: (folderId?: string) => {
    return backendFetch(
      `/api/drive/ls${folderId ? `?folderId=${folderId}` : ''}`
    )
  },

  getDriveSubtitleUrl: (fileId: string) => {
    return `${BACKEND_URL}/api/subtitles/drive?fileId=${fileId}`
  },

  registerSession: (userId: string, email: string) => {
    return backendFetch('/api/auth/register-session', {
      method: 'POST',
      body: JSON.stringify({ userId, email }),
    })
  },

  checkSession: () => {
    return backendFetch('/api/auth/session-check')
  },

  listSessions: () => {
    return backendFetch('/api/admin/sessions')
  },

  deleteSession: (sessionId: string) => {
    return backendFetch(`/api/admin/sessions/${sessionId}`, {
      method: 'DELETE',
    })
  },

  getRDToken: () => {
    return backendFetch('/api/admin/config/rd-token')
  },

  saveRDToken: (token: string) => {
    return backendFetch('/api/admin/config/rd-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
  },

  exploreTrending: () => {
    return backendFetch('/api/discover/trending')
  },

  searchMoviesGlobal: (query: string) => {
    return backendFetch(
      `/api/discover/search?query=${encodeURIComponent(query)}`
    )
  },

  deepSearch: (query: string) => {
    return backendFetch(
      `/api/discover/deep-search?query=${encodeURIComponent(query)}`
    )
  },

  findTorrents: (title: string) => {
    return backendFetch(
      `/api/discover/torrents/${encodeURIComponent(title)}`
    )
  },

  downloadMovie: (
    tmdbId: string,
    title: string,
    magnet: string,
    year?: string,
    options: DownloadMovieOptions = {}
  ) => {
    return backendFetch('/api/discover/download', {
      method: 'POST',
      body: JSON.stringify({
        movieId: tmdbId,
        title,
        magnet,
        year,
        isPage: options.isPage,
        isHash: options.isHash,
      }),
    })
  },

  getDownloadProgress: (movieId: number | string) => {
    return backendFetch(`/api/discover/download-status/${movieId}`)
  },

  getCloudStreamUrl: (movieId: number | string) => {
    return `${BACKEND_URL}/api/drive/stream-cloud/${movieId}`
  },

  getStuckUploads: () => {
    return backendFetch('/api/admin/stuck-uploads')
  },

  retryStuckUpload: (movieId: number | string) => {
    return backendFetch(`/api/admin/retry-stuck/${movieId}`, {
      method: 'POST',
    })
  },

  getStreamUrl: (
    fileId: string | null,
    filePath: string | null,
    options: GetStreamUrlOptions = {}
  ): string | null => {
    if (fileId) {
      const sessionId = localStorage.getItem('cinevault_session_id')
      const startTime =
        options.startTime !== undefined
          ? options.startTime
          : options.seekOffset || 0
      const quality = options.quality || options.q || '720'

      let url = `${BACKEND_URL}/api/drive/stream/${fileId}?sessionId=${sessionId || ''}`

      if (options.transcode) {
        url += `&transcode=true&t=${startTime}&q=${quality}`
      }

      if (options.audioTrack !== undefined && options.audioTrack !== null) {
        url += `&audio=${options.audioTrack}`
        if (options.audioTrack > 0 && !url.includes('transcode=true')) {
          url += `&transcode=true&t=${startTime}&q=${quality}`
        }
      }
      return url
    }
    if (filePath) {
      const startTime =
        options.startTime !== undefined
          ? options.startTime
          : options.seekOffset || 0
      const quality = options.quality || options.q || '720'
      let url = `${BACKEND_URL}/api/stream/local?path=${encodeURIComponent(filePath)}`
      if (options.transcode) {
        url += `&transcode=true&t=${startTime}&quality=${quality}`
      }
      if (options.audioTrack !== undefined && options.audioTrack !== null) {
        url += `&audio=${options.audioTrack}`
      }
      return url
    }
    return null
  },

  getHLSUrl: (_fileId: string, _quality = '480') => {
    return null
  },

  uploadMovieToDrive: (
    movieId: number | string,
    filePath: string,
    mimeType?: string,
    options?: Record<string, unknown>
  ) => {
    if (filePath) {
      let userEmail = ''
      try {
        const userStr = localStorage.getItem(
          'sb-tlasrdqdjznjnchmtjcc-auth-token'
        )
        if (userStr) userEmail = JSON.parse(userStr).user?.email || ''
      } catch (_e) {
        // ignore
      }

      return backendFetch('/api/drive/upload-local', {
        method: 'POST',
        headers: { 'x-user-email': userEmail },
        body: JSON.stringify({ movieId, filePath, mimeType, options }),
      })
    }
    return Promise.reject(
      new Error('Use uploadMovieFile for manual file selection in web')
    )
  },

  uploadToLibrary: async (
    files: File[],
    targetPath: string,
    onProgress?: (progress: number) => void
  ) => {
    const formData = new FormData()
    files.forEach((file) => formData.append('files', file))
    formData.append('targetPath', targetPath || '')

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100))
        }
      }
      xhr.onload = () => {
        try {
          const result = JSON.parse(xhr.responseText)
          if (xhr.status === 200) resolve(result)
          else reject(new Error(result.error || 'Upload failed'))
        } catch (_e) {
          reject(new Error('Invalid response from server'))
        }
      }
      xhr.onerror = () =>
        reject(new Error('Error de red durante la subida'))
      xhr.open('POST', `${BACKEND_URL}/api/movies/upload`)
      xhr.withCredentials = true
      xhr.send(formData)
    })
  },

  uploadMovieFile: async (
    movieId: number | string,
    file: File,
    onProgress?: (progress: number) => void
  ) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('movieId', String(movieId))

    let userEmail = ''
    try {
      const userStr = localStorage.getItem(
        'sb-tlasrdqdjznjnchmtjcc-auth-token'
      )
      if (userStr) userEmail = JSON.parse(userStr).user?.email || ''
    } catch (_e) {
      // ignore
    }

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100))
        }
      }
      xhr.onload = () => {
        const result = JSON.parse(xhr.responseText)
        if (xhr.status === 200) resolve(result)
        else reject(new Error(result.error || 'Upload failed'))
      }
      xhr.onerror = () =>
        reject(new Error('Network error during upload'))
      xhr.open('POST', `${BACKEND_URL}/api/drive/upload`)
      xhr.setRequestHeader('x-user-email', userEmail)
      xhr.withCredentials = true
      xhr.send(formData)
    })
  },

  onDriveUploadProgress: (
    movieId: number | string,
    callback: (data: UploadProgressEvent) => void
  ) => {
    const es = new EventSource(
      `${BACKEND_URL}/api/drive/progress/${movieId}`,
      { withCredentials: true }
    )
    es.onmessage = (e: MessageEvent) => {
      try {
        if (e.data.trim() === ': heartbeat') return
        const data = JSON.parse(e.data) as UploadProgressEvent
        if ((data as { heartbeat?: boolean }).heartbeat) return
        callback(data)
      } catch (_err) {
        // ignore
      }
    }
    return () => es.close()
  },

  getUploadQueue: () => {
    return backendFetch('/api/drive/queue')
  },

  retryUpload: (movieId: number | string) => {
    let userEmail = ''
    try {
      const userStr = localStorage.getItem(
        'sb-tlasrdqdjznjnchmtjcc-auth-token'
      )
      if (userStr) userEmail = JSON.parse(userStr).user?.email || ''
    } catch (_e) {
      // ignore
    }
    return backendFetch('/api/drive/queue/retry', {
      method: 'POST',
      headers: { 'x-user-email': userEmail },
      body: JSON.stringify({ movieId }),
    })
  },

  removeUploadFromQueue: (movieId: number | string) => {
    let userEmail = ''
    try {
      const userStr = localStorage.getItem(
        'sb-tlasrdqdjznjnchmtjcc-auth-token'
      )
      if (userStr) userEmail = JSON.parse(userStr).user?.email || ''
    } catch (_e) {
      // ignore
    }
    return backendFetch(`/api/drive/queue/${movieId}`, {
      method: 'DELETE',
      headers: { 'x-user-email': userEmail },
    })
  },

  getFolders: () => {
    return backendFetch('/api/folders')
  },

  addFolder: (folderPath: string) => {
    return backendFetch('/api/folders', {
      method: 'POST',
      body: JSON.stringify({ folder_path: folderPath }),
    })
  },

  openDirectory: () => {
    return Promise.resolve(null)
  },

  ls: async (path?: string) => {
    try {
      const url = path
        ? `/api/fs/ls?path=${encodeURIComponent(path)}`
        : '/api/fs/ls'
      const res = await backendFetch(url)
      return Array.isArray(res) ? res : []
    } catch (err) {
      console.error('[API ls] Error:', err)
      return []
    }
  },

  getDrives: () => {
    return backendFetch('/api/fs/drives').then((res) =>
      Array.isArray(res) ? res : []
    )
  },

  getHomeFolders: () => {
    return backendFetch('/api/fs/home')
  },

  removeFolder: (path: string) => {
    return backendFetch('/api/folders', {
      method: 'DELETE',
      body: JSON.stringify({ folder_path: path }),
    })
  },

  clearLibrary: () => {
    return backendFetch('/api/library/clear', { method: 'POST' })
  },

  getTMDBKey: () => {
    return backendFetch<{ key: string }>('/api/admin/config/tmdb-key')
      .then((res) => res.key)
      .catch(() => import.meta.env.VITE_TMDB_API_KEY || '')
  },

  saveTMDBKey: (key: string) => {
    return backendFetch('/api/admin/config/tmdb-key', {
      method: 'POST',
      body: JSON.stringify({ key }),
    })
  },

  getOMDbKey: () => {
    return backendFetch<{ key: string }>('/api/admin/config/omdb-key')
      .then((res) => res.key)
      .catch(() => '')
  },

  saveOMDbKey: (key: string) => {
    return backendFetch('/api/admin/config/omdb-key', {
      method: 'POST',
      body: JSON.stringify({ key }),
    })
  },

  getOSCredentials: () => {
    return backendFetch('/api/admin/config/os-credentials')
  },

  saveOSCredentials: (username: string, password: string) => {
    return backendFetch('/api/admin/config/os-credentials', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
  },

  getUserProgress: (userId: string) => {
    return backendFetch(
      '/api/user/progress',
      {},
      { 'x-user-id': userId }
    )
  },

  saveUserProgress: (
    userId: string,
    movieId: number,
    watchedDuration: number
  ) => {
    return backendFetch(
      '/api/user/progress',
      {
        method: 'POST',
        body: JSON.stringify({
          movie_id: movieId,
          watched_duration: watchedDuration,
        }),
      },
      { 'x-user-id': userId }
    )
  },

  getUserMylist: (userId: string) => {
    return backendFetch('/api/user/mylist', {}, { 'x-user-id': userId })
  },

  addToMylist: (userId: string, movieId: number) => {
    return backendFetch(
      '/api/user/mylist',
      {
        method: 'POST',
        body: JSON.stringify({ movie_id: movieId }),
      },
      { 'x-user-id': userId }
    )
  },

  removeFromMylist: (userId: string, movieId: number) => {
    return backendFetch(
      `/api/user/mylist/${movieId}`,
      { method: 'DELETE' },
      { 'x-user-id': userId }
    )
  },

  getUserRating: (userId: string, movieId: number) => {
    return backendFetch(
      `/api/user/rating/${movieId}`,
      {},
      { 'x-user-id': userId }
    )
  },

  saveUserRating: (
    userId: string,
    movieId: number,
    rating: number
  ) => {
    return backendFetch(
      '/api/user/rating',
      {
        method: 'POST',
        body: JSON.stringify({ movie_id: movieId, rating }),
      },
      { 'x-user-id': userId }
    )
  },

  submitMovieRequest: (data: Record<string, unknown>) => {
    return backendFetch('/api/requests', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  getAdminRequests: () => {
    return backendFetch('/api/admin/requests')
  },

  updateRequestStatus: (id: number, status: string) =>
    fetch(`${BACKEND_URL}/api/admin/requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }).then((r) => r.json()),

  refreshMetadata: () =>
    fetch(`${BACKEND_URL}/api/admin/refresh-metadata`, {
      method: 'POST',
    }).then((r) => r.json()),

  fetchMovieNews: () => {
    return backendFetch('/api/news')
  },
}
