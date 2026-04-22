import React, { useState, useEffect, useRef } from 'react';
import { FolderOpen, ChevronDown } from 'lucide-react';
import Hero from '../components/Hero';
import MovieRow from '../components/MovieRow';
import MovieCard from '../components/MovieCard';
import { api } from '../api';
import { groupMoviesByTitle } from '../utils/movieUtils';

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

function LibraryPage({ 
    movies = [], 
    isLoading = false,
    onPlayMovie, 
    onInfoMovie, 
    search = '', 
    myList = [], 
    toggleMyList, 
    viewOnlyList = false, 
    userProgress = {},
    onHideProgress
}) {
    const [continueSort, setContinueSort] = useState('Recientes');
    const [isContinueSortOpen, setIsContinueSortOpen] = useState(false);

    // Filters & Sorting state
    const [selectedGenre, setSelectedGenre] = useState('All');
    const [selectedYear, setSelectedYear] = useState('All');
    const [selectedSort, setSelectedSort] = useState('Recientes');
    
    // UI state for dropdowns
    const [isGenreOpen, setIsGenreOpen] = useState(false);
    const [isYearOpen, setIsYearOpen] = useState(false);
    const [isSortOpen, setIsSortOpen] = useState(false);

    const [featuredMovies, setFeaturedMovies] = useState([]);

    // Group duplicates before any sorting or filtering
    const groupedMoviesRaw = React.useMemo(() => groupMoviesByTitle(movies || []), [movies]);

    // Extract unique genres and years safely
    const allGenres = ['All', ...new Set((groupedMoviesRaw || []).flatMap(m => (m && m.genres) ? m.genres.split(', ') : []))].sort();
    const allYears = ['All', ...new Set((groupedMoviesRaw || []).map(m => m?.detected_year).filter(Boolean))].sort((a, b) => b - a);

    // Filter Logic
    const filteredMovies = (viewOnlyList ? myList : groupedMoviesRaw).filter(m => {
        if (!m) return false;
        const s = (search || '').toLowerCase();
        const matchesSearch = (m.official_title || m.detected_title || '').toLowerCase().includes(s) ||
                             (m.genres || '').toLowerCase().includes(s);
        const matchesGenre = selectedGenre === 'All' || (m.genres && m.genres.includes(selectedGenre));
        const matchesYear = selectedYear === 'All' || m.detected_year?.toString() === selectedYear.toString();
        return matchesSearch && matchesGenre && matchesYear;
    });

    const sortedMovies = [...filteredMovies].sort((a, b) => {
        if (selectedSort === 'A-Z') {
            const titleA = (a.official_title || a.detected_title || a.file_name || '').toLowerCase();
            const titleB = (b.official_title || b.detected_title || b.file_name || '').toLowerCase();
            return titleA.localeCompare(titleB);
        }
        if (selectedSort === 'Z-A') {
            const titleA = (a.official_title || a.detected_title || a.file_name || '').toLowerCase();
            const titleB = (b.official_title || b.detected_title || b.file_name || '').toLowerCase();
            return titleB.localeCompare(titleA);
        }
        // Default: Recientes (assume backend already sorted by created_at.desc or preserve original order)
        return 0;
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
        setIsSortOpen(false);
    };

    return (
        <div className="pb-40 min-h-screen bg-netflix-dark animate-fade-in" onClick={closeDropdowns}>
            {/* Hero Carousel - Only on Home Exploration */}
            <div className={`transition-all duration-700 ${(!search && !viewOnlyList && !isFiltering && featuredMovies.length > 0) ? 'relative pt-0' : 'pt-24 md:pt-32'}`}>
                {!search && !viewOnlyList && !isFiltering && featuredMovies.length > 0 && (
                    <Hero 
                        movies={featuredMovies} 
                        onPlay={onPlayMovie} 
                        onInfo={onInfoMovie} 
                        className="relative z-0"
                    />
                )}
            </div>

            {/* Header & Filter Bar */}
            <div className={`px-4 md:px-16 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 md:gap-12 relative z-50 transform-gpu isolate ${(!search && !viewOnlyList && !isFiltering) ? 'pt-24 md:pt-40' : 'pt-32 md:pt-48'}`}>
                <div className="flex-shrink-0">
                    <h2 className="text-3xl md:text-5xl font-black text-white tracking-tighter uppercase italic drop-shadow-2xl">
                        {viewOnlyList ? 'Mi ' : (isFiltering ? 'Resultados ' : 'Explorar ')}
                        <span className="text-netflix-red underline decoration-4 md:decoration-8 underline-offset-4 md:underline-offset-8">
                            {viewOnlyList ? 'Lista' : (isFiltering ? 'Filtrados' : 'Bóveda')}
                        </span>
                    </h2>
                </div>

                {!viewOnlyList && (
                    <div className="flex flex-wrap items-center gap-3 md:gap-6 bg-white/5 p-3 md:p-4 rounded-2xl md:rounded-3xl backdrop-blur-3xl border border-white/10 shadow-2xl w-full lg:w-auto" onClick={e => e.stopPropagation()}>
                        <div className="flex-1 min-w-[120px]">
                            <SelectField 
                                label="Género"
                                value={selectedGenre}
                                options={allGenres}
                                isOpen={isGenreOpen}
                                onToggle={() => { setIsGenreOpen(!isGenreOpen); setIsYearOpen(false); setIsSortOpen(false); }}
                                onSelect={(v) => { setSelectedGenre(v); setIsGenreOpen(false); }}
                            />
                        </div>
                        <div className="hidden sm:block w-[1px] h-8 bg-white/10 self-center"></div>
                        <div className="flex-1 min-w-[120px]">
                            <SelectField 
                                label="Año"
                                value={selectedYear}
                                options={allYears}
                                isOpen={isYearOpen}
                                onToggle={() => { setIsYearOpen(!isYearOpen); setIsGenreOpen(false); setIsSortOpen(false); }}
                                onSelect={(v) => { setSelectedYear(v); setIsYearOpen(false); }}
                            />
                        </div>
                        <div className="hidden sm:block w-[1px] h-8 bg-white/10 self-center"></div>
                        <div className="flex-1 min-w-[120px]">
                            <SelectField 
                                label="Orden"
                                value={selectedSort}
                                options={['A-Z', 'Z-A', 'Recientes']}
                                isOpen={isSortOpen}
                                onToggle={() => { setIsSortOpen(!isSortOpen); setIsGenreOpen(false); setIsYearOpen(false); }}
                                onSelect={(v) => { setSelectedSort(v); setIsSortOpen(false); }}
                            />
                        </div>
                        
                        {(isFiltering || search !== '' || selectedSort !== 'A-Z') && (
                            <button 
                                onClick={(e) => { e.stopPropagation(); setSelectedGenre('All'); setSelectedYear('All'); setSelectedSort('A-Z'); }}
                                className="w-full sm:w-auto px-6 py-2 bg-netflix-red text-white text-[10px] font-black uppercase rounded-xl hover:bg-white hover:text-netflix-red transition-all shadow-xl active:scale-95"
                            >
                                Limpiar
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Content Area Rendering Logic */}
            <div className="relative z-10 mt-16 pb-20">
                {isLoading && movies.length === 0 ? (
                    <div className="min-h-screen bg-black flex items-center justify-center animate-in fade-in duration-500">
                        <div className="flex flex-col items-center gap-6">
                            <img src="./assets/logo.png" alt="CineVault" className="h-16 w-auto animate-pulse" />
                            <div className="w-48 h-1 bg-white/10 rounded-full overflow-hidden">
                                <div className="w-1/2 h-full bg-netflix-red animate-loading-bar"></div>
                            </div>
                            <span className="text-white/40 text-[10px] uppercase font-black tracking-widest animate-pulse">Cargando Bóveda...</span>
                        </div>
                    </div>
                ) : sortedMovies.length === 0 ? (
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
                                    .filter(m => {
                                        const progObj = userProgress[String(m.id)];
                                        if (!progObj || progObj.isHidden) return false;
                                        return progObj.duration > 10; 
                                    })
                                    .sort((a, b) => {
                                        const progA = userProgress[String(a.id)];
                                        const progB = userProgress[String(b.id)];
                                        
                                        if (continueSort === 'Mayor Progreso') {
                                            const percA = progA.duration / ((a.runtime || 120) * 60);
                                            const percB = progB.duration / ((b.runtime || 120) * 60);
                                            return percB - percA;
                                        }
                                        if (continueSort === 'Menor Progreso') {
                                            const percA = progA.duration / ((a.runtime || 120) * 60);
                                            const percB = progB.duration / ((b.runtime || 120) * 60);
                                            return percA - percB;
                                        }
                                        // Default: Recientes
                                        return new Date(progB.updatedAt) - new Date(progA.updatedAt);
                                    })
                                    .slice(0, 15);
                                
                                if (continueWatching.length === 0) return null;

                                return (
                                    <div className="mb-20">
                                        <div className="px-8 md:px-16 flex items-center justify-between mb-4">
                                            <h2 className="text-2xl font-bold text-white tracking-tight">Continuar Viendo</h2>
                                            <div className="relative">
                                                <button 
                                                    onClick={() => setIsContinueSortOpen(!isContinueSortOpen)}
                                                    className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white transition-all border border-white/5"
                                                >
                                                    <span>Orden: {continueSort}</span>
                                                    <ChevronDown size={12} className={isContinueSortOpen ? 'rotate-180' : ''} />
                                                </button>
                                                {isContinueSortOpen && (
                                                    <div className="absolute top-full right-0 mt-2 w-40 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden z-[110] animate-in fade-in slide-in-from-top-2">
                                                        {['Recientes', 'Mayor Progreso', 'Menor Progreso'].map(opt => (
                                                            <button 
                                                                key={opt}
                                                                onClick={() => { setContinueSort(opt); setIsContinueSortOpen(false); }}
                                                                className={`w-full px-4 py-2 text-left text-[10px] font-bold uppercase tracking-widest hover:bg-netflix-red hover:text-white transition-colors ${continueSort === opt ? 'text-netflix-red' : 'text-slate-400'}`}
                                                            >
                                                                {opt}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <MovieRow 
                                            title="" // Title is now outside for better control
                                            movies={continueWatching} 
                                            onPlay={onPlayMovie} 
                                            onInfo={onInfoMovie}
                                            myList={myList}
                                            toggleMyList={toggleMyList}
                                            userProgress={userProgress}
                                            onHideProgress={onHideProgress}
                                        />
                                    </div>
                                );
                            }
                        )()}

                        <div className="px-4 md:px-16 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3 md:gap-8 animate-fade-in">
                            {sortedMovies.map(movie => movie && (
                                <MovieCard 
                                    key={movie.id || Math.random()}
                                    movie={movie}
                                    onPlay={onPlayMovie}
                                    onInfo={onInfoMovie}
                                    myList={myList}
                                    toggleMyList={toggleMyList}
                                    userProgress={userProgress}
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
