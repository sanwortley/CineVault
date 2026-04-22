import React, { useState, useEffect } from 'react';
import { Search, TrendingUp, Download, Play, Shield, Loader, Plus, X, Star, Calendar, Clock, Globe, CheckCircle2 } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useUploadQueue } from '../context/UploadQueueContext';
import { motion, AnimatePresence } from 'framer-motion';
import MovieNews from '../components/MovieNews';

export default function ExplorePage() {
    const { isAdmin } = useAuth();
    const { addToQueue } = useUploadQueue();
    const [trending, setTrending] = useState([]);
    const [searchResults, setSearchResults] = useState([]);
    const [query, setQuery] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedMovie, setSelectedMovie] = useState(null);
    const [torrents, setTorrents] = useState([]);
    const [isFetchingTorrents, setIsFetchingTorrents] = useState(false);
    const [downloadingMovieId, setDownloadingMovieId] = useState(null);
    const [searchMode, setSearchMode] = useState('catalog'); // 'catalog' or 'global'
    const [globalResults, setGlobalResults] = useState([]);
    const [hasSearched, setHasSearched] = useState(false);
    const [isRequesting, setIsRequesting] = useState(false);
    const [requestSuccess, setRequestSuccess] = useState(false);

    useEffect(() => {
        if (selectedMovie) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
    }, [selectedMovie]);

    useEffect(() => {
        const fetchTrending = async () => {
            try {
                const data = await api.exploreTrending();
                setTrending(data);
            } catch (err) {
                console.error('Error fetching trending:', err);
            } finally {
                setIsLoading(false);
            }
        };
        fetchTrending();

        // Handle deep-link search Query
        const params = new URLSearchParams(window.location.search);
        const q = params.get('q');
        if (q) {
            setQuery(q);
            setSearchMode('global');
            const performSearch = async () => {
                setIsSearching(true);
                setHasSearched(true);
                try {
                    const data = await api.deepSearch(q);
                    setGlobalResults(data);
                    setSearchResults([]);
                } catch (err) {
                    console.error('Deep link search error:', err);
                } finally {
                    setIsSearching(false);
                }
            };
            performSearch();
        }
    }, []);

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!query.trim()) return;
        setIsSearching(true);
        setHasSearched(true);
        try {
            if (searchMode === 'catalog') {
                const data = await api.searchMoviesGlobal(query);
                setSearchResults(data);
                setGlobalResults([]);
            } else {
                const data = await api.deepSearch(query);
                setGlobalResults(data);
                setSearchResults([]);
            }
        } catch (err) {
            console.error('Search error:', err);
        } finally {
            setIsSearching(false);
        }
    };

    const openMovieModal = async (movie) => {
        setSelectedMovie(movie);
        setTorrents([]);
        if (isAdmin()) {
            setIsFetchingTorrents(true);
            try {
                const data = await api.findTorrents(movie.title || movie.original_title);
                setTorrents(data);
            } catch (err) {
                console.error('Error fetching torrents:', err);
            } finally {
                setIsFetchingTorrents(false);
            }
        }
    };

    const handleDownload = async (torrent, customMovie = null) => {
        const movie = customMovie || selectedMovie;
        if (!movie || !isAdmin()) return;
        
        setDownloadingMovieId(movie.id);
        try {
            const result = await api.downloadMovie(
                movie.id, 
                movie.title || movie.original_title, 
                torrent.link,
                movie.release_date?.substring(0, 4) || new Date().getFullYear().toString(),
                { isPage: torrent.isPage, isHash: torrent.isHash }
            );

            // Immediately register in the activity queue so the bell shows it right away
            // The result contains the real movieId assigned by the backend
            const registeredMovieId = result?.movieId || movie.id;
            const movieTitle = movie.title || movie.original_title;
            addToQueue({ 
                id: registeredMovieId, 
                official_title: movieTitle,
                // These prevents UploadQueueContext from opening a file picker
                _directQueue: true 
            });

            if (!customMovie) setSelectedMovie(null);
        } catch (err) {
            alert('Error al iniciar la descarga: ' + err.message);
        } finally {
            setDownloadingMovieId(null);
        }
    };

    const handleRequestMovie = async (movie) => {
        setIsRequesting(true);
        try {
            await api.submitMovieRequest({
                tmdbId: movie.id,
                title: movie.title,
                posterPath: movie.poster_path
            });
            setRequestSuccess(true);
            setTimeout(() => setRequestSuccess(false), 3000);
        } catch (err) {
            alert('Error al enviar solicitud: ' + err.message);
        } finally {
            setIsRequesting(false);
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
        <div className="px-4 md:p-12 pt-2 md:pt-16 pb-40 max-w-7xl mx-auto animate-fade-in no-drag relative z-10">
            {/* Header & Search */}
            <header className="mb-2 md:mb-10">
                <div className="flex flex-col md:flex-row items-center justify-between gap-2 md:gap-4">
                    <div className="text-center md:text-left">
                        <h1 className="text-2xl md:text-5xl font-black tracking-tighter text-white mb-0 md:mb-1 leading-none">
                            <span className="bg-clip-text text-transparent bg-gradient-to-br from-white via-slate-400 to-slate-600">Explorar</span>
                        </h1>
                        <p className="text-slate-500 text-[8px] md:text-xs font-bold tracking-widest uppercase opacity-60 hidden md:block">Descubre y solicita contenido para tu bóveda.</p>
                    </div>

                    <div className="flex flex-col md:flex-row items-center gap-3 w-full md:w-auto">
                        {/* Mode Selector */}
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
                                placeholder={searchMode === 'catalog' ? "Buscar en TMDb..." : "Buscar en toda la web..."}
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

            {/* Search Results / Trending / Global Results / News */}
            <main>
                {/* Always show news if not searching or in global mode */}
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
                                        result={res} 
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
                                <Globe className="text-slate-500 mb-4 md:mb-6" size={48} md:size={64} strokeWidth={1} />
                                <h3 className="text-lg md:text-xl font-black text-white/40 uppercase tracking-tighter">Explora la Web Profunda</h3>
                                <p className="text-slate-600 text-[9px] md:text-[10px] mt-1 md:mt-2 font-black uppercase tracking-[0.2em]">Busca cualquier torrent directamente aquí</p>
                            </div>
                        )}
                    </section>
                ) : (isSearching || searchResults.length > 0) ? (
                    <section className="mb-20">
                        <div className="flex items-center gap-3 mb-8">
                            <h2 className="text-xl md:text-2xl font-black text-white tracking-tight">Catálogo Internacional</h2>
                            {isSearching && <Loader className="animate-spin text-netflix-red" size={20} />}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
                            {searchResults.map(movie => (
                                <MovieCard key={movie.id} movie={movie} onClick={() => openMovieModal(movie)} />
                            ))}
                        </div>
                    </section>
                ) : (
                    <section>
                        <div className="flex items-center gap-3 mb-8">
                            <TrendingUp className="text-netflix-red" size={24} />
                            <h2 className="text-xl md:text-2xl font-black text-white tracking-tight">Lo más visto esta semana</h2>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
                            {trending.map(movie => (
                                <MovieCard key={movie.id} movie={movie} onClick={() => openMovieModal(movie)} />
                            ))}
                        </div>
                    </section>
                )}
            </main>

            {/* Movie Detail Modal */}
            <AnimatePresence>
                {selectedMovie && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 bg-black/90 backdrop-blur-xl">
                        <motion.div 
                            initial={{ opacity: 0, scale: 0.9, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 20 }}
                            className="bg-[#111] border border-white/10 rounded-[2rem] max-w-5xl w-full h-[95vh] md:h-auto md:max-h-[85vh] overflow-hidden flex flex-col md:flex-row relative shadow-2xl"
                        >
                            <button 
                                onClick={() => setSelectedMovie(null)}
                                className="absolute top-6 right-6 p-3 bg-black/50 hover:bg-white/10 rounded-full text-white z-10 transition-colors"
                            >
                                <X size={24} />
                            </button>

                            {/* Poster Side */}
                            <div className="w-full md:w-2/5 h-48 md:h-auto shrink-0 relative">
                                <img 
                                    src={selectedMovie.poster_path ? `https://image.tmdb.org/t/p/w780${selectedMovie.poster_path}` : 'https://via.placeholder.com/780x1170?text=Sin+Poster'} 
                                    alt={selectedMovie.title}
                                    className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-[#111] via-transparent to-transparent md:hidden"></div>
                            </div>

                            {/* Info Side */}
                            <div className="w-full md:w-3/5 p-8 md:p-12 overflow-y-auto custom-scrollbar bg-gradient-to-br from-transparent to-black/20">
                                <div className="flex items-center gap-2 mb-4">
                                    <span className="px-3 py-1 bg-netflix-red text-[10px] font-black uppercase text-white rounded-full">TMDb Discovery</span>
                                    <div className="flex items-center gap-1.5 ml-2">
                                        <Star className="text-yellow-500" size={14} fill="currentColor" />
                                        <span className="text-sm font-bold text-white">{selectedMovie.vote_average?.toFixed(1)}</span>
                                    </div>
                                </div>

                                <h2 className="text-3xl md:text-5xl font-black text-white tracking-tighter mb-4 leading-tight">{selectedMovie.title}</h2>
                                <div className="flex flex-wrap gap-4 text-xs font-bold text-slate-400 mb-8 uppercase tracking-widest">
                                    <div className="flex items-center gap-1.5"><Calendar size={14} /> {selectedMovie.release_date?.substring(0, 4)}</div>
                                    <div className="flex items-center gap-1.5"><Globe size={14} /> {selectedMovie.original_language?.toUpperCase()}</div>
                                </div>

                                <p className="text-slate-400 text-sm md:text-base leading-relaxed mb-12 opacity-80">{selectedMovie.overview}</p>

                                {/* Torrent Selection (Admin Only) */}
                                <div className="mt-auto">
                                    <h3 className="text-lg font-black text-white mb-6 flex items-center gap-2">
                                        <Shield size={18} className="text-netflix-red" />
                                        {isAdmin() ? 'Opciones de Obtención (Dual Audio/HD)' : '¿No está en la Bóveda?'}
                                    </h3>

                                    {!isAdmin() ? (
                                        <div className="p-8 border border-white/5 bg-white/[0.02] rounded-3xl text-center">
                                            <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mb-6 px-4">
                                                Esta película no se encuentra actualmente disponible en tu colección privada.
                                            </p>
                                            <button 
                                                onClick={() => handleRequestMovie(selectedMovie)}
                                                disabled={isRequesting || requestSuccess}
                                                className={`w-full py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${requestSuccess ? 'bg-green-500 text-white' : 'bg-white text-black hover:bg-netflix-red hover:text-white'}`}
                                            >
                                                {isRequesting ? <Loader className="animate-spin" size={14} /> : 
                                                 requestSuccess ? <CheckCircle2 size={14} /> : <Plus size={14} strokeWidth={3} />}
                                                {requestSuccess ? '¡Solicitud enviada!' : 'Solicitar para la Bóveda'}
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {isFetchingTorrents ? (
                                                <div className="p-8 flex flex-col items-center justify-center opacity-40">
                                                    <Loader className="animate-spin mb-4" size={32} />
                                                    <p className="text-[10px] font-black uppercase tracking-widest">Buscando el mejor torrent...</p>
                                                </div>
                                            ) : torrents.length === 0 ? (
                                                <div className="p-8 border border-dashed border-white/10 rounded-3xl text-center opacity-40">
                                                    <p className="text-[10px] font-black uppercase tracking-widest">No se encontraron fuentes para esta película.</p>
                                                </div>
                                            ) : (
                                                torrents.slice(0, 6).map((torrent, idx) => (
                                                    <button 
                                                        key={idx}
                                                        onClick={() => handleDownload(torrent)}
                                                        disabled={downloadingMovieId === selectedMovie.id}
                                                        className="w-full flex items-center justify-between p-4 bg-white/5 border border-white/5 hover:border-netflix-red/50 hover:bg-white/[0.08] rounded-2xl group transition-all"
                                                    >
                                                        <div className="flex flex-col items-start gap-1">
                                                            <span className="text-[11px] font-black text-white text-left truncate max-w-[250px] group-hover:text-netflix-red transition-colors">{torrent.title}</span>
                                                            <div className="flex items-center gap-3 text-[9px] font-bold text-slate-500 uppercase">
                                                                <span className="flex items-center gap-1 text-green-500"><Download size={10} /> {torrent.size}</span>
                                                                <span className="flex items-center gap-1 text-blue-500"><TrendingUp size={10} /> {torrent.seeds} semillas</span>
                                                                <span className="px-1.5 py-0.5 bg-white/5 rounded-md">{torrent.provider}</span>
                                                            </div>
                                                        </div>
                                                        <div className="p-3 bg-white/5 group-hover:bg-netflix-red rounded-xl text-white transition-all">
                                                            <Plus size={18} />
                                                        </div>
                                                    </button>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}

function MovieCard({ movie, onClick }) {
    return (
        <motion.div 
            whileHover={{ scale: 1.05, y: -8 }}
            onClick={onClick}
            className="flex-none w-full group cursor-pointer"
        >
            <div className="relative aspect-[2/3] rounded-[1.5rem] md:rounded-[2rem] overflow-hidden shadow-2xl transition-all duration-500 border border-white/5 group-hover:border-netflix-red/50">
                <img 
                    src={movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : 'https://via.placeholder.com/500x750?text=Sin+Poster'} 
                    alt={movie.title}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                    loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-5">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="px-2 py-0.5 bg-netflix-red text-[8px] font-black uppercase rounded-full text-white">TMDB</span>
                        <div className="flex items-center gap-1">
                            <Star className="text-yellow-500" size={10} fill="currentColor" />
                            <span className="text-[10px] font-black text-white">{movie.vote_average?.toFixed(1)}</span>
                        </div>
                    </div>
                    <h3 className="text-sm font-black text-white leading-tight mb-1 truncate">{movie.title}</h3>
                    <p className="text-[10px] font-bold text-white/60 mb-2">{movie.release_date?.substring(0, 4)}</p>
                    <button className="w-full py-2.5 bg-white text-black text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-netflix-red hover:text-white transition-colors">
                        Ver Detalles
                    </button>
                </div>
            </div>
        </motion.div>
    );
}

function GlobalResultCard({ result, onDownload, isAdmin, isDownloading }) {
    return (
        <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white/5 border border-white/10 rounded-2xl md:rounded-3xl p-4 md:p-6 flex flex-col justify-between hover:bg-white/[0.08] transition-all group"
        >
            <div className="mb-4 md:mb-6">
                <div className="flex items-center gap-2 mb-2 md:mb-3">
                    <span className="px-2 py-0.5 bg-cyan-500/10 text-cyan-400 text-[7px] md:text-[8px] font-black uppercase rounded-md border border-cyan-500/20">{result.provider}</span>
                </div>
                <h3 className="text-xs md:text-sm font-black text-white leading-snug group-hover:text-cyan-400 transition-colors line-clamp-2 mb-3 md:mb-4">{result.title}</h3>
                <div className="flex items-center gap-3 md:gap-4 text-[9px] md:text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                    <span className="flex items-center gap-1.5"><Download size={10} md:size={12} /> {result.size}</span>
                    <span className="flex items-center gap-1.5"><TrendingUp size={10} md:size={12} /> {result.seeds} Seeds</span>
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
        </motion.div>
    );
}

