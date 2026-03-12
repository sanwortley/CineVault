import React, { useState, useEffect, useRef } from 'react';
import { FolderOpen, ChevronDown } from 'lucide-react';
import Hero from '../components/Hero';
import MovieRow from '../components/MovieRow';
import MovieCard from '../components/MovieCard';

// Custom Dropdown Component moved outside to prevent re-mounting issues
const SelectField = ({ label, value, options, isOpen, onToggle, onSelect }) => (
    <div className="relative flex flex-col min-w-[160px]">
        <span className="text-[9px] font-black text-slate-500 uppercase px-3 mb-1">{label}</span>
        <div 
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className={`bg-white/10 hover:bg-white/20 transition-all rounded-xl px-4 py-2.5 cursor-pointer flex items-center justify-between text-xs font-bold text-white border ${isOpen ? 'border-netflix-red/50 ring-2 ring-netflix-red/20' : 'border-white/5'}`}
        >
            <span className="truncate pr-2">{value === 'All' ? `Todos` : value}</span>
            <ChevronDown size={14} className={`transition-transform duration-300 text-slate-400 ${isOpen ? 'rotate-180 text-netflix-red' : ''}`} />
        </div>

        {isOpen && (
            <div className="absolute top-[calc(100%+8px)] left-0 right-0 bg-zinc-900/95 backdrop-blur-2xl border border-white/10 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-[100] max-h-64 overflow-y-auto no-scrollbar py-2 animate-in fade-in slide-in-from-top-2 duration-200">
                {options.map(opt => (
                    <div 
                        key={opt}
                        onClick={(e) => { e.stopPropagation(); onSelect(opt); }}
                        className={`px-4 py-2.5 hover:bg-netflix-red hover:text-white transition-colors cursor-pointer text-xs font-semibold ${value === opt ? 'text-netflix-red bg-white/5' : 'text-slate-300'}`}
                    >
                        {opt === 'All' ? `Todos los ${label}s` : opt}
                    </div>
                ))}
            </div>
        )}
    </div>
);

function LibraryPage({ onPlayMovie, onInfoMovie, search = '', myList = [], toggleMyList, viewOnlyList = false }) {
    const [movies, setMovies] = useState([]);
    const [selectedGenre, setSelectedGenre] = useState('All');
    const [selectedYear, setSelectedYear] = useState('All');
    const [isGenreOpen, setIsGenreOpen] = useState(false);
    const [isYearOpen, setIsYearOpen] = useState(false);
    const [featuredMovies, setFeaturedMovies] = useState([]);

    const fetchMovies = async () => {
        if (window.electronAPI) {
            try {
                const data = await window.electronAPI.getMovies();
                setMovies(Array.isArray(data) ? data : []);
            } catch (err) {
                console.error("LibraryPage: Error fetching movies", err);
                setMovies([]);
            }
        }
    };

    useEffect(() => { 
        fetchMovies(); 
        
        const handleLibraryUpdate = () => {
            console.log('[Library] Received library-updated event, fetching latest progress...');
            fetchMovies();
        };
        
        window.addEventListener('library-updated', handleLibraryUpdate);
        return () => window.removeEventListener('library-updated', handleLibraryUpdate);
    }, []);

    // Extract unique genres and years safely
    const allGenres = ['All', ...new Set((movies || []).flatMap(m => (m && m.genres) ? m.genres.split(', ') : []))].sort();
    const allYears = ['All', ...new Set((movies || []).map(m => m?.detected_year).filter(Boolean))].sort((a, b) => b - a);

    // Filter Logic
    const filteredMovies = (viewOnlyList ? myList : movies).filter(m => {
        if (!m) return false;
        const s = (search || '').toLowerCase();
        const matchesSearch = (m.official_title || m.detected_title || '').toLowerCase().includes(s) ||
                             (m.genres || '').toLowerCase().includes(s);
        const matchesGenre = selectedGenre === 'All' || (m.genres && m.genres.includes(selectedGenre));
        const matchesYear = selectedYear === 'All' || m.detected_year?.toString() === selectedYear.toString();
        return matchesSearch && matchesGenre && matchesYear;
    });

    const isFiltering = selectedGenre !== 'All' || selectedYear !== 'All';

    // Top 15 movies by year for 'Novedades'
    const latestMovies = [...filteredMovies]
        .filter(m => m && m.detected_year)
        .sort((a, b) => (b.detected_year || 0) - (a.detected_year || 0))
        .slice(0, 15);
    
    // Featured movies effect (Hero section)
    useEffect(() => {
        if (movies.length > 0 && !viewOnlyList && !isFiltering && search === '') {
            const shuffled = [...movies].sort(() => 0.5 - Math.random());
            setFeaturedMovies(shuffled.slice(0, 3));
        } else {
            setFeaturedMovies([]);
        }
    }, [movies, viewOnlyList, isFiltering, search]);

    const closeDropdowns = () => {
        setIsGenreOpen(false);
        setIsYearOpen(false);
    };

    return (
        <div className="pb-40 min-h-screen bg-netflix-dark animate-fade-in" onClick={closeDropdowns}>
            {/* Hero Carousel - Only on Home Exploration */}
            {!search && !viewOnlyList && !isFiltering && featuredMovies.length > 0 && (
                <Hero 
                    movies={featuredMovies} 
                    onPlay={onPlayMovie} 
                    onInfo={onInfoMovie} 
                    className="relative z-0"
                />
            )}

            {/* Header & Filter Bar */}
            <div className={`px-8 md:px-16 flex flex-col lg:flex-row items-center justify-between gap-12 relative z-50 ${(!search && !viewOnlyList && !isFiltering) ? 'pt-40' : 'pt-48'}`}>
                <div className="flex-shrink-0">
                    <h2 className="text-5xl font-black text-white tracking-tighter uppercase italic drop-shadow-2xl">
                        {viewOnlyList ? 'Mi ' : (isFiltering ? 'Resultados ' : 'Explorar ')}
                        <span className="text-netflix-red underline decoration-8 underline-offset-8">
                            {viewOnlyList ? 'Lista' : (isFiltering ? 'Filtrados' : 'Bóveda')}
                        </span>
                    </h2>
                </div>

                {!viewOnlyList && (
                    <div className="flex items-center gap-6 bg-white/5 p-4 rounded-3xl backdrop-blur-3xl border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.3)]" onClick={e => e.stopPropagation()}>
                        <SelectField 
                            label="Género"
                            value={selectedGenre}
                            options={allGenres}
                            isOpen={isGenreOpen}
                            onToggle={() => { setIsGenreOpen(!isGenreOpen); setIsYearOpen(false); }}
                            onSelect={(v) => { setSelectedGenre(v); setIsGenreOpen(false); }}
                        />
                        <div className="w-[1px] h-12 bg-white/10 self-end mb-1"></div>
                        <SelectField 
                            label="Año"
                            value={selectedYear}
                            options={allYears}
                            isOpen={isYearOpen}
                            onToggle={() => { setIsYearOpen(!isYearOpen); setIsGenreOpen(false); }}
                            onSelect={(v) => { setSelectedYear(v); setIsYearOpen(false); }}
                        />
                        
                        {(isFiltering || search !== '') && (
                            <button 
                                onClick={(e) => { e.stopPropagation(); setSelectedGenre('All'); setSelectedYear('All'); }}
                                className="ml-4 px-8 py-3 bg-netflix-red text-white text-[11px] font-black uppercase rounded-2xl hover:bg-white hover:text-Netflix-red hover:shadow-netflix-red/50 transition-all shadow-xl active:scale-95"
                            >
                                Limpiar
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Content Area Rendering Logic */}
            <div className="relative z-10 mt-16 pb-20">
                {filteredMovies.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-48 text-center animate-fade-in">
                        <FolderOpen size={80} className="text-netflix-red/20 mb-6" />
                        <h2 className="text-4xl font-black text-white mb-4 tracking-tighter uppercase whitespace-pre-line">
                            {viewOnlyList ? 'Aún no has guardado\nningún título' : 'Bóveda sin resultados'}
                        </h2>
                        <p className="text-slate-500 max-w-sm uppercase text-[10px] font-black tracking-widest leading-loose">
                            {viewOnlyList ? 'Explora y añade películas con el botón (+)' : 'Prueba ajustando tus filtros o busca por título.'}
                        </p>
                    </div>
                ) : (
                    <>
                        {/* CONTINUE WATCHING SECTION - Only on Home, not filtering, not search */}
                        {!viewOnlyList && !isFiltering && search === '' && (
                            () => {
                                const continueWatching = movies
                                    .filter(m => m.watched_duration && m.watched_duration > 10) // More than 10s watched
                                    .sort((a, b) => new Date(b.last_watched_at) - new Date(a.last_watched_at))
                                    .slice(0, 10);
                                
                                if (continueWatching.length === 0) return null;

                                return (
                                    <div className="mb-20">
                                        <MovieRow 
                                            title="Continuar Viendo" 
                                            movies={continueWatching} 
                                            onPlay={onPlayMovie} 
                                            onInfo={onInfoMovie}
                                            myList={myList}
                                            toggleMyList={toggleMyList}
                                        />
                                    </div>
                                );
                            }
                        )()}

                        {/* UNIFIED GRID MODE: All movies, Search, Filters, or MyList */}
                        <div className="px-8 md:px-16 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-8 animate-fade-in">
                            {filteredMovies.map(movie => movie && (
                                <MovieCard 
                                    key={movie.id || Math.random()}
                                    movie={movie}
                                    onPlay={onPlayMovie}
                                    onInfo={onInfoMovie}
                                    myList={myList}
                                    toggleMyList={toggleMyList}
                                />
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default LibraryPage;
