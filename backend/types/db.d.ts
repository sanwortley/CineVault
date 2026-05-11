// ─── Database types matching Supabase schema ───────────────────────

export interface MovieRow {
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
  identified_status: 'pending' | 'identified' | 'unknown'
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

export interface FolderRow {
  id: number
  folder_path: string
  created_at?: string
}

export interface SessionRow {
  id: string
  user_id: string
  email: string
  user_agent: string | null
  ip_address: string | null
  last_active: string
  created_at: string
}

export interface UserProgressRow {
  user_id: string
  movie_id: number
  watched_duration: number
  is_hidden: boolean | null
  updated_at: string
}

export interface UserMylistRow {
  user_id: string
  movie_id: number
  created_at: string
}

export interface MovieRequestRow {
  id: number
  title: string
  year: string | null
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
}

export interface UserRatingRow {
  user_id: string
  movie_id: number
  rating: number
  updated_at: string
}

export type MoviePayload = Record<string, unknown>
