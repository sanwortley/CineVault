import React, { useState, useEffect } from 'react';
import { Play, Info, ChevronLeft, ChevronRight } from 'lucide-react';

function Hero({ movies, onPlay, onInfo }) {
    const [currentIndex, setCurrentIndex] = useState(0);

    useEffect(() => {
        if (!movies || movies.length <= 1) return;
        
        const interval = setInterval(() => {
            setCurrentIndex((prev) => (prev + 1) % movies.length);
        }, 8000); // Auto-advance every 8 seconds

        return () => clearInterval(interval);
    }, [movies]);

    if (!movies || movies.length === 0) return null;
    const movie = movies[currentIndex];

    const nextSlide = () => setCurrentIndex((prev) => (prev + 1) % movies.length);
    const prevSlide = () => setCurrentIndex((prev) => (prev - 1 + movies.length) % movies.length);

    return (
        <div className="relative h-[90vh] w-full overflow-hidden bg-black">
            {/* Carousel Items */}
            <div className="absolute inset-0 transition-opacity duration-1000 ease-in-out">
                {/* Background Image / Backdrop */}
                <div className="absolute inset-0 animate-fade-in">
                    <img 
                        key={movie.id}
                        src={movie.backdrop_url || movie.poster_url} 
                        alt={movie.official_title}
                        className="w-full h-full object-cover transition-transform duration-[10s] scale-105 animate-ken-burns"
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-black via-black/40 to-transparent"></div>
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent"></div>
                </div>

                {/* Content */}
                <div className="relative h-full flex flex-col justify-end px-8 md:px-16 pb-32 z-10 max-w-3xl">
                    <h1 className="text-6xl md:text-7xl font-black tracking-tighter mb-6 drop-shadow-2xl animate-fade-in-up">
                        {movie.official_title || movie.detected_title}
                    </h1>
                    
                    <div className="flex items-center gap-4 mb-6 text-sm font-bold opacity-0 animate-fade-in-up [animation-delay:200ms] [animation-fill-mode:forwards]">
                        <span className="text-green-500">{movie.rating ? (movie.rating * 10).toFixed(0) : '98'}% Coincidencia</span>
                        <span className="text-white">{movie.detected_year}</span>
                        <span className="border border-white/40 px-1 text-[10px] rounded">16+</span>
                        <span className="text-white">{movie.runtime ? `${movie.runtime}m` : '2h 14m'}</span>
                    </div>

                    <p className="text-lg font-medium text-slate-300 mb-10 line-clamp-3 drop-shadow-lg leading-relaxed opacity-0 animate-fade-in-up [animation-delay:400ms] [animation-fill-mode:forwards]">
                        {movie.summary || "Explora esta obra maestra cinematográfica en tu bóveda personal."}
                    </p>

                    <div className="flex items-center gap-4 opacity-0 animate-fade-in-up [animation-delay:600ms] [animation-fill-mode:forwards]">
                        <button 
                            onClick={() => onPlay(movie)}
                            className="flex items-center gap-2 px-8 py-3 bg-white text-black rounded font-bold hover:bg-white/80 transition-all active:scale-95"
                        >
                            <Play size={24} fill="black" />
                            <span className="text-lg">Reproducir</span>
                        </button>
                        <button 
                            onClick={() => onInfo(movie)}
                            className="flex items-center gap-2 px-8 py-3 bg-slate-500/50 text-white rounded font-bold hover:bg-slate-500/70 transition-all active:scale-95 backdrop-blur-md"
                        >
                            <Info size={24} />
                            <span className="text-lg">Más información</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Controls */}
            {movies.length > 1 && (
                <>
                    <button 
                        onClick={prevSlide}
                        className="absolute left-4 top-1/2 -translate-y-1/2 z-30 p-2 text-white/50 hover:text-white transition-colors"
                    >
                        <ChevronLeft size={48} />
                    </button>
                    <button 
                        onClick={nextSlide}
                        className="absolute right-4 top-1/2 -translate-y-1/2 z-30 p-2 text-white/50 hover:text-white transition-colors"
                    >
                        <ChevronRight size={48} />
                    </button>
                </>
            )}

            {/* Pagination Indicators */}
            <div className="absolute bottom-10 right-16 flex gap-2 z-30">
                {movies.map((_, i) => (
                    <div 
                        key={i}
                        className={`h-1 transition-all duration-300 rounded-full ${i === currentIndex ? 'w-8 bg-netflix-red' : 'w-4 bg-white/30'}`}
                    />
                ))}
            </div>
        </div>
    );
}

export default Hero;
