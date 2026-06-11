import { useState, useEffect, type FormEvent } from 'react';
import { Search, TrendingUp, Download, Play, Shield, Loader, Plus, X, Star, Calendar, Clock, Globe, CheckCircle2 } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useProfile } from '../context/ProfileContext';
import { useUploadQueue } from '../context/UploadQueueContext';
import MovieNews from '../components/MovieNews';
import type { Movie, TorrentResult } from '../types';

interface ExplorePageProps {
  onInfoMovie: (movie: Record<string, unknown>) => void
  onPlayMovie: (movie: Record<string, unknown>) => void
}

export default function ExplorePage({ onInfoMovie, onPlayMovie }: ExplorePageProps) {
  const { isAdmin } = useAuth();
  const { activeProfile } = useProfile();
  const { addToQueue } = useUploadQueue();
  const isKidMode = activeProfile?.is_kid || false;
  const [trending, setTrending] = useState<Record<string, unknown>[]>([]);
  const [searchResults, setSearchResults] = useState<Record<string, unknown>[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [searchMode, setSearchMode] = useState<'catalog' | 'global'>('catalog');
  const [globalResults, setGlobalResults] = useState<Record<string, unknown>[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [downloadingMovieId, setDownloadingMovieId] = useState<string | null>(null);

  useEffect(() => {
    const fetchTrending = async () => {
      try {
        const data = await api.exploreTrending() as Record<string, unknown>[];
        setTrending(data);
      } catch (err) {
        const error = err as Error;
        console.error('Error fetching trending:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchTrending();

    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) {
      setQuery(q);
      setSearchMode('global');
      const performSearch = async () => {
        setIsSearching(true);
        setHasSearched(true);
        try {
          const data = await api.deepSearch(q) as Record<string, unknown>[];
          setGlobalResults(data);
          setSearchResults([]);
        } catch (err) {
          const error = err as Error;
          console.error('Deep link search error:', error);
        } finally {
          setIsSearching(false);
        }
      };
      performSearch();
    }
  }, []);

  const visibleTrending = isKidMode ? trending.filter(m => !m.adult) : trending;
  const visibleSearchResults = isKidMode ? searchResults.filter(m => !m.adult) : searchResults;

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setIsSearching(true);
    setHasSearched(true);
    try {
      if (searchMode === 'catalog') {
                const data = await api.searchMoviesGlobal(query) as Record<string, unknown>[];
                setSearchResults(data);
                setGlobalResults([]);
              } else {
                const data = await api.deepSearch(query) as Record<string, unknown>[];
                setGlobalResults(data);
        setSearchResults([]);
      }
    } catch (err) {
      const error = err as Error;
      console.error('Search error:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const openMovieModal = (movie: Record<string, unknown>) => {
    const isTv = movie.media_type === 'tv'
    const titleVal = (isTv ? movie.name : movie.title) || movie.title || movie.name
    const origTitle = (isTv ? movie.original_name : movie.original_title) || movie.original_title || movie.original_name
    const dateVal = (isTv ? movie.first_air_date : movie.release_date) || movie.release_date || movie.first_air_date

    const mappedMovie: Record<string, unknown> = {
      ...movie,
      official_title: titleVal || origTitle,
      detected_year: (dateVal as string | undefined)?.substring(0, 4),
      poster_url: movie.poster_path ? `https://image.tmdb.org/t/p/w780${movie.poster_path as string}` : null,
      backdrop_url: movie.backdrop_path ? `https://image.tmdb.org/t/p/original${movie.backdrop_path as string}` : null,
      summary: movie.overview,
      tmdb_id: movie.id,
      media_type: isTv ? 'tv' : 'movie'
    };
    onInfoMovie(mappedMovie);
  };

  const handleDownload = async (torrent: Record<string, unknown>, customMovie: Record<string, unknown> | null = null) => {
    if (!isAdmin()) return;

    const movieId = customMovie ? String(customMovie.id) : 'unknown';
    setDownloadingMovieId(movieId);
    try {
      const result = await api.downloadMovie(
        movieId,
        customMovie?.title as string,
        torrent.link as string,
        new Date().getFullYear().toString(),
        { isPage: torrent.isPage as boolean, isHash: torrent.isHash as boolean }
      );

      const registeredMovieId = (result as Record<string, unknown>)?.movieId as string | number | undefined || movieId;
      addToQueue({
        id: registeredMovieId,
        official_title: customMovie?.title as string | null | undefined,
        _directQueue: true
      });
    } catch (err) {
      const error = err as Error;
      alert('Error al iniciar la descarga: ' + error.message);
    } finally {
      setDownloadingMovieId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-black">
        <Loader className="animate-spin text-netflix-red" size={48} />
      </div>
    );
  }

  return (
    <div className="px-4 md:p-12 pt-2 md:pt-16 pb-40 max-w-7xl mx-auto animate-fade-in relative z-10">
      <header className="mb-2 md:mb-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-2 md:gap-4">
          <div className="text-center md:text-left">
            <h1 className="text-2xl md:text-5xl font-black tracking-tighter text-white mb-0 md:mb-1 leading-none">
              <span className="bg-clip-text text-transparent bg-gradient-to-br from-white via-slate-400 to-slate-600">Explorar</span>
            </h1>
            <p className="text-slate-500 text-[8px] md:text-xs font-bold tracking-widest uppercase opacity-60 hidden md:block">Descubre y solicita contenido para tu bóveda.</p>
            {isKidMode && (
              <p className="text-green-400 text-[7px] md:text-[10px] font-black tracking-widest uppercase flex items-center gap-1.5 mt-1">
                <Shield size={12} /> Modo Niños activo — Solo contenido apto
              </p>
            )}
          </div>

          <div className="flex flex-col md:flex-row items-center gap-3 w-full md:w-auto">
            <div className="flex bg-white/5 p-1 rounded-xl border border-white/10 shrink-0 scale-90 md:scale-100">
              <button
                onClick={() => { setSearchMode('catalog'); setHasSearched(false); setSearchResults([]); setGlobalResults([]); }}
                className={`px-4 md:px-6 py-2 md:py-3 rounded-lg text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all ${searchMode === 'catalog' ? 'bg-white text-black shadow-xl' : 'text-slate-500 hover:text-white'}`}
              >
                Catálogo
              </button>
              {isAdmin() && (
                <button
                  onClick={() => { setSearchMode('global'); setHasSearched(false); setSearchResults([]); setGlobalResults([]); }}
                  className={`px-4 md:px-6 py-2 md:py-3 rounded-lg text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all ${searchMode === 'global' ? 'bg-white text-black shadow-xl' : 'text-slate-500 hover:text-white'}`}
                >
                  Bóveda Global
                </button>
              )}
            </div>

            <form onSubmit={handleSearch} className="w-full md:w-80 relative group">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchMode === 'catalog' ? 'Buscar en TMDb...' : 'Buscar en toda la web...'}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-5 py-2.5 md:py-3 pl-11 pr-10 text-xs md:text-sm text-white focus:outline-none focus:border-netflix-red transition-all group-hover:bg-white/10"
              />
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-netflix-red transition-colors" size={16} />
              {query && (
                <button
                  type="button"
                  onClick={() => { setQuery(''); setHasSearched(false); setSearchResults([]); setGlobalResults([]); }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                >
                  <X size={14} />
                </button>
              )}
              <button type="submit" className="hidden">Buscar</button>
            </form>
          </div>
        </div>
      </header>

      <main>
        {searchMode === 'catalog' && !query && !isSearching && <MovieNews />}

        {searchMode === 'global' ? (
          <section className="mb-20">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <Globe className="text-cyan-400" size={24} />
                <h2 className="text-xl md:text-2xl font-black text-white tracking-tight">Bóveda Global</h2>
              </div>
              {isSearching && <Loader className="animate-spin text-cyan-400" size={20} />}
            </div>

            {isSearching ? (
              <div className="py-20 flex flex-col items-center justify-center text-center">
                <Loader className="animate-spin text-cyan-400 mb-4" size={48} />
                <h3 className="text-lg font-black text-white uppercase tracking-widest">Buscando en la red...</h3>
                <p className="text-slate-500 text-xs mt-2 font-bold uppercase tracking-widest">Esto podría tardar unos segundos</p>
              </div>
            ) : globalResults.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {globalResults.map((res, idx) => (
                  <GlobalResultCard
                    key={idx}
                    result={res as { title: string; size: string; seeds: number; provider: string; link?: string }}
                    isAdmin={isAdmin()}
                    isDownloading={downloadingMovieId === `global-${idx}`}
                    onDownload={() => handleDownload(res, { id: `global-${idx}`, title: res.title })}
                  />
                ))}
              </div>
            ) : hasSearched ? (
              <div className="py-20 border border-dashed border-white/5 rounded-[3rem] flex flex-col items-center justify-center text-center bg-white/[0.01]">
                <Globe className="text-slate-700 mb-6" size={64} strokeWidth={1} />
                <h3 className="text-xl font-black text-white uppercase tracking-tighter">Sin resultados en la red</h3>
                <p className="text-slate-500 text-xs mt-2 font-bold uppercase tracking-widest">Intenta con otros términos de búsqueda (ej: nombre en inglés)</p>
              </div>
            ) : (
              <div className="py-10 md:py-20 border border-white/5 rounded-[2rem] md:rounded-[3rem] flex flex-col items-center justify-center text-center bg-gradient-to-b from-white/[0.02] to-transparent">
                <Globe className="text-slate-500 mb-4 md:mb-6" size={48} strokeWidth={1} />
                <h3 className="text-lg md:text-xl font-black text-white/40 uppercase tracking-tighter">Explora la Web Profunda</h3>
                <p className="text-slate-600 text-[9px] md:text-[10px] mt-1 md:mt-2 font-black uppercase tracking-[0.2em]">Busca cualquier torrent directamente aquí</p>
              </div>
            )}
          </section>
        ) : (isSearching || visibleSearchResults.length > 0 || (hasSearched && searchResults.length > 0)) ? (
          <section className="mb-20">
            <div className="flex items-center gap-3 mb-8">
              <h2 className="text-xl md:text-2xl font-black text-white tracking-tight">Catálogo Internacional</h2>
              {isSearching && <Loader className="animate-spin text-netflix-red" size={20} />}
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 md:gap-8 pb-32">
              {visibleSearchResults.map(movie => (
                <MovieCard key={movie.id as number} movie={movie as Record<string, unknown>} onClick={() => openMovieModal(movie)} />
              ))}
            </div>
          </section>
        ) : (
          <section>
            <div className="flex items-center gap-3 mb-8">
              <TrendingUp className="text-netflix-red" size={24} />
              <h2 className="text-xl md:text-2xl font-black text-white tracking-tight">Lo más visto esta semana</h2>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 md:gap-8 pb-32">
              {visibleTrending.map(movie => (
                <MovieCard key={movie.id as number} movie={movie as Record<string, unknown>} onClick={() => openMovieModal(movie)} />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

const isMobile = typeof window !== 'undefined' && (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768);

interface MovieCardProps {
  movie: Record<string, unknown>
  onClick: () => void
}

function MovieCard({ movie, onClick }: MovieCardProps) {
  const isTv = movie.media_type === 'tv'
  const titleVal = (isTv ? movie.name : movie.title) || movie.title || movie.name
  const dateVal = (isTv ? movie.first_air_date : movie.release_date) || movie.release_date || movie.first_air_date

  return (
    <div
      onClick={onClick}
      className="flex-none w-full group cursor-pointer"
    >
      <div className="relative aspect-[2/3] rounded-[1rem] md:rounded-[2rem] overflow-hidden shadow-2xl transition-all duration-500 border border-white/5 group-hover:border-netflix-red/50">
        <img
          src={movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path as string}` : 'https://images.placeholders.dev/?width=500&height=750&text=Sin%20Poster&bgColor=%23141414&textColor=%23555555'}
          alt={String(titleVal) || ''}
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
          loading="lazy"
        />

        {/* Permanent overlay badges visible at all times, including mobile */}
        <div className="absolute top-2 md:top-4 right-2 md:right-4 flex flex-col gap-1.5 z-20">
          <span className={`px-2 py-0.5 md:px-2.5 md:py-1 rounded text-[7px] md:text-[9px] font-black uppercase text-white tracking-wider border border-white/10 shadow-lg ${isTv ? 'bg-netflix-red/95' : 'bg-slate-950/85'}`}>
            {isTv ? 'SERIE' : 'PELÍCULA'}
          </span>
          {typeof movie.vote_average === 'number' && (
            <div className="px-1.5 py-0.5 bg-black/80 rounded text-[7px] md:text-[9px] font-black text-white border border-white/10 flex items-center justify-center gap-1 shadow-md self-end">
              <Star size={8} fill="currentColor" className="text-netflix-red" />
              <span>{movie.vote_average.toFixed(1)}</span>
            </div>
          )}
        </div>

        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3 md:p-5 z-10">
          <h3 className="text-[9px] md:text-sm font-black text-white leading-tight mb-1 truncate">{String(titleVal)}</h3>
          <p className="text-[8px] md:text-[10px] font-bold text-white/60 mb-1 md:mb-2">{(dateVal as string | undefined)?.substring(0, 4) || 'N/A'}</p>

          {!isMobile && (
            <button className="w-full py-2.5 bg-white text-black text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-netflix-red hover:text-white transition-colors">
              Ver Detalles
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function detectResultLang(title: string): { badge: string; color: string } | null {
  const t = title.toUpperCase()
  if (/\b(LATINO|LAT|LAT\.)\b/.test(t)) return { badge: 'LAT', color: 'bg-green-500/20 text-green-400 border-green-500/30' }
  if (/\b(CASTELLANO|ESPAÑOL|ESP|SPA)\b/.test(t)) return { badge: 'ESP', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' }
  if (/\b(DUAL|MULTI)\b/.test(t)) return { badge: 'DUAL', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' }
  return null
}

interface GlobalResultCardProps {
  result: { title: string; size: string; seeds: number; provider: string; link?: string }
  onDownload: () => void
  isAdmin: boolean
  isDownloading: boolean
}

function GlobalResultCard({ result, onDownload, isAdmin, isDownloading }: GlobalResultCardProps) {
  const langInfo = detectResultLang(result.title)
  return (
    <div
      className={`bg-white/5 border border-white/10 rounded-2xl md:rounded-3xl p-4 md:p-6 flex flex-col justify-between transition-all group ${!isMobile ? 'hover:bg-white/[0.08]' : ''}`}
    >
      <div className="mb-4 md:mb-6">
        <div className="flex items-center gap-2 mb-2 md:mb-3 flex-wrap">
          <span className="px-2 py-0.5 bg-cyan-500/10 text-cyan-400 text-[7px] md:text-[8px] font-black uppercase rounded-md border border-cyan-500/20">{result.provider}</span>
          {langInfo && (
            <span className={`px-2 py-0.5 text-[7px] md:text-[8px] font-black uppercase rounded-md border ${langInfo.color}`}>{langInfo.badge}</span>
          )}
        </div>
        <h3 className="text-xs md:text-sm font-black text-white leading-snug group-hover:text-cyan-400 transition-colors line-clamp-2 mb-3 md:mb-4">{result.title}</h3>
        <div className="flex items-center gap-3 md:gap-4 text-[9px] md:text-[10px] font-bold text-slate-500 uppercase tracking-widest">
          <span className="flex items-center gap-1.5"><Download size={10} /> {result.size}</span>
          <span className="flex items-center gap-1.5"><TrendingUp size={10} /> {result.seeds} Seeds</span>
        </div>
      </div>

      <button
        onClick={onDownload}
        disabled={!isAdmin || isDownloading}
        className={`w-full py-3 md:py-3.5 rounded-xl text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${isAdmin ? 'bg-white text-black hover:bg-netflix-red hover:text-white' : 'bg-white/5 text-slate-600 border border-white/5 cursor-not-allowed'} ${isDownloading ? 'opacity-50 animate-pulse' : ''}`}
      >
        {isDownloading ? <Loader className="animate-spin" size={12} /> : <Plus size={14} strokeWidth={3} />}
        {isAdmin ? 'Añadir a la Bóveda' : 'Acceso Denegado'}
      </button>
    </div>
  );
}
