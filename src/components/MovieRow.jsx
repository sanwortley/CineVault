import React, { useRef, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import MovieCard from './MovieCard';

function MovieRow({ title, movies, onPlay, onInfo, myList = [], toggleMyList, userProgress = {}, onHideProgress }) {
    const rowRef = useRef(null);
    const [showLeft, setShowLeft] = useState(false);
    const [showRight, setShowRight] = useState(false);
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

    if (!movies || movies.length === 0) return null;

    const handleScroll = (direction) => {
        if (rowRef.current) {
            const { scrollLeft, clientWidth } = rowRef.current;
            const scrollTo = direction === 'left' 
                ? scrollLeft - clientWidth * 0.8 
                : scrollLeft + clientWidth * 0.8;
            
            rowRef.current.scrollTo({ left: scrollTo, behavior: 'smooth' });
        }
    };

    useEffect(() => {
        const checkScroll = () => {
            if (rowRef.current) {
                const { scrollLeft, scrollWidth, clientWidth } = rowRef.current;
                setShowLeft(scrollLeft > 5);
                setShowRight(scrollLeft < scrollWidth - clientWidth - 10);
            }
        };

        const timeout = setTimeout(checkScroll, 500);
        window.addEventListener('resize', checkScroll);
        return () => {
            window.removeEventListener('resize', checkScroll);
            clearTimeout(timeout);
        };
    }, [movies]);

    const updateArrows = () => {
        const mobile = window.innerWidth < 768;
        setIsMobile(mobile);
        
        if (rowRef.current) {
            const { scrollLeft, scrollWidth, clientWidth } = rowRef.current;
            setShowLeft(scrollLeft > 5);
            setShowRight(scrollLeft < scrollWidth - clientWidth - 10);
        }
    };

    return (
        <div className="mb-12 group/row relative">
            <h2 className="text-2xl font-bold text-white mb-4 px-8 md:px-16 hover:text-white transition-colors">
                {title}
            </h2>
            
            <div className="relative group">
                {/* Left Navigation Button */}
                {showLeft && (
                    <button 
                        onClick={(e) => { e.stopPropagation(); handleScroll('left'); }}
                        className={`absolute left-0 top-0 bottom-0 z-[100] w-12 md:w-20 bg-black/60 hover:bg-black/80 flex items-center justify-center text-white transition-all duration-300 backdrop-blur-sm cursor-pointer border-r border-white/5 ${isMobile ? 'opacity-100 shadow-[4px_0_15px_rgba(0,0,0,0.5)]' : 'opacity-0 group-hover:opacity-100'}`}
                        aria-label="Scroll Left"
                    >
                        <ChevronLeft size={isMobile ? 32 : 48} strokeWidth={3} className="transition-transform active:scale-90" />
                    </button>
                )}

                {/* Scroll Container */}
                <div 
                    ref={rowRef}
                    onScroll={updateArrows}
                    className="flex gap-3 md:gap-4 overflow-x-auto overflow-y-hidden px-8 md:px-16 py-8 no-scrollbar scroll-smooth touch-pan-x"
                >
                    {movies.map((movie) => (
                        <div key={movie.id} className="flex-none w-[120px] sm:w-[150px] md:w-[280px] netflix-hover">
                            <MovieCard 
                                movie={movie} 
                                onPlay={onPlay} 
                                onInfo={onInfo}
                                compact={true}
                                myList={myList}
                                toggleMyList={toggleMyList}
                                userProgress={userProgress}
                                onHideProgress={onHideProgress}
                            />
                        </div>
                    ))}
                </div>

                {/* Right Navigation Button */}
                {showRight && (
                    <button 
                        onClick={(e) => { e.stopPropagation(); handleScroll('right'); }}
                        className={`absolute right-0 top-0 bottom-0 z-[100] w-12 md:w-20 bg-black/60 hover:bg-black/80 flex items-center justify-center text-white transition-all duration-300 backdrop-blur-sm cursor-pointer border-l border-white/5 ${isMobile ? 'opacity-100 shadow-[-4px_0_15px_rgba(0,0,0,0.5)]' : 'opacity-0 group-hover:opacity-100'}`}
                        aria-label="Scroll Right"
                    >
                        <ChevronRight size={isMobile ? 32 : 48} strokeWidth={3} className="transition-transform active:scale-90" />
                    </button>
                )}
            </div>
        </div>
    );
}

export default MovieRow;
