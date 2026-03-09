import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, X, SkipForward, SkipBack, Loader2 } from 'lucide-react';

function VideoPlayer({ movie, onClose }) {
    const videoRef = useRef(null);
    const containerRef = useRef(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const controlsTimeoutRef = useRef(null);

    const videoUrl = `cine://${movie.file_path}`;

    const handleVideoError = (e) => {
        console.error('Video Error:', e);
        setIsLoading(false);
        if (movie.file_size === 1) { // 1 byte from echo $null
            setError('Este es un archivo de prueba vacío (0 KB). No contiene datos de video para reproducir.');
        } else {
            setError('Error al cargar el video. El formato podría no ser compatible o el archivo está dañado.');
        }
    };

    useEffect(() => {
        const handleMouseMove = () => {
            setShowControls(true);
            clearTimeout(controlsTimeoutRef.current);
            controlsTimeoutRef.current = setTimeout(() => {
                if (isPlaying) setShowControls(false);
            }, 3000);
        };

        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, [isPlaying]);

    const togglePlay = () => {
        if (videoRef.current.paused) {
            videoRef.current.play();
            setIsPlaying(true);
        } else {
            videoRef.current.pause();
            setIsPlaying(false);
        }
    };

    const handleTimeUpdate = () => {
        setCurrentTime(videoRef.current.currentTime);
    };

    const handleLoadedMetadata = () => {
        setDuration(videoRef.current.duration);
        setIsLoading(false);
    };

    const handleSeek = (e) => {
        const time = Number(e.target.value);
        videoRef.current.currentTime = time;
        setCurrentTime(time);
    };

    const handleVolumeChange = (e) => {
        const val = Number(e.target.value);
        setVolume(val);
        videoRef.current.volume = val;
        setIsMuted(val === 0);
    };

    const toggleMute = () => {
        const newMute = !isMuted;
        setIsMuted(newMute);
        videoRef.current.volume = newMute ? 0 : volume;
    };

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            containerRef.current.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    };

    const formatTime = (time) => {
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    };

    return (
        <div
            ref={containerRef}
            className="fixed inset-0 z-[100] bg-black flex items-center justify-center overflow-hidden animate-fade-in"
        >
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/60 backdrop-blur-sm">
                    <Loader2 className="text-cyan-500 animate-spin" size={64} strokeWidth={1} />
                </div>
            )}

            <video
                ref={videoRef}
                src={videoUrl}
                className="w-full h-full object-contain"
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onClick={togglePlay}
                onWaiting={() => setIsLoading(true)}
                onPlaying={() => setIsLoading(false)}
                onError={handleVideoError}
            />

            {error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center z-50 bg-black/80 backdrop-blur-md p-12 text-center">
                    <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mb-8">
                        <X className="text-red-500" size={40} />
                    </div>
                    <h2 className="text-2xl font-black text-white mb-4 uppercase tracking-tighter">No se puede reproducir</h2>
                    <p className="text-slate-400 max-w-md font-bold text-sm leading-relaxed">{error}</p>
                    <button
                        onClick={onClose}
                        className="mt-12 px-10 py-4 glass-card rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] hover:text-red-500 transition-all"
                    >
                        Cerrar Reproductor
                    </button>
                </div>
            )}

            {/* Close Button */}
            <button
                onClick={onClose}
                className={`absolute top-8 right-8 p-4 glass-card rounded-full text-white/40 hover:text-white hover:bg-red-500/20 transition-all duration-500 z-[110] ${showControls ? 'opacity-100' : 'opacity-0'}`}
            >
                <X size={24} />
            </button>

            {/* Controls Overlay */}
            <div className={`absolute inset-x-0 bottom-0 p-12 bg-gradient-to-t from-black/90 via-black/40 to-transparent transition-opacity duration-700 pointer-events-none ${showControls ? 'opacity-100' : 'opacity-0'}`}>
                <div className="max-w-6xl mx-auto pointer-events-auto">
                    {/* Progress Bar */}
                    <div className="relative group mb-8">
                        <input
                            type="range"
                            min="0"
                            max={duration || 0}
                            value={currentTime}
                            onChange={handleSeek}
                            className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-cyan-500 hover:h-2 transition-all duration-300"
                        />
                        <div
                            className="absolute top-0 left-0 h-1.5 bg-cyan-500 rounded-full pointer-events-none"
                            style={{ width: `${(currentTime / duration) * 100}%` }}
                        ></div>
                    </div>

                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-8">
                            <button onClick={togglePlay} className="text-white hover:text-cyan-500 transition-colors">
                                {isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" />}
                            </button>

                            <div className="flex items-center gap-4 text-xs font-black text-white/60 tracking-widest tabular-nums">
                                <span className="text-white">{formatTime(currentTime)}</span>
                                <span className="opacity-20">/</span>
                                <span>{formatTime(duration)}</span>
                            </div>
                        </div>

                        <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center">
                            <h2 className="text-lg font-black text-white tracking-tighter uppercase">{movie.official_title || movie.detected_title}</h2>
                            <p className="text-[10px] text-cyan-500/60 font-black tracking-[0.3em] uppercase mt-1">CineVault Interactive Player</p>
                        </div>

                        <div className="flex items-center gap-8">
                            <div className="flex items-center gap-4 group/vol">
                                <button onClick={toggleMute} className="text-white/60 hover:text-white transition-colors">
                                    {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                                </button>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.1"
                                    value={isMuted ? 0 : volume}
                                    onChange={handleVolumeChange}
                                    className="w-24 h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-white opacity-0 group-hover/vol:opacity-100 transition-all duration-500"
                                />
                            </div>
                            <button onClick={toggleFullscreen} className="text-white/60 hover:text-white transition-colors">
                                <Maximize size={20} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default VideoPlayer;
