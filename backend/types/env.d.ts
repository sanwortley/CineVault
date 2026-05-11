// ─── Process.env augmentation ──────────────────────────────────────
declare namespace NodeJS {
  interface ProcessEnv {
    PORT?: string
    TMDB_API_KEY?: string
    OMDB_API_KEY?: string
    SUPABASE_URL?: string
    SUPABASE_ANON_KEY?: string
    GOOGLE_CLIENT_ID?: string
    GOOGLE_CLIENT_SECRET?: string
    GOOGLE_API_KEY?: string
    REAL_DEBRID_API_TOKEN?: string
    OPENSUBTITLES_API_KEY?: string
    OS_USERNAME?: string
    OS_PASSWORD?: string
    MOVIES_PATH?: string
    BACKEND_URL?: string
    ADMIN_EMAIL?: string
    VITE_ADMIN_EMAIL?: string
    DRIVE_TOKEN_PATH?: string
    DRIVE_TOKEN_VOLUME_PATH?: string
    SESSION_TIMEOUT_MINUTES?: string
  }
}

// ─── Express Request augmentation ──────────────────────────────────
declare namespace Express {
  interface Request {
    session?: {
      id: string
      user_id: string
      email: string
      user_agent?: string | null
      ip_address?: string | null
      last_active: string
    }
    file?: Express.Multer.File
    files?: Express.Multer.File[]
  }
}

// ─── Multer File ───────────────────────────────────────────────────
declare namespace Express {
  namespace Multer {
    interface File {
      fieldname: string
      originalname: string
      encoding: string
      mimetype: string
      size: number
      destination: string
      filename: string
      path: string
      buffer: Buffer
    }
  }
}
