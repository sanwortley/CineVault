import React, { useState, useEffect } from 'react';
import { Search, TrendingUp, Download, Play, Shield, Loader, Plus, X, Star, Calendar, Clock, Globe } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';

export default function ExplorePage() {
    const { isAdmin } = useAuth();
    const [trending, setTrending] = useState([]);
    const [searchResults, setSearchResults] = useState([]);
    const [query, setQuery] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedMovie, setSelectedMovie] = useState(null);
    const [torrents, setTorrents] = useState([]);
    const [isFetchingTorrents, setIsFetchingTorrents] = useState(false);
    const [downloadingMovieId, setDownloadingMovieId] = useState(null);

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
    }, []);

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!query.trim()) return;
        setIsSearching(true);
        try {
            const data = await api.searchMoviesGlobal(query);
            setSearchResults(data);
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

    const handleDownload = async (torrent) => {
        if (!selectedMovie || !isAdmin()) return;
        
        setDownloadingMovieId(selectedMovie.id);
        try {
            await api.downloadMovie(
                selectedMovie.id, 
                selectedMovie.title || selectedMovie.original_title, 
                torrent.link,
                selectedMovie.release_date?.substring(0, 4)
            );
            alert('¡Descarga iniciada! Puedes ver el progreso en la consola de administración.');
            setSelectedMovie(null);
        } catch (err) {
            alert('Error al iniciar la descarga: ' + err.message);
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
        <div className="p-4 md:p-12 pb-40 max-w-7xl mx-auto animate-fade-in no-drag relative z-10">
            {/* Header & Search */}
            <header className="mb-12">
                <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-12">
                    <div>
                        <h1 className="text-4xl md:text-7xl font-black tracking-tighter text-white mb-2 leading-none">
                            <span className="bg-clip-text text-transparent bg-gradient-to-br from-white via-slate-400 to-slate-600">Explorar</span>
                        </h1>
                        <p className="text-slate-500 text-[10px] md:text-sm font-bold tracking-widest uppercase opacity-60">Descubre y añade nuevas joyas a tu bóveda.</p>
                    </div>

                    <form onSubmit={handleSearch} className="w-full md:w-96 relative group">
                        <input 
                            type="text" 
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Buscar en el catálogo mundial..."
                            className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 pl-12 text-sm text-white focus:outline-none focus:border-netflix-red transition-all group-hover:bg-white/10"
                        />
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-netflix-red transition-colors" size={18} />
                        <button type="submit" className="hidden">Buscar</button>
                    </form>
                </div>
            </header>

            {/* Search Results / Trending */}
            <main>
                {(isSearching || searchResults.length > 0) ? (
                    <section className="mb-20">
                        <div className="flex items-center gap-3 mb-8">
                            <h2 className="text-xl md:text-2xl font-black text-white tracking-tight">Resultados de búsqueda</h2>
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
                            className="bg-[#111] border border-white/10 rounded-[2rem] max-w-5xl w-full max-h-full overflow-hidden flex flex-col md:flex-row relative shadow-2xl"
                        >
                            <button 
                                onClick={() => setSelectedMovie(null)}
                                className="absolute top-6 right-6 p-3 bg-black/50 hover:bg-white/10 rounded-full text-white z-10 transition-colors"
                            >
                                <X size={24} />
                            </button>

                            {/* Poster Side */}
                            <div className="w-full md:w-2/5 aspect-[2/3] md:aspect-auto">
                                <img 
                                    src={selectedMovie.poster_path ? `https://image.tmdb.org/t/p/w780${selectedMovie.poster_path}` : 'https://via.placeholder.com/780x1170?text=Sin+Poster'} 
                                    alt={selectedMovie.title}
                                    className="w-full h-full object-cover"
                                />
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
                                        {isAdmin() ? 'Opciones de Obtención (Dual Audio/HD)' : 'Solo Administradores pueden añadir pelis'}
                                    </h3>

                                    {!isAdmin() ? (
                                        <div className="p-8 border border-white/5 bg-white/[0.02] rounded-3xl text-center">
                                            <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest">No tienes permisos para descargar películas.</p>
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
