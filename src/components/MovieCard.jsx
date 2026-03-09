import React from 'react';
import { Play, Star, Calendar, Music } from 'lucide-react';

function MovieCard({ movie, onPlay }) {
    const {
        official_title,
        detected_title,
        poster_url,
        detected_year,
        rating,
        genres,
        file_path
    } = movie;

    const title = official_title || detected_title;

    const handlePlay = (e) => {
        e.stopPropagation();
        if (onPlay) {
            onPlay(movie);
        } else if (window.electronAPI && file_path) {
            window.electronAPI.playVideo(file_path);
        }
    };

    return (
        <div
            className="group relative cursor-pointer no-drag"
            onClick={handlePlay}
        >
            {/* Poster Container */}
            <div className="aspect-[2/3] relative rounded-3xl overflow-hidden glass-card shadow-2xl">
                {poster_url ? (
                    <img
                        src={poster_url}
                        alt={title}
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000 ease-in-out"
                    />
                ) : (
                    <div className="w-full h-full bg-[#0f172a] flex flex-col items-center justify-center p-8 text-center">
                        <Music size={48} strokeWidth={1.5} className="text-slate-700 mb-6" />
                        <span className="text-[10px] uppercase font-black tracking-widest text-slate-500 leading-relaxed">{title}</span>
                    </div>
                )}

                {/* Gradient Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-transparent to-transparent opacity-80 group-hover:opacity-60 transition-opacity duration-500"></div>

                {/* Hover Play Button */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-700">
                    <div className="w-20 h-20 bg-cyan-500 text-black rounded-full flex items-center justify-center shadow-[0_0_50px_rgba(6,182,212,0.4)] scale-50 group-hover:scale-100 transition-all duration-500">
                        <Play fill="currentColor" size={32} className="translate-x-1" />
                    </div>
                </div>

                {/* Top Badges */}
                <div className="absolute top-4 left-4 flex flex-wrap gap-2">
                    {rating && (
                        <div className="px-3 py-1.5 bg-black/60 backdrop-blur-xl border border-white/10 rounded-xl flex items-center gap-2 text-[10px] font-black text-white shadow-2xl">
                            <Star size={12} className="text-cyan-500" fill="currentColor" />
                            <span>{rating.toFixed(1)}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Info Section */}
            <div className="mt-5 px-2">
                <h3 className="font-extrabold text-sm text-slate-100 line-clamp-1 group-hover:text-cyan-500 transition-colors duration-500 tracking-tight">
                    {title}
                </h3>
                <div className="flex items-center gap-4 mt-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                    <span className="flex items-center gap-1.5">
                        <Calendar size={12} strokeWidth={3} className="text-slate-600" />
                        {detected_year || '---'}
                    </span>
                    <span className="w-1 h-1 bg-slate-800 rounded-full"></span>
                    <span className="line-clamp-1">
                        {genres ? genres.split(',')[0] : 'Cine'}
                    </span>
                </div>
            </div>
        </div>
    );
}

export default MovieCard;
