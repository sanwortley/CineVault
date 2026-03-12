import React, { useState, useEffect } from 'react';
import { Play, Star, Calendar, Music, Cloud, Info, Plus, Check } from 'lucide-react';

function MovieCard({ movie, onPlay, onInfo, compact = false, myList = [], toggleMyList }) {
    const {
        official_title,
        detected_title,
        poster_url,
        detected_year,
        rating,
        genres,
        file_path,
        drive_file_id,
        id
    } = movie;

    const title = official_title || detected_title;
    
    // Upload State
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);

    // Listen to real-time progress events from the backend
    useEffect(() => {
        if (!window.electronAPI || !id) return;
        
        const unsubscribe = window.electronAPI.onDriveUploadProgress(id, (data) => {
            setUploadProgress(data.progress);
        });
        return unsubscribe;
    }, [id]);

    const handleUpload = async (e) => {
        e.stopPropagation();
        if (!window.electronAPI || !file_path || !id) return;
        const ext = file_path.split('.').pop().toLowerCase();
        const mimeType = { 'mp4': 'video/mp4', 'mkv': 'video/x-matroska', 'webm': 'video/webm' }[ext] || 'video/mp4';
        setIsUploading(true);
        setUploadProgress(0);
        try {
            const result = await window.electronAPI.uploadMovieToDrive(id, file_path, mimeType);
            if (result.success) alert(`Película subida exitosamente!`);
            else alert(`Error: ${result.error}`);
        } catch (error) {
            alert(`Surgió un problema: ${error.message}`);
        } finally {
            setIsUploading(false);
        }
    };

    const handlePlay = (e) => {
        e.stopPropagation();
        onPlay ? onPlay(movie) : (window.electronAPI && file_path && window.electronAPI.playVideo(file_path));
    };

    const isAdded = myList.some(m => m.id === id);

    return (
        <div className={`relative group/card cursor-pointer ${compact ? 'max-w-[280px] md:max-w-[320px] w-full' : 'w-full'}`}>
            {/* Poster Container */}
            <div 
                className="relative aspect-[2/3] overflow-hidden rounded-[0.5rem] border border-white/5 shadow-2xl transition-all duration-300 group-hover/card:ring-2 ring-netflix-red/50"
                onClick={() => onInfo(movie)}
            >
                {poster_url ? (
                    <img
                        src={poster_url}
                        alt={title}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover/card:scale-110"
                        loading="lazy"
                    />
                ) : (
                    <div className="w-full h-full bg-netflix-black flex flex-col items-center justify-center p-8 text-center text-slate-700">
                        <span className="text-[9px] uppercase font-black tracking-widest">{title}</span>
                    </div>
                )}

                {/* Status Badges */}
                <div className="absolute top-3 right-3 flex flex-col gap-2 z-20">
                    {rating && (
                        <div className="px-1.5 py-0.5 bg-black/80 rounded text-[9px] font-black text-white border border-white/10 flex items-center gap-1">
                            <Star size={10} fill="currentColor" className="text-netflix-red" />
                            <span>{rating.toFixed(1)}</span>
                        </div>
                    )}
                    {drive_file_id && (
                        <div className="p-1 bg-green-500/20 backdrop-blur-md rounded border border-green-500/30 text-green-400">
                            <Cloud size={10} strokeWidth={3} />
                        </div>
                    )}
                </div>

                {/* Hover Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent opacity-0 group-hover/card:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-5 z-10">
                    <div className="flex items-center gap-3 mb-4">
                        <button 
                            onClick={handlePlay}
                            className="p-2.5 bg-white text-black rounded-full hover:bg-white/80 transition-transform active:scale-95 shadow-xl"
                        >
                            <Play size={18} fill="currentColor" />
                        </button>
                        
                        <button 
                            onClick={(e) => { e.stopPropagation(); toggleMyList(movie); }}
                            className={`p-2.5 rounded-full transition-all active:scale-95 border border-white/20 ${isAdded ? 'bg-netflix-red text-white' : 'bg-netflix-black/80 text-white hover:bg-zinc-800'}`}
                            title={isAdded ? "Quitar de Mi Lista" : "Añadir a Mi Lista"}
                        >
                            {isAdded ? <Check size={18} strokeWidth={3} /> : <Plus size={18} strokeWidth={3} />}
                        </button>

                        <button 
                            onClick={(e) => { e.stopPropagation(); onInfo(movie); }}
                            className="p-2.5 bg-netflix-black/80 text-white rounded-full hover:bg-zinc-800 transition-transform active:scale-95 border border-white/20"
                        >
                            <Info size={18} />
                        </button>
                        
                        {!drive_file_id && (
                            <button 
                                onClick={handleUpload}
                                disabled={isUploading}
                                className={`ml-auto p-2 bg-black/40 text-white rounded-full border border-white/10 ${isUploading ? 'animate-pulse text-netflix-red' : 'hover:text-netflix-red'}`}
                            >
                                <Cloud size={16} />
                            </button>
                        )}
                    </div>
                    
                    <div className="flex items-center gap-2 text-[10px] font-bold text-white mb-1">
                        <span className="text-green-500">98% para ti</span>
                        <span className="border border-white/40 px-1 rounded-[1px] text-[8px]">16+</span>
                        <span>{detected_year}</span>
                    </div>

                    {isUploading && (
                        <div className="mt-2 h-1 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-netflix-red transition-all" style={{ width: `${uploadProgress}%` }}></div>
                        </div>
                    )}
                </div>

                {/* Watch Progress Bar */}
                {movie.watched_duration > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 h-2 bg-black/60 z-50 rounded-b-[0.5rem] overflow-hidden">
                        <div 
                            className="h-full bg-netflix-red shadow-[0_0_15px_rgba(229,9,20,1)]" 
                            style={{ width: `${Math.min(100, (movie.watched_duration / ((movie.runtime > 0 ? movie.runtime : 120) * 60)) * 100)}%` }}
                        ></div>
                    </div>
                )}
            </div>

            {/* Title - Contextual */}
            {!compact && (
                <div className="mt-3 px-1">
                    <h3 className="text-sm font-bold text-slate-400 group-hover/card:text-white transition-colors truncate">
                        {title}
                    </h3>
                </div>
            )}
        </div>
    );
}

export default MovieCard;
