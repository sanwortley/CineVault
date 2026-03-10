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
    const [audioTrackStatus, setAudioTrackStatus] = useState('checking'); // 'checking', 'unsupported', 'ok', 'transcoding'
    const [audioDiagnostic, setAudioDiagnostic] = useState("Iniciando...");
    const [useTranscoding, setUseTranscoding] = useState(false);
    const [seekOffset, setSeekOffset] = useState(0);
    const [totalDuration, setTotalDuration] = useState(0);
    const controlsTimeoutRef = useRef(null);
    const isPlayingRef = useRef(false);
    const isLoadingRef = useRef(true);
    const lastTimeRef = useRef(0);

    const videoUrl = `cine:///${movie.file_path}${useTranscoding ? `?transcode=true&t=${seekOffset}` : ''}`;

    const handleVideoError = (e) => {
        const videoElement = e.target;
        const errorCode = videoElement.error ? videoElement.error.code : 'Desconocido';
        console.error('Video Error:', e, 'Code:', errorCode);
        setIsLoading(false);
        if (movie.file_size === 0) {
            setError('El archivo de video está vacío (0 KB). Agrega una película real para probar.');
        } else {
            setError(`No se puede reproducir este video (Error ${errorCode}). Es posible que el códec no sea compatible con el navegador integrado o que el archivo esté dañado.`);
        }
    };

    const resetTimer = () => {
        setShowControls(true);
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        
        if (isPlayingRef.current && !isLoadingRef.current) {
            controlsTimeoutRef.current = setTimeout(() => {
                setShowControls(false);
            }, 3000);
        }
    };

    useEffect(() => {
        isPlayingRef.current = isPlaying;
        if (isPlaying) resetTimer();
    }, [isPlaying]);

    useEffect(() => {
        isLoadingRef.current = isLoading;
        if (!isLoading) resetTimer();
    }, [isLoading]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    togglePlay();
                    break;
                case 'ArrowRight':
                    skipTime(10);
                    break;
                case 'ArrowLeft':
                    skipTime(-10);
                    break;
                case 'KeyF':
                    toggleFullscreen();
                    break;
                case 'Escape':
                    if (document.fullscreenElement) {
                        document.exitFullscreen();
                    } else {
                        onClose();
                    }
                    break;
                default:
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('mousemove', resetTimer);
        
        resetTimer();

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('mousemove', resetTimer);
            if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        };
    }, [isLoading]);

    const togglePlay = () => {
        if (videoRef.current.paused) {
            videoRef.current.play();
        } else {
            videoRef.current.pause();
        }
    };

    const handleTimeUpdate = () => {
        if (useTranscoding) {
            setCurrentTime(seekOffset + videoRef.current.currentTime);
        } else {
            setCurrentTime(videoRef.current.currentTime);
        }
    };

    useEffect(() => {
        const initAudio = async () => {
            const status = await window.electronAPI.checkAudio(movie.file_path);
            if (status.duration) {
                setTotalDuration(status.duration);
                setDuration(status.duration);
            }
            if (status.needsTranscode) {
                console.log('[Player] Unsupported codec detected:', status.codec, '. Activating live transcoding.');
                setAudioTrackStatus('transcoding');
                setUseTranscoding(true);
            }
        };
        initAudio();
    }, [movie.file_path]);

    const handleLoadedMetadata = () => {
        // If transcoding, the browser thinks duration is Infinity, so we keep the ffprobe duration
        if (!useTranscoding) {
            setDuration(videoRef.current.duration);
        }
        
        // Force state sync
        videoRef.current.volume = volume;
        videoRef.current.muted = false;
        setIsMuted(false);
        
        if (!useTranscoding) checkAudioStatus();
        setIsLoading(false);
    };

    const checkAudioStatus = () => {
        setTimeout(() => {
            if (videoRef.current) {
                const decoded = videoRef.current.webkitAudioDecodedByteCount || 0;
                setAudioDiagnostic(`Bytes Decodificados: ${decoded}`);
                if (decoded === 0 && isPlayingRef.current) {
                    setAudioTrackStatus('unsupported');
                } else if (decoded > 0) {
                    setAudioTrackStatus('ok');
                }
            }
        }, 3000);
    };

    const handleSeek = (e) => {
        const time = Number(e.target.value);
        
        if (useTranscoding) {
            setIsLoading(true);
            setSeekOffset(time);
            // Changing videoUrl (which depends on seekOffset) will force a reload
        } else {
            videoRef.current.currentTime = time;
            setCurrentTime(time);
        }

        setShowControls(true);
    };

    const skipTime = (seconds) => {
        if (!videoRef.current) return;
        const newTime = Math.max(0, Math.min(duration, currentTime + seconds));
        
        if (useTranscoding) {
            setIsLoading(true);
            setSeekOffset(newTime);
        } else {
            videoRef.current.currentTime = newTime;
            setCurrentTime(newTime);
        }
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

    const handleOpenExternal = async () => {
        await window.electronAPI.openExternal(movie.file_path);
    };

    const formatTime = (time) => {
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    };

    return (
        <div
            ref={containerRef}
            onMouseMove={resetTimer}
            className={`fixed inset-0 z-[100] bg-black flex items-center justify-center overflow-hidden animate-fade-in select-none ${!showControls ? 'cursor-none' : ''}`}
        >
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/60 backdrop-blur-sm">
                    <Loader2 className="text-cyan-500 animate-spin" size={64} strokeWidth={1} />
                </div>
            )}

            <video
                ref={videoRef}
                src={videoUrl}
                className="w-full h-full object-contain cursor-pointer"
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onClick={togglePlay}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onWaiting={() => setIsLoading(true)}
                onPlaying={() => setIsLoading(false)}
                onError={handleVideoError}
                autoPlay
                muted={false}
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
                className={`absolute top-8 right-8 p-4 glass-card rounded-full text-white/40 hover:text-white hover:bg-red-500/20 transition-all duration-500 z-[110] ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}`}
            >
                <X size={24} />
            </button>

            {/* Controls Overlay */}
            <div className={`absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent transition-opacity duration-700 pointer-events-none ${showControls ? 'opacity-100' : 'opacity-0'}`}>
                <div className="absolute inset-x-0 bottom-0 p-8 pb-12 pointer-events-none">
                    <div className="max-w-6xl mx-auto pointer-events-auto">
                        {/* Progress Bar Container */}
                        <div className="relative group mb-6 h-4 flex items-center cursor-pointer">
                            <input
                                type="range"
                                min="0"
                                max={duration || 0}
                                value={currentTime}
                                onChange={handleSeek}
                                className="absolute inset-x-0 w-full h-1 bg-white/20 rounded-full appearance-none cursor-pointer accent-cyan-500 group-hover:h-1.5 transition-all duration-300 z-20 opacity-0"
                            />
                            <div className="absolute inset-x-0 h-1 bg-white/10 rounded-full overflow-hidden group-hover:h-1.5 transition-all duration-300">
                                <div
                                    className="h-full bg-cyan-500/20 w-full absolute top-0 left-0"
                                    style={{ transform: `scaleX(${currentTime / duration})`, transformOrigin: 'left' }}
                                ></div>
                                <div
                                    className="h-full bg-cyan-500"
                                    style={{ width: `${(currentTime / duration) * 100}%` }}
                                ></div>
                            </div>
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-8">
                                <div className="flex items-center gap-4">
                                    <button onClick={() => skipTime(-10)} className="text-white/40 hover:text-white transition-colors">
                                        <SkipBack size={20} />
                                    </button>
                                    <button onClick={togglePlay} className="w-12 h-12 flex items-center justify-center text-white hover:text-cyan-500 transition-colors bg-white/5 rounded-full hover:bg-white/10">
                                        {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} className="ml-0.5" fill="currentColor" />}
                                    </button>
                                    <button onClick={() => skipTime(10)} className="text-white/40 hover:text-white transition-colors">
                                        <SkipForward size={20} />
                                    </button>
                                </div>

                                <div className="flex items-center gap-3 text-[10px] font-black text-white/40 tracking-widest tabular-nums">
                                    <span className="text-white">{formatTime(currentTime)}</span>
                                    <span className="opacity-10">/</span>
                                    <span>{formatTime(duration)}</span>
                                </div>
                            </div>

                            <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
                                <h2 className="text-sm font-black text-white tracking-widest uppercase opacity-40 hover:opacity-100 transition-opacity whitespace-nowrap">{movie.official_title || movie.detect_title || movie.file_name}</h2>
                                {audioTrackStatus === 'transcoding' && (
                                    <div className="bg-cyan-500 text-white text-[8px] font-black px-3 py-1 rounded uppercase tracking-widest animate-pulse shadow-xl border border-cyan-400/50 flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 bg-white rounded-full animate-ping"></div>
                                        Audio Transcodificando (Live)
                                    </div>
                                )}
                                {audioTrackStatus === 'unsupported' && (
                                    <div className="flex flex-col items-center gap-2 animate-fade-in z-[60]">
                                        <div className="bg-red-500 text-white text-[9px] font-black px-4 py-2 rounded uppercase tracking-wider animate-bounce shadow-2xl flex items-center gap-2 border border-red-400/50">
                                            <VolumeX size={12} />
                                            Audio No Soportado (AC3/DTS)
                                        </div>
                                        <button 
                                            onClick={handleOpenExternal}
                                            className="bg-white text-black text-[9px] font-black px-5 py-2.5 rounded uppercase tracking-widest hover:bg-cyan-500 hover:text-white transition-all shadow-2xl active:scale-95 border border-white/20"
                                        >
                                            🔊 Abrir en VLC / Sistema
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center gap-6">
                                <div className="flex items-center gap-3 group/vol relative">
                                    <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-cyan-500/90 text-white text-[7px] font-black px-2 py-1 rounded uppercase tracking-tighter opacity-0 group-hover/vol:opacity-100 transition-opacity whitespace-nowrap z-50 shadow-lg pointer-events-none">
                                        {audioDiagnostic}
                                    </div>
                                    <button 
                                        onClick={() => { toggleMute(); videoRef.current.muted = false; checkAudioStatus(); }} 
                                        className={`${audioTrackStatus === 'unsupported' ? 'text-red-500 animate-pulse' : 'text-white/40'} hover:text-white transition-colors p-1`}
                                    >
                                        {isMuted || audioTrackStatus === 'unsupported' ? <VolumeX size={18} /> : <Volume2 size={18} />}
                                    </button>
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.1"
                                        value={isMuted ? 0 : volume}
                                        onChange={handleVolumeChange}
                                        className="w-0 group-hover/vol:w-16 h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-white transition-all duration-500"
                                    />
                                </div>
                                <button onClick={toggleFullscreen} className="text-white/40 hover:text-white transition-colors p-1">
                                    <Maximize size={18} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default VideoPlayer;
