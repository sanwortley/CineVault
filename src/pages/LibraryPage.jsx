import React, { useState, useEffect } from 'react';
import { Search, Filter, RefreshCw, FolderOpen, Sparkles } from 'lucide-react';
import MovieCard from '../components/MovieCard';

function LibraryPage({ onPlayMovie }) {
    const [movies, setMovies] = useState([]);
    const [search, setSearch] = useState('');
    const [isScanning, setIsScanning] = useState(false);

    const fetchMovies = async () => {
        if (window.electronAPI) {
            const data = await window.electronAPI.getMovies();
            setMovies(data);
        }
    };

    useEffect(() => {
        fetchMovies();
    }, []);

    const handleRefresh = async () => {
        if (isScanning) return;
        setIsScanning(true);
        try {
            if (window.electronAPI) {
                const data = await window.electronAPI.refreshLibrary();
                setMovies(data);
            }
        } catch (err) {
            console.error('Scan error:', err);
        } finally {
            setIsScanning(false);
        }
    };

    const filteredMovies = movies.filter(m =>
        (m.official_title || m.detected_title || '').toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="p-12 pb-32 max-w-[1700px] mx-auto min-h-full flex flex-col no-drag animate-fade-in relative z-10">
            {/* Header Section */}
            <header className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-12 mb-20 animate-fade-in-up">
                <div>
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-[2px] bg-cyan-500/40 rounded-full"></div>
                        <span className="text-[11px] font-black uppercase tracking-[0.6em] text-cyan-500/90 glow-text">CineVault Discovery</span>
                    </div>
                    <h1 className="text-7xl font-black tracking-tighter text-white mb-6 leading-[0.9] drop-shadow-2xl">Mi Biblioteca</h1>
                    <p className="text-slate-500 text-sm font-bold tracking-widest uppercase opacity-60">Explora tu colección privada con elegancia absoluta.</p>
                </div>

                <div className="flex flex-wrap items-center gap-6 w-full xl:w-auto">
                    <div className="relative flex-1 md:flex-none group">
                        <Search className="absolute left-7 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-cyan-500 transition-all duration-700" size={22} />
                        <input
                            type="text"
                            placeholder="Buscar en la bóveda..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="bg-white/[0.02] border border-white/10 rounded-[2rem] pl-16 pr-8 py-6 w-full md:w-[480px] focus:outline-none focus:ring-4 focus:ring-cyan-500/10 focus:bg-white/[0.04] focus:border-cyan-500/30 transition-all duration-700 placeholder:text-slate-600 font-bold text-sm shadow-2xl"
                        />
                    </div>

                    <button
                        onClick={handleRefresh}
                        disabled={isScanning}
                        className={`flex items-center gap-4 px-10 py-6 bg-cyan-500 text-black font-black rounded-[2rem] hover:scale-[1.03] active:scale-95 transition-all duration-700 shadow-[0_25px_60px_-15px_rgba(6,182,212,0.5)] ${isScanning ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <RefreshCw size={24} strokeWidth={4} className={isScanning ? 'animate-spin' : ''} />
                        <span className="uppercase tracking-[0.2em] text-xs leading-none">{isScanning ? 'Sincronizando' : 'Sincronizar'}</span>
                    </button>

                    <button className="p-6 glass-card rounded-[2rem] group shadow-2xl">
                        <Filter size={26} className="text-slate-400 group-hover:text-cyan-500 transition-all duration-500" />
                    </button>
                </div>
            </header>

            {/* Content Area */}
            {filteredMovies.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center py-32 animate-fade-in">
                    <div className="relative mb-16">
                        <div className="absolute inset-0 bg-cyan-500/10 blur-[140px] rounded-full animate-pulse"></div>
                        <div className="relative glass p-14 rounded-[4rem] border-white/10 shadow-[0_40px_100px_-20px_rgba(0,0,0,0.5)] animate-float">
                            <FolderOpen size={96} strokeWidth={1} className="text-cyan-500 opacity-80" />
                        </div>
                    </div>
                    <h2 className="text-5xl font-black text-white mb-6 tracking-tighter leading-tight drop-shadow-2xl">
                        {search ? 'Bóveda sin registros' : 'Tu Bóveda está cerrada'}
                    </h2>
                    <p className="text-slate-500 max-w-md mb-16 leading-loose font-bold text-xs uppercase tracking-[0.3em] opacity-50">
                        {search
                            ? `No hay entradas que coincidan con "${search}".`
                            : 'Agrega carpetas en ajustes para revelar tu colección cinematográfica personal.'}
                    </p>
                    {!search && (
                        <button
                            onClick={handleRefresh}
                            className="px-14 py-6 glass-card rounded-[2rem] text-white text-[10px] font-black uppercase tracking-[0.4em] hover:border-cyan-500/40 hover:text-cyan-500 transition-all duration-700 shadow-2xl"
                        >
                            Inicializar Escaneo Maestro
                        </button>
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-x-14 gap-y-24 pb-40">
                    {filteredMovies.map((movie, index) => (
                        <div
                            key={movie.id}
                            className="animate-fade-in-up"
                            style={{ animationDelay: `${index * 25}ms` }}
                        >
                            <MovieCard movie={movie} onPlay={onPlayMovie} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default LibraryPage;
