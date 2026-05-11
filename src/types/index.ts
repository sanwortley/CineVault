// ─── Movie ──────────────────────────────────────────────────────────
export type IdentifiedStatus = 'pending' | 'identified' | 'unknown'

export interface Movie {
  id: number
  file_name: string
  file_path: string
  file_size: number
  extension: string
  detected_title: string | null
  detected_year: string | null
  official_title: string | null
  overview: string | null
  spoiler_free_summary: string | null
  poster_url: string | null
  backdrop_url: string | null
  genres: string | null
  runtime: number | null
  director: string | null
  rating: number | null
  identified_status: IdentifiedStatus
  needs_manual_confirmation: boolean
  is_favorite: boolean
  is_watched: boolean
  last_played: string | null
  created_at: string
  updated_at: string
  drive_file_id: string | null
  cast: string | null
  release_date: string | null
  watched_duration?: number | null
  last_watched_at?: string | null
  original_title?: string | null
  cloud_source_url?: string | null
  video_width?: number | null
  video_height?: number | null
  video_codec?: string | null
  audio_codec?: string | null
  video_bitrate?: number | null
  duration_seconds?: number | null
  original_resolution?: string | null
}

export interface Folder {
  id: number
  folder_path: string
  created_at?: string
}

// ─── Session ────────────────────────────────────────────────────────
export interface Session {
  id: string
  user_id: string
  email: string
  user_agent: string | null
  ip_address: string | null
  last_active: string
  created_at: string
}

// ─── User Progress ──────────────────────────────────────────────────
export interface UserProgress {
  user_id: string
  movie_id: number
  watched_duration: number
  is_hidden: boolean | null
  updated_at: string
}

export interface UserMylist {
  user_id: string
  movie_id: number
  created_at: string
}

export interface MovieRequest {
  id: number
  title: string
  year: string | null
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
}

export interface UserRating {
  user_id: string
  movie_id: number
  rating: number
  updated_at: string
}

// ─── Auth ───────────────────────────────────────────────────────────
export interface AuthUser {
  id: string
  email: string
  user_metadata?: {
    name?: string
    avatar_url?: string
  }
}

export interface AuthState {
  user: AuthUser | null
  sessionId: string | null
  loading: boolean
  isAdmin: boolean
}

export interface RegisterSessionResponse {
  sessionId: string
}

export interface AuthMeResponse {
  user: Session
  isAdmin: boolean
}

// ─── Upload Queue ───────────────────────────────────────────────────
export type UploadJobStatus = 'pending' | 'uploading' | 'optimizing' | 'done' | 'error'

export interface UploadJob {
  movieId: number
  title: string
  filePath: string
  mimeType: string
  status: UploadJobStatus
  progress: number
  error?: string
  isUrl?: boolean
  options?: {
    deleteAfter?: boolean
    optimize?: boolean
  }
}

export interface UploadProgressEvent {
  movieId: number
  progress: number
  status: string
  isOptimizing?: boolean
  error?: string
}

// ─── Subtitles ──────────────────────────────────────────────────────
export interface SubtitleSearchQuery {
  imdbId?: string
  title?: string
  filename?: string
  year?: string
  query?: string
}

export interface SubtitleResult {
  id: number
  label: string
  language: string
  release: string
  score: number
  type: 'cloud' | 'local'
}

export interface SubtitleSearchResponse {
  data: SubtitleResult[]
}

export interface SubtitleDownloadResponse {
  localPath: string
  savedLocally: boolean
  success: boolean
}

export interface CloudSubtitleCheck {
  found: boolean
  fileId?: string
  name?: string
  type?: 'cloud'
}

// ─── TMDB ───────────────────────────────────────────────────────────
export interface TMDBMovieResult {
  id: number
  title: string
  original_title: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  release_date: string
  genre_ids: number[]
  popularity: number
  vote_average: number
  vote_count: number
}

export interface TMDBDetails extends TMDBMovieResult {
  genres: { id: number; name: string }[]
  runtime: number
  credits?: {
    crew: { job: string; name: string }[]
    cast: { name: string; character: string; profile_path: string | null }[]
  }
}

export interface TMDBSearchResponse {
  page: number
  results: TMDBMovieResult[]
  total_pages: number
  total_results: number
}

// ─── Drive ──────────────────────────────────────────────────────────
export interface DriveFile {
  id: string
  name: string
  mimeType: string
  size?: string
  parents?: string[]
  modifiedTime?: string
}

export interface DriveListResponse {
  files: DriveFile[]
}

export interface DriveAuthStatus {
  authenticated: boolean
}

// ─── Debrid / Torrent ───────────────────────────────────────────────
export interface TorrentResult {
  title: string
  size: string
  seeds: number
  link: string
  isHash: boolean
  provider: string
}

export interface DiscoverMovie {
  id: number
  title: string
  year: string
  poster: string
  overview: string
  tmdb_id?: number
}

// ─── API Response Wrappers ──────────────────────────────────────────
export interface ApiError {
  error: string
  message?: string
  isQuota?: boolean
}

export interface ApiSuccess<T = unknown> {
  success: true
  data?: T
}

export interface AudioTrack {
  index: number
  language: string
  title: string
  codec: string
  default: boolean
}

// ─── Video Player ───────────────────────────────────────────────────
export interface VideoSource {
  type: 'drive' | 'local' | 'cloud'
  fileId?: string
  filePath?: string
  movieId?: number
}

export interface PlayerState {
  playing: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  fullscreen: boolean
  quality: string
}

// ─── Version Info ───────────────────────────────────────────────────
export interface VersionInfo {
  label: string
  isHD: boolean
  is4K: boolean
  lang: string
}

// ─── Movie Groups (for duplicate grouping) ──────────────────────────
export interface MovieGroup extends Movie {
  versions: Movie[]
}

// ─── Config ─────────────────────────────────────────────────────────
export interface OSCredentials {
  username: string
  password: string
}

export interface GlobalConfigResponse {
  key?: string
  token?: string
  username?: string
  password?: string
}
