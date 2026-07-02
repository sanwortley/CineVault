import path from 'path'
import 'dotenv/config'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('[DB] SUPABASE_URL or SUPABASE_ANON_KEY is not set in .env')
}

const headers: Record<string, string> = {
  apikey: SUPABASE_ANON_KEY || '',
  Authorization: `Bearer ${SUPABASE_ANON_KEY || ''}`,
  'Content-Type': 'application/json',
}

interface MovieRow {
  id: number
  file_name: string
  file_path: string
  file_size: number
  extension: string
  detected_title?: string | null
  detected_year?: string | null
  official_title?: string | null
  overview?: string | null
  spoiler_free_summary?: string | null
  poster_url?: string | null
  backdrop_url?: string | null
  genres?: string | null
  runtime?: number | null
  director?: string | null
  rating?: number | null
  identified_status?: string
  needs_manual_confirmation?: boolean
  is_favorite?: boolean
  is_watched?: boolean
  last_played?: string | null
  drive_file_id?: string | null
  cast?: string | null
  release_date?: string | null
  watched_duration?: number | null
  last_watched_at?: string | null
  original_title?: string | null
  cloud_source_url?: string | null
  [key: string]: unknown
}

interface SessionRow {
  id: string
  user_id: string
  email: string
  user_agent: string | null
  ip_address: string | null
  last_active: string
  created_at: string
}

interface ProfileRow {
  id: string
  user_id: string
  name: string
  avatar_url: string | null
  is_kid: boolean
  created_at: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonValue = any

async function supabaseFetch<T = JsonValue>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T | null> {
  if (!SUPABASE_URL) return null
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
      ...options,
      headers: { ...headers, ...(options.headers as Record<string, string>) },
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText })) as { code?: string; message?: string }
      console.error(`[Supabase Error] ${options.method || 'GET'} ${endpoint}:`, err)
      if (err.code === '23505') return null
      throw new Error(err.message || JSON.stringify(err))
    }

    if (res.status === 204) return null

    const text = await res.text()
    if (!text) return null
    try {
      return JSON.parse(text) as T
    } catch (e) {
      console.warn(
        `[Supabase] Failed to parse JSON response from ${endpoint}:`,
        text
      )
      return null
    }
  } catch (err) {
    const error = err as Error & { cause?: unknown }
    if (error.cause) {
      console.error(`[Supabase Fetch Error] Detalle de red:`, error.cause)
    } else {
      console.error(`[Supabase Fetch Error] on ${endpoint}:`, error.message)
    }
    throw err
  }
}

const database = {
  getFolders: async (): Promise<{ id: number; folder_path: string }[]> => {
    return (await supabaseFetch('folders?select=*')) || []
  },

  addFolder: async (folder_path: string) => {
    return await supabaseFetch('folders', {
      method: 'POST',
      body: JSON.stringify({ folder_path }),
      headers: { Prefer: 'resolution=ignore-duplicates' },
    })
  },

  removeFolder: async (folder_path: string) => {
    return await supabaseFetch(
      `folders?folder_path=eq.${encodeURIComponent(folder_path)}`,
      { method: 'DELETE' }
    )
  },

  getMovies: async (): Promise<MovieRow[]> => {
    return (await supabaseFetch('movies?select=*&order=created_at.desc')) || []
  },

  findMovies: async (filters: Record<string, unknown> = {}): Promise<MovieRow[]> => {
    const queryParams = Object.entries(filters)
      .map(([key, val]) => `${key}=eq.${encodeURIComponent(String(val))}`)
      .join('&')
    const endpoint = `movies?select=*${queryParams ? '&' + queryParams : ''}`
    return (await supabaseFetch<MovieRow[]>(endpoint)) || []
  },

  sanitizePayload: (data: Record<string, unknown>): Record<string, unknown> => {
    const payload = { ...data }

    const legacyFields = [
      'original_title',
      'imdb_rating',
      'tmdb_id',
      'release_date',
      'modified_at',
      'created_at',
      'id',
    ]
    legacyFields.forEach((f) => delete payload[f])

    const numericFields = [
      'detected_year',
      'runtime',
      'rating',
      'watched_duration',
      'video_width',
      'video_height',
      'video_bitrate',
      'duration_seconds',
    ]
    numericFields.forEach((f) => {
      if (payload[f] === '') payload[f] = null
      if (f === 'detected_year' && payload[f]) {
        const year = parseInt(payload[f] as string)
        payload[f] = isNaN(year) ? null : year
      }
    })

    const metadataFields = [
      'video_width',
      'video_height',
      'video_codec',
      'audio_codec',
      'video_bitrate',
      'duration_seconds',
      'original_resolution',
    ]
    metadataFields.forEach((f) => {
      if (payload[f] === undefined || payload[f] === '') {
        delete payload[f]
      }
    })

    return payload
  },

  addMovie: async (movieData: Record<string, unknown>): Promise<MovieRow | null> => {
    const payload = database.sanitizePayload(movieData)
    console.log(
      '[DB] Attempting addMovie with payload:',
      JSON.stringify(payload, null, 2)
    )

    try {
      let existing: MovieRow | null = null

      if (
        payload.file_path &&
        typeof payload.file_path === 'string' &&
        !payload.file_path.startsWith('remote://')
      ) {
        const byPath = await database.findMovies({ file_path: payload.file_path })
        if (byPath.length > 0) existing = byPath[0]
      }

      if (
        !existing &&
        payload.official_title &&
        typeof payload.official_title === 'string' &&
        payload.detected_year
      ) {
        const byTitle = await database.findMovies({
          official_title: payload.official_title,
          detected_year: payload.detected_year,
        })
        if (byTitle.length > 0) {
          existing = byTitle[0]
        } else {
          const baseTitle = payload.official_title.replace(/\s*\[.*?\]/g, '').trim()
          if (baseTitle && baseTitle !== payload.official_title) {
            const allMovies = await database.getMovies()
            const looseMatch = allMovies.find(
              (m) =>
                m.official_title &&
                m.official_title.replace(/\s*\[.*?\]/g, '').trim() === baseTitle &&
                m.detected_year == payload.detected_year
            )
            if (looseMatch) existing = looseMatch
          } else {
            const allMovies = await database.getMovies()
            const looseMatch = allMovies.find(
              (m) =>
                m.official_title &&
                m.official_title.replace(/\s*\[.*?\]/g, '').trim() ===
                  payload.official_title &&
                m.detected_year == payload.detected_year
            )
            if (looseMatch) existing = looseMatch
          }
        }
      }

      if (existing) {
        console.log(
          `[DB] Duplicado detectado para "${payload.official_title}". Actualizando el registro existente (ID: ${existing.id})...`
        )
        if (
          existing.drive_file_id &&
          existing.drive_file_id !== 'pending_cloud' &&
          payload.drive_file_id === 'pending_cloud'
        ) {
          delete payload.drive_file_id
        }
        await database.updateMovie(existing.id, payload)
        return { ...existing, ...payload }
      }

      const res = await supabaseFetch<MovieRow[]>('movies', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      })

      if (Array.isArray(res) && res.length > 0) return res[0]
      if (res && (res as unknown as MovieRow).id) return res as unknown as MovieRow

      console.log(
        '[DB] Movie creation returned null (likely duplicate), finding existing:',
        payload.official_title
      )
      const fallbackExistingTry = await database.findMovies({
        official_title: payload.official_title as string,
      })
      return fallbackExistingTry.length > 0 ? fallbackExistingTry[0] : null
    } catch (err) {
      const error = err as Error
      console.error('[DB] addMovie error:', error.message)
      const fallbackExistingCatch = await database.findMovies({
        official_title: payload.official_title as string,
        detected_year: payload.detected_year as string,
      })
      return fallbackExistingCatch.length > 0 ? fallbackExistingCatch[0] : null
    }
  },

  setDriveFileId: async (id: number, drive_file_id: string): Promise<unknown> => {
    return await supabaseFetch(`movies?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ drive_file_id }),
    })
  },

  updateMovieProgress: async (id: number, watched_duration: number): Promise<unknown> => {
    return await supabaseFetch(`movies?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        watched_duration,
        last_watched_at: new Date().toISOString(),
      }),
    })
  },

  updateMovie: async (id: number, movieData: Record<string, unknown>): Promise<unknown> => {
    const payload = database.sanitizePayload(movieData)
    return await supabaseFetch(`movies?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
  },

  deleteMovie: async (id: number): Promise<unknown> => {
    return await supabaseFetch(`movies?id=eq.${id}`, { method: 'DELETE' })
  },

  getMovieByFileId: async (fileId: string): Promise<MovieRow | null> => {
    const results =
      (await supabaseFetch<MovieRow[]>(
        `movies?drive_file_id=eq.${fileId}&select=*`
      )) || []
    if (results.length === 0) return null
    const movie = results[0]
    if (movie.runtime && !movie.duration_seconds) {
      movie.duration_seconds = movie.runtime * 60
    }
    return movie
  },

  getMoovCache: async (
    fileId: string
  ): Promise<{ ftypSize: number; moovSize: number; headerB64: string | null } | null> => {
    const results =
      (await supabaseFetch<
        { moov_ftyp_size: number | null; moov_box_size: number | null; moov_header_b64: string | null }[]
      >(`movies?drive_file_id=eq.${fileId}&select=moov_ftyp_size,moov_box_size,moov_header_b64`)) || []
    if (results.length === 0) return null
    const row = results[0]
    if (row.moov_ftyp_size === null || row.moov_ftyp_size === undefined) return null
    return {
      ftypSize: row.moov_ftyp_size,
      moovSize: row.moov_box_size || 0,
      headerB64: row.moov_header_b64,
    }
  },

  setMoovCache: async (
    movieId: number,
    ftypSize: number,
    moovSize: number,
    headerB64: string | null
  ): Promise<unknown> => {
    return await supabaseFetch(`movies?id=eq.${movieId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        moov_ftyp_size: ftypSize,
        moov_box_size: moovSize,
        moov_header_b64: headerB64,
      }),
    })
  },

  removeMoviesLike: async (matchPath: string, onlyLocal = false): Promise<unknown> => {
    let endpoint = `movies?file_path=ilike.${encodeURIComponent(matchPath)}`
    if (onlyLocal) {
      endpoint += `&drive_file_id=is.null`
    }
    return await supabaseFetch(endpoint, { method: 'DELETE' })
  },

  clearMovies: async (): Promise<unknown> => {
    return await supabaseFetch('movies?id=gt.0', { method: 'DELETE' })
  },

  clearFolders: async (): Promise<unknown> => {
    return await supabaseFetch('folders?id=gt.0', { method: 'DELETE' })
  },

  getUserProgress: async (userId: string, profileId?: string) => {
    const profileFilter = profileId ? `&profile_id=eq.${profileId}` : ''
    return (
      (await supabaseFetch(
        `user_movie_progress?user_id=eq.${userId}&select=*${profileFilter}`
      )) || []
    )
  },

  saveUserProgress: async (userId: string, movieId: number, watchedDuration: number, profileId?: string) => {
    const conflict = profileId ? 'user_id,movie_id,profile_id' : 'user_id,movie_id'
    const payload: Record<string, unknown> = {
      user_id: userId,
      movie_id: movieId,
      watched_duration: watchedDuration,
      updated_at: new Date().toISOString(),
    }
    if (profileId) payload.profile_id = profileId
    return await supabaseFetch(`user_movie_progress?on_conflict=${conflict}`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { Prefer: 'resolution=merge-duplicates' },
    })
  },

  hideUserProgress: async (userId: string, movieId: number, profileId?: string) => {
    const profileFilter = profileId ? `&profile_id=eq.${profileId}` : ''
    return await supabaseFetch(
      `user_movie_progress?user_id=eq.${userId}&movie_id=eq.${movieId}${profileFilter}`,
      { method: 'PATCH', body: JSON.stringify({ is_hidden: true }) }
    )
  },

  getUserMylist: async (userId: string, profileId?: string) => {
    const profileFilter = profileId ? `&profile_id=eq.${profileId}` : ''
    return (
      (await supabaseFetch(
        `user_mylist?user_id=eq.${userId}&select=*${profileFilter}`
      )) || []
    )
  },

  addToMylist: async (userId: string, movieId: number, profileId?: string) => {
    const payload: Record<string, unknown> = { user_id: userId, movie_id: movieId }
    if (profileId) payload.profile_id = profileId
    return await supabaseFetch('user_mylist', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { Prefer: 'resolution=ignore-duplicates' },
    })
  },

  removeFromMylist: async (userId: string, movieId: number, profileId?: string) => {
    const profileFilter = profileId ? `&profile_id=eq.${profileId}` : ''
    return await supabaseFetch(
      `user_mylist?user_id=eq.${userId}&movie_id=eq.${movieId}${profileFilter}`,
      { method: 'DELETE' }
    )
  },

  isInMylist: async (userId: string, movieId: number, profileId?: string): Promise<boolean> => {
    const profileFilter = profileId ? `&profile_id=eq.${profileId}` : ''
    const result =
      (await supabaseFetch<{ id: number }[]>(
        `user_mylist?user_id=eq.${userId}&movie_id=eq.${movieId}&select=id${profileFilter}`
      )) || []
    return result.length > 0
  },

  getUserRating: async (userId: string, movieId: number, profileId?: string): Promise<number | null> => {
    const profileFilter = profileId ? `&profile_id=eq.${profileId}` : ''
    const results =
      (await supabaseFetch<{ rating: number }[]>(
        `user_movie_ratings?user_id=eq.${userId}&movie_id=eq.${movieId}&select=rating${profileFilter}`
      )) || []
    return results.length > 0 ? results[0].rating : null
  },

  saveUserRating: async (userId: string, movieId: number, rating: number, profileId?: string) => {
    const conflict = profileId ? 'user_id,movie_id,profile_id' : 'user_id,movie_id'
    const payload: Record<string, unknown> = {
      user_id: userId,
      movie_id: movieId,
      rating,
      updated_at: new Date().toISOString(),
    }
    if (profileId) payload.profile_id = profileId
    return await supabaseFetch('user_movie_ratings', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { Prefer: 'resolution=merge-duplicates' },
    })
  },

  registerSession: async (userId: string, email: string, userAgent: string, ip: string) => {
    await supabaseFetch(
      `sessions?email=eq.${encodeURIComponent(email)}`,
      { method: 'DELETE' }
    )

    return await supabaseFetch<SessionRow[]>('sessions', {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId,
        email,
        user_agent: userAgent,
        ip_address: ip,
        last_active: new Date().toISOString(),
      }),
      headers: { Prefer: 'return=representation' },
    })
  },

  validateSession: async (
    sessionId: string,
    timeoutMinutes = 60
  ): Promise<SessionRow | null> => {
    const sessions =
      (await supabaseFetch<SessionRow[]>(
        `sessions?id=eq.${sessionId}&select=*`
      )) || []
    if (sessions.length === 0) return null

    const session = sessions[0]
    const lastActive = new Date(session.last_active)
    const now = new Date()
    const diffMs = now.getTime() - lastActive.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins > timeoutMinutes) {
      console.warn(
        `[DB] Session ${sessionId} expired due to inactivity (${diffMins}m > ${timeoutMinutes}m)`
      )
      await database.deleteSession(sessionId)
      return null
    }

    await supabaseFetch(`sessions?id=eq.${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ last_active: now.toISOString() }),
    })

    return session
  },

  listSessions: async (): Promise<SessionRow[]> => {
    return (await supabaseFetch('sessions?select=*&order=last_active.desc')) || []
  },

  deleteSession: async (sessionId: string) => {
    return await supabaseFetch(`sessions?id=eq.${sessionId}`, { method: 'DELETE' })
  },

  cleanupExpiredSessions: async (timeoutMinutes = 60): Promise<number> => {
    const all = await database.listSessions()
    const now = new Date()
    const expired = all.filter((s) => {
      const diff = now.getTime() - new Date(s.last_active).getTime()
      return diff / 60000 > timeoutMinutes
    })

    for (const s of expired) {
      await database.deleteSession(s.id)
    }
    return expired.length
  },

  addRequest: async (requestData: Record<string, unknown>) => {
    return await supabaseFetch('movie_requests', {
      method: 'POST',
      body: JSON.stringify(requestData),
      headers: { Prefer: 'return=representation' },
    })
  },

  getRequests: async (filters: Record<string, unknown> = {}) => {
    const queryParams = Object.entries(filters)
      .map(([key, val]) => `${key}=eq.${encodeURIComponent(String(val))}`)
      .join('&')
    const endpoint = `movie_requests?select=*${queryParams ? '&' + queryParams : ''}&order=created_at.desc`
    return (await supabaseFetch(endpoint)) || []
  },

  updateRequest: async (id: string, data: Record<string, unknown>) => {
    return await supabaseFetch(`movie_requests?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  },

  getGlobalConfig: async (key: string): Promise<unknown> => {
    try {
      const results = await supabaseFetch<{ folder_path: string }[]>(
        `folders?folder_path=ilike.CONFIG:${key}:*&select=folder_path`
      )
      if (results && results.length > 0) {
        const prefix = `CONFIG:${key}:`
        return JSON.parse(results[0].folder_path.substring(prefix.length))
      }
    } catch (e) {
      const error = e as Error
      console.error(`[DB] getGlobalConfig error for ${key}:`, error.message)
    }
    return null
  },

  setGlobalConfig: async (key: string, value: unknown): Promise<unknown> => {
    try {
      const prefix = `CONFIG:${key}:`
      const payload = prefix + JSON.stringify(value)

      await supabaseFetch(
        `folders?folder_path=ilike.CONFIG:${key}:*`,
        { method: 'DELETE' }
      )

      return await supabaseFetch('folders', {
        method: 'POST',
        body: JSON.stringify({ folder_path: payload }),
        headers: { Prefer: 'resolution=merge-duplicates' },
      })
    } catch (e) {
      const error = e as Error
      console.error(`[DB] setGlobalConfig error for ${key}:`, error.message)
    }
  },

  // ─── Profile CRUD ──────────────────────────────────────────────────
  getProfiles: async (userId: string): Promise<ProfileRow[]> => {
    return (await supabaseFetch<ProfileRow[]>(`profiles?user_id=eq.${userId}&select=*&order=created_at.asc`)) || []
  },

  createProfile: async (userId: string, name: string, avatar_url: string | null, is_kid: boolean): Promise<ProfileRow | null> => {
    const result = await supabaseFetch<ProfileRow[]>('profiles', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, name, avatar_url, is_kid }),
      headers: { Prefer: 'return=representation' },
    })
    return Array.isArray(result) && result.length > 0 ? result[0] : null
  },

  updateProfile: async (profileId: string, data: Record<string, unknown>): Promise<unknown> => {
    return await supabaseFetch(`profiles?id=eq.${profileId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  },

  deleteProfile: async (profileId: string): Promise<unknown> => {
    return await supabaseFetch(`profiles?id=eq.${profileId}`, { method: 'DELETE' })
  },

  supabaseFetch,
}

if (SUPABASE_URL) {
  supabaseFetch('folders?select=id&limit=1')
    .then(() => {
      // connected
    })
    .catch((err: Error) => {
      console.error('[DB] Cloud Database connection failed:', err.message)
    })
}

export default database
