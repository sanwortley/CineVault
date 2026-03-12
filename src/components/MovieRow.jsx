import React, { useRef, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import MovieCard from './MovieCard';

function MovieRow({ title, movies, onPlay, onInfo, myList = [], toggleMyList }) {
    const rowRef = useRef(null);
    const [showLeft, setShowLeft] = useState(false);
    const [showRight, setShowRight] = useState(true);

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

    const updateArrows = () => {
        if (rowRef.current) {
            const { scrollLeft, scrollWidth, clientWidth } = rowRef.current;
            setShowLeft(scrollLeft > 0);
            setShowRight(scrollLeft < scrollWidth - clientWidth - 5);
        }
    };

    useEffect(() => {
        updateArrows();
        // Add event listener for window resize to update arrows correctly
        window.addEventListener('resize', updateArrows);
        return () => window.removeEventListener('resize', updateArrows);
    }, [movies]);

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
                        className="absolute left-0 top-0 bottom-0 z-[100] w-12 md:w-20 bg-black/40 hover:bg-black/70 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all duration-300 backdrop-blur-md cursor-pointer"
                        aria-label="Scroll Left"
                    >
                        <ChevronLeft size={48} strokeWidth={3} className="transition-transform active:scale-90" />
                    </button>
                )}

                {/* Scroll Container */}
                <div 
                    ref={rowRef}
                    onScroll={updateArrows}
                    className="flex gap-4 overflow-x-auto overflow-y-hidden px-8 md:px-16 py-8 no-scrollbar scroll-smooth"
                >
                    {movies.map((movie) => (
                        <div key={movie.id} className="flex-none w-[280px] md:w-[320px] netflix-hover">
                            <MovieCard 
                                movie={movie} 
                                onPlay={onPlay} 
                                onInfo={onInfo}
                                compact={true}
                                myList={myList}
                                toggleMyList={toggleMyList}
                            />
                        </div>
                    ))}
                </div>

                {/* Right Navigation Button */}
                {showRight && (
                    <button 
                        onClick={(e) => { e.stopPropagation(); handleScroll('right'); }}
                        className="absolute right-0 top-0 bottom-0 z-[100] w-12 md:w-20 bg-black/40 hover:bg-black/70 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all duration-300 backdrop-blur-md cursor-pointer"
                        aria-label="Scroll Right"
                    >
                        <ChevronRight size={48} strokeWidth={3} className="transition-transform active:scale-90" />
                    </button>
                )}
            </div>
        </div>
    );
}

export default MovieRow;
