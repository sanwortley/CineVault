import { useState, useEffect } from 'react'
import { Play, Star, Calendar, Music, Cloud, Info, Plus, Check, Film, EyeOff, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import type { Movie, MovieGroup } from '../types'

interface MovieCardProps {
  movie: Movie | MovieGroup
  onPlay?: (movie: Movie) => void
  onInfo?: (movie: Movie) => void
  compact?: boolean
  myList?: { id: number }[]
  toggleMyList?: (movie: Movie | MovieGroup) => void
  userProgress?: Record<string, { duration?: number }>
  onHideProgress?: (movieId: number) => void
}

function MovieCard({ movie, onPlay, onInfo, compact = false, myList = [] as { id: number }[], toggleMyList, userProgress = {} as Record<string, { duration?: number }>, onHideProgress }: MovieCardProps) {
  const { isAdmin } = useAuth()
  const isMobile = typeof window !== 'undefined' && (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768)
  const {
    official_title,
    detected_title,
    poster_url,
    detected_year,
    rating,
    genres,
    file_path,
    drive_file_id,
    id
  } = movie

  const title = official_title || detected_title

  const [isUploading, setIsUploading] = useState(false)

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (movie.media_type === 'episode' && 'versions' in movie && movie.versions && movie.versions.length > 0) {
      const sorted = [...movie.versions].sort((a, b) => {
        if (a.season_number !== b.season_number) return (a.season_number || 1) - (b.season_number || 1)
        return (a.episode_number || 1) - (b.episode_number || 1)
      })
      onPlay?.(sorted[0])
    } else {
      onPlay?.(movie)
    }
  }

  const [isImageLoaded, setIsImageLoaded] = useState(false)
  const isAdded = myList.some(m => m.id === id)
  const runtimeSec = (movie.runtime && movie.runtime > 0 ? movie.runtime : 120) * 60

  return (
    <div className={`relative group/card cursor-pointer ${compact ? 'max-w-[280px] md:max-w-[320px] w-full' : 'w-full'}`}>
      <div
        className="relative aspect-[2/3] overflow-hidden rounded-[0.5rem] border border-white/5 shadow-2xl transition-all duration-300 group-hover/card:ring-2 ring-netflix-red/50"
        onClick={() => onInfo?.(movie)}
      >
        {!isImageLoaded && (
          <div className="absolute inset-0 bg-zinc-900 animate-pulse flex items-center justify-center">
            <Film className="text-white/5" size={48} />
          </div>
        )}

        {poster_url ? (
          <img
            src={poster_url}
            alt={title ?? ''}
            onLoad={() => setIsImageLoaded(true)}
            className={`w-full h-full object-cover transition-all duration-700 group-hover/card:scale-110 ${isImageLoaded ? 'opacity-100' : 'opacity-0'}`}
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-b from-zinc-800 to-black flex flex-col items-center justify-center p-6 text-center shadow-inner relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-netflix-red via-transparent to-transparent"></div>
            <Film className="text-white/20 mb-4" size={32} strokeWidth={1.5} />
            <span className="text-xs uppercase font-black tracking-widest text-white/80 line-clamp-3 leading-relaxed relative z-10">{title || 'Película Desconocida'}</span>
          </div>
        )}

        <div className="absolute top-3 right-3 flex flex-col gap-2 z-20">
          {rating && (
            <div className="px-1.5 py-0.5 bg-black/80 rounded text-[9px] font-black text-white border border-white/10 flex items-center gap-1">
              <Star size={10} fill="currentColor" className="text-netflix-red" />
              <span>{rating.toFixed(1)}</span>
            </div>
          )}
          {drive_file_id && (
            <div className="p-1 bg-green-500/20 backdrop-blur-md rounded border border-green-500/30 text-green-400">
              <Cloud size={10} strokeWidth={3} />
            </div>
          )}
          {movie.media_type === 'episode' ? (
            <div className="px-1.5 py-0.5 bg-netflix-red/95 rounded text-[8px] font-black text-white border border-white/10 flex items-center gap-1 shadow-lg">
              <span>SERIE</span>
            </div>
          ) : ('versions' in movie && movie.versions && movie.versions.length > 1 && (
            <div className="px-1.5 py-0.5 bg-netflix-red/90 rounded text-[8px] font-black text-white border border-white/10 flex items-center gap-1 shadow-lg">
              <span>{movie.versions.length} VERSIONES</span>
            </div>
          ))}
        </div>

        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent opacity-0 group-hover/card:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-2 sm:p-4 z-10">
          {onHideProgress && userProgress[movie.id]?.duration && (
            <button
              onClick={(e) => { e.stopPropagation(); onHideProgress(movie.id) }}
              className="absolute top-2 left-2 p-1.5 bg-black/60 hover:bg-netflix-red text-white/80 hover:text-white rounded-full backdrop-blur-md border border-white/10 transition-all z-30 active:scale-90"
              title="Quitar de Continuar Viendo"
            >
              <X size={14} />
            </button>
          )}

          <div className="flex items-center gap-1.5 mb-1 sm:mb-3">
            <button
              onClick={handlePlay}
              className="p-1.5 sm:p-2 bg-white text-black rounded-full hover:bg-white/80 transition-transform active:scale-95 shadow-xl"
            >
              <Play size={isMobile ? 15 : 16} fill="currentColor" />
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); toggleMyList?.(movie) }}
              className={`p-1.5 sm:p-2 rounded-full transition-all active:scale-95 border border-white/20 ${isAdded ? 'bg-netflix-red text-white' : 'bg-netflix-black/80 text-white hover:bg-zinc-800'}`}
              title={isAdded ? 'Quitar de Mi Lista' : 'Añadir a Mi Lista'}
            >
              {isAdded ? <Check size={isMobile ? 15 : 16} strokeWidth={3} /> : <Plus size={isMobile ? 15 : 16} strokeWidth={3} />}
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); onInfo?.(movie) }}
              className="p-1.5 sm:p-2 bg-netflix-black/80 text-white rounded-full hover:bg-zinc-800 transition-transform active:scale-95 border border-white/20 ml-auto"
            >
              <Info size={isMobile ? 15 : 16} />
            </button>

            {!isMobile && !drive_file_id && isAdmin() && (
              <span className="text-[9px] text-slate-400">No disponible para web</span>
            )}
          </div>

          <div className="flex items-center gap-2 text-[10px] font-bold text-white mb-1">
            <span className="text-green-500">98% para ti</span>
            <span className="border border-white/40 px-1 rounded-[1px] text-[8px]">16+</span>
            {movie.media_type === 'episode' && 'versions' in movie && movie.versions ? (
              <span>{movie.versions.length} {movie.versions.length === 1 ? 'Capítulo' : 'Capítulos'}</span>
            ) : (
              <span>{detected_year}</span>
            )}
          </div>
        </div>

        {(isUploading || (userProgress[movie.id]?.duration ?? 0) > 0) && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
            <div
              className="h-full bg-netflix-red transition-all duration-300"
              style={{ width: `${Math.min(100, ((userProgress[movie.id]?.duration || 0) / runtimeSec) * 100)}%` }}
            ></div>
          </div>
        )}
      </div>

      {!compact && (
        <div className="mt-1.5 px-0.5">
          <h3 className="text-[10px] sm:text-sm font-bold text-slate-400 group-hover/card:text-white transition-colors line-clamp-2 leading-tight">
            {title}
          </h3>
        </div>
      )}
    </div>
  )
}

export default MovieCard
