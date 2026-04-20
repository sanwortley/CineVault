import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
    Play, Pause, Volume2, VolumeX, Maximize, X, 
    Loader2, Subtitles, SkipBack, SkipForward, Lock, Unlock, Film
} from 'lucide-react';
import { api, BACKEND_URL } from '../api';
import { useAuth } from '../context/AuthContext';

function VideoPlayer({ movie, onClose, userProgress = {} }) {
    const { user, saveUserProgress } = useAuth();
    const videoRef = useRef(null);
    const playerRef = useRef(null);
    const isMobile = typeof window !== 'undefined' && (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768);
    const [isPlaying, setIsPlaying] = useState(true);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(isMobile);
    const [showControls, setShowControls] = useState(true);
    const [isLocked, setIsLocked] = useState(false);
    const [isUnlocking, setIsUnlocking] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isStuckAtZero, setIsStuckAtZero] = useState(false);
    const [isInitializing, setIsInitializing] = useState(true);
    const [lastTap, setLastTap] = useState(0);
    const [error, setError] = useState(null);
    const [useTranscoding, setUseTranscoding] = useState(false);
    const [streamSource, setStreamSource] = useState('checking');
    const [unlockProgress, setUnlockProgress] = useState(0);
    const unlockTimerRef = useRef(null);
    
    const [subtitles, setSubtitles] = useState([]);
    const [selectedSubtitle, setSelectedSubtitle] = useState(null);
    const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
    const [isSearchingSubtitles, setIsSearchingSubtitles] = useState(false);
    const [subtitleCues, setSubtitleCues] = useState([]);
    const controlsTimeoutRef = useRef(null);
    
    // Use userProgress prop first, fallback to movie.watched_duration
    const movieUserProgress = userProgress[movie?.id] ?? movie?.watched_duration ?? 0;
    const initialSeek = movieUserProgress > 0 ? Math.floor(movieUserProgress) : 0;
    const [seekOffset] = useState(initialSeek);


    // Initial mute logic for mobile
    useEffect(() => {
        if (isMobile) {
            setIsMuted(true);
            if (videoRef.current) videoRef.current.muted = true;
        }
    }, [isMobile]);

    // Stuck detection logic
    useEffect(() => {
        let timer;
        if (isPlaying && currentTime === 0 && !isLoading && !isInitializing) {
            timer = setTimeout(() => {
                setIsStuckAtZero(true);
                console.log('[VideoPlayer] Playback seems stuck at 0:00. Showing overlay.');
            }, 3000);
        } else {
            setIsStuckAtZero(false);
        }
        return () => clearTimeout(timer);
    }, [isPlaying, currentTime, isLoading, isInitializing]);

    useEffect(() => {
        const resolveSource = async () => {
            setIsInitializing(true);
            setError(null);
            
            try {
                const hasDriveFile = !!movie.drive_file_id;
                const hasLocalFile = movie.file_path && movie.file_path.length > 0;
                
                if (hasDriveFile) {
                    setStreamSource('drive');
                    if (movie.file_name?.toLowerCase().endsWith('.mkv') || movie.official_title?.toLowerCase().endsWith('.mkv')) {
                        setUseTranscoding(true);
                    }
                } else if (hasLocalFile) {
                    setStreamSource('local');
                    if (movie.file_path.toLowerCase().endsWith('.mkv')) {
                        setUseTranscoding(true);
                    }
                } else {
                    setStreamSource('error');
                    setError('No se pudo encontrar la fuente del video.');
                }
            } catch (err) {
                setError('Error al inicializar la fuente de video.');
            } finally {
                setIsInitializing(false);
            }
        };
        
        resolveSource();
    }, [movie.id]);

    // Build video URL after streamSource is determined - Stable reference
    const videoUrl = useMemo(() => {
        if (streamSource === 'checking' || streamSource === 'error') return '';
        
        if (streamSource === 'drive') {
            const baseUrl = api.isElectron() ? `http://localhost:19998/stream/${movie.drive_file_id}` : `${BACKEND_URL}/api/drive/stream/${movie.drive_file_id}`;
            return `${baseUrl}${useTranscoding ? `?transcode=true&t=${seekOffset}` : ''}`;
        } else if (streamSource === 'local') {
            if (api.isElectron()) {
                const normalized = movie.file_path.replace(/\\/g, '/');
                const match = normalized.match(/^([a-zA-Z]):(.*)/);
                const basePath = match ? `cine://${match[1]}${match[2]}` : `cine://${normalized}`;
                return `${basePath}${useTranscoding ? `?transcode=true&t=${seekOffset}` : ''}`;
            } else {
                return `${BACKEND_URL}/api/stream/local?path=${encodeURIComponent(movie.file_path)}${useTranscoding ? `&transcode=true&t=${seekOffset}` : ''}`;
            }
        }
        return '';
    }, [movie.id, movie.drive_file_id, movie.file_path, streamSource, useTranscoding, seekOffset]);

    const isDisplayLoading = isInitializing || isLoading;

    const handleVideoError = (e) => {
        const videoElement = e.target;
        const errorCode = videoElement.error ? videoElement.error.code : 'Unknown';

        console.error('[VideoPlayer] Video Error:', {
            errorCode,
            errorMessage: videoElement.error?.message,
            src: videoElement.currentSrc?.substring(0, 100),
            networkState: videoElement.networkState,
            readyState: videoElement.readyState
        });
        
        if (!videoUrl || videoUrl === '' || streamSource === 'checking') {
            return;
        }
        
        setIsLoading(false);
        
        // If we get a source error and were NOT transcoding, try transcoding as a fallback
        if (!useTranscoding && (errorCode === 3 || errorCode === 4 || errorCode === 'MEDIA_ERR_SRC_NOT_SUPPORTED' || errorCode === 'MEDIA_ERR_DECODE' || videoElement.readyState === 0)) {
            console.log('[VideoPlayer] Fallback to transcoding due to error:', errorCode);
            setUseTranscoding(true);
            setError(null);
            setIsLoading(true);
            return;
        }

        // Try to fetch the actual error message from the server
        fetch(videoUrl, { method: 'GET' }).then(async (res) => {
            if (res.status === 401 || res.status === 500) {
                try {
                    const data = await res.json();
                    const msg = data.message || data.error || '';
                    
                    if (res.status === 401 || msg.includes('invalid_grant') || msg.includes('Sesión de Google Drive expirada')) {
                        setError('Tu sesión de Google Drive ha expirado o es inválida. Por favor, reconéctate en Ajustes.');
                    } else if (msg.includes('403') || msg.includes('limit')) {
                        setError('Google Drive ha limitado el acceso a este archivo (posible exceso de cuota). Intenta más tarde.');
                    } else {
                        setError(data.error || data.message || 'Error de servidor al cargar el video.');
                    }
                } catch (jsonErr) {
                    setError('Error de servidor (500). El archivo podría estar corrupto o no disponible.');
                }
            } else if (!res.ok) {
                setError(`Error de red (${res.status}). Verifica tu conexión.`);
            } else {
                setError('Formato de video no compatible con este navegador.');
            }
        }).catch(() => {
            setError('No se pudo conectar con el servidor de video.');
        });
    };

    const handleLoadedData = () => {
        setIsInitializing(false);
        if (videoRef.current) {
            videoRef.current.preload = 'auto';
        }
    };

    const handleCanPlay = async () => {
        setIsLoading(false);
        if (videoRef.current) {
            try {
                // Pre-set muted state on the element to satisfy mobile policies
                if (isMobile) {
                    videoRef.current.muted = true;
                    setIsMuted(true);
                }
                const playPromise = videoRef.current.play();
                if (playPromise !== undefined) {
                    await playPromise;
                    setIsPlaying(true);
                }
            } catch (err) {
                console.warn('[VideoPlayer] Autoplay blocked, waiting for interaction:', err.message);
                setIsPlaying(false);
            }
        }
    };

    const resetTimer = () => {
        if (isLocked) return;
        setShowControls(true);
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        
        if (isPlaying) {
            controlsTimeoutRef.current = setTimeout(() => {
                setShowControls(false);
            }, 4000);
        }
    };

    useEffect(() => {
        if (isPlaying) resetTimer();
    }, [isPlaying]);

    const togglePlay = () => {
        if (videoRef.current) {
            if (videoRef.current.paused) {
                videoRef.current.play().catch(err => {
                    console.warn('[VideoPlayer] Play blocked:', err.message);
                    setIsPlaying(false);
                });
            } else {
                videoRef.current.pause();
            }
            // We don't set state here manually, we wait for onPlay/onPause events
            // to ensure React state and DOM state are in sync.
        }
    };

    const handleVolumeChange = (e) => {
        const newVolume = parseFloat(e.target.value);
        setVolume(newVolume);
        setIsMuted(newVolume === 0);
        if (videoRef.current) {
            videoRef.current.volume = newVolume;
        }
    };

    const toggleMute = () => {
        if (videoRef.current) {
            if (isMuted) {
                videoRef.current.volume = volume || 1;
                setIsMuted(false);
            } else {
                videoRef.current.volume = 0;
                setIsMuted(true);
            }
        }
    };

    const handleSeek = (e) => {
        const time = parseFloat(e.target.value);
        if (videoRef.current) {
            videoRef.current.currentTime = time;
            setCurrentTime(time);
        }
    };

    const skipBackward = () => {
        if (videoRef.current) {
            videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
        }
    };

    const skipForward = () => {
        if (videoRef.current) {
            videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 10);
        }
    };

    const toggleFullscreen = async () => {
        if (!playerRef.current && !videoRef.current) return;

        const isCurrentlyFullscreen = document.fullscreenElement || 
                                     document.webkitFullscreenElement || 
                                     document.mozFullScreenElement || 
                                     document.msFullscreenElement;

        if (isCurrentlyFullscreen) {
            if (document.exitFullscreen) await document.exitFullscreen();
            else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
            
            if (window.screen.orientation && window.screen.orientation.unlock) {
                window.screen.orientation.unlock().catch(() => {});
            }
        } else {
            const videoEl = videoRef.current;
            const containerEl = playerRef.current;
            
            // Priority 1: Native Video Fullscreen (Mandatory for iPhone)
            if (isMobile && videoEl && videoEl.webkitEnterFullscreen) {
                try {
                    await videoEl.webkitEnterFullscreen();
                    return;
                } catch (err) {
                    console.warn('[VideoPlayer] webkitEnterFullscreen failed:', err.message);
                }
            }
            
            // Priority 2: Standard Fullscreen API (iPad, Android, Desktop)
            const requestFS = containerEl.requestFullscreen || 
                               containerEl.webkitRequestFullscreen || 
                               containerEl.mozRequestFullScreen || 
                               containerEl.msRequestFullscreen;
                               
            if (requestFS) {
                try {
                    await requestFS.call(containerEl);
                    if (window.screen.orientation?.lock) {
                        try {
                            await window.screen.orientation.lock('landscape');
                        } catch (e) {}
                    }
                } catch (err) {
                    // Fallback to video element if container fails
                    if (videoEl && videoEl.webkitRequestFullscreen) {
                        await videoEl.webkitRequestFullscreen();
                    }
                }
            }
        }
    };

    // Auto-landscape suggestion/handling
    useEffect(() => {
        const handleOrientationChange = () => {
            if (isMobile && window.screen.orientation?.type.startsWith('landscape')) {
                // If user rotated to landscape, maybe they want fullscreen?
                // But we can't force it without user gesture.
                // We'll just ensure controls are visible to help them.
                resetTimer();
            }
        };

        window.screen.orientation?.addEventListener('change', handleOrientationChange);
        return () => window.screen.orientation?.removeEventListener('change', handleOrientationChange);
    }, [isMobile]);

    const formatTime = (seconds) => {
        if (!seconds || isNaN(seconds)) return '0:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) return h + ':' + m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
        return m + ':' + s.toString().padStart(2, '0');
    };

    const handleSearchSubtitles = async () => {
        setIsSearchingSubtitles(true);
        try {
            const res = await api.searchSubtitles({ 
                imdbId: movie.imdb_id,
                title: movie.official_title || movie.file_name 
            });
            if (res.data && res.data.length > 0) {
                setSubtitles(prev => {
                    const unique = [...prev];
                    res.data.forEach(s => {
                        if (!unique.find(u => u.id === s.id)) {
                            unique.push({ ...s, type: 'cloud' });
                        }
                    });
                    return unique;
                });

                // Auto-select the first (best) Spanish subtitle if none is selected
                if (!selectedSubtitle) {
                    const bestSpanish = res.data.find(s => s.language === 'es');
                    if (bestSpanish) {
                        handleSubtitleSelect(bestSpanish);
                    }
                }
            }
        } catch (err) {
            setError('Error al buscar subtítulos online. Verifica tu conexión.');
        } finally {
            setIsSearchingSubtitles(false);
        }
    };

    const handleSubtitleSelect = async (subtitle) => {
        setSelectedSubtitle(subtitle);
        setSubtitleCues([]);
        
        if (!subtitle) return;
        
        try {
            let url = '';
            if (subtitle.type === 'cloud') {
                url = BACKEND_URL + '/api/subtitles/cloud?id=' + subtitle.id;
            }
            
            if (url) {
                const response = await fetch(url);
                const text = await response.text();
                const cues = parseVTT(text);
                setSubtitleCues(cues);
            }
        } catch (err) {}
    };

    const parseVTT = (vttText) => {
        const cues = [];
        const lines = vttText.split('\n');
        let i = 0;
        
        while (i < lines.length) {
            if (lines[i].includes('-->')) {
                const timeMatch = lines[i].match(/(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})/);
                if (timeMatch) {
                    const start = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 1000;
                    const end = parseInt(timeMatch[5]) * 3600 + parseInt(timeMatch[6]) * 60 + parseInt(timeMatch[7]) + parseInt(timeMatch[8]) / 1000;
                    let text = '';
                    i++;
                    while (i < lines.length && lines[i].trim() !== '') {
                        text += (text ? '\n' : '') + lines[i].trim();
                        i++;
                    }
                    cues.push({ start, end, text });
                } else {
                    i++;
                }
            } else {
                i++;
            }
        }
        return cues;
    };

    const currentSubtitle = subtitleCues.find(
        cue => currentTime >= cue.start && currentTime <= cue.end
    );

    const handleVideoClick = (e) => {
        const now = Date.now();
        
        if (showSubtitleMenu) {
            setShowSubtitleMenu(false);
            return;
        }
        
        if (now - lastTap < 300) {
            const rect = e.target.getBoundingClientRect();
            const tapX = e.clientX - rect.left;
            if (tapX < rect.width / 2) skipBackward();
            else skipForward();
        } else {
            if (!isLocked) togglePlay();
        }
        setLastTap(now);
    };

    const handleUnlockStart = () => {
        if (unlockTimerRef.current) clearInterval(unlockTimerRef.current);
        setIsUnlocking(true);
        setUnlockProgress(0);
        
        unlockTimerRef.current = setInterval(() => {
            setUnlockProgress(prev => {
                if (prev >= 100) {
                    clearInterval(unlockTimerRef.current);
                    setIsLocked(false);
                    setIsUnlocking(false);
                    setShowControls(true);
                    return 0;
                }
                return prev + (100 / 30); // 3 seconds total (running at 100ms interval)
            });
        }, 100);
    };

    const handleUnlockEnd = () => {
        if (unlockTimerRef.current) {
            clearInterval(unlockTimerRef.current);
            unlockTimerRef.current = null;
        }
        setIsUnlocking(false);
        setUnlockProgress(0);
    };

    if (error) {
        return (
            <div className="fixed inset-0 bg-black z-300 flex items-center justify-center p-8">
                <div className="text-center max-w-sm">
                    <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                        <X size={32} className="text-red-500" />
                    </div>
                    <p className="text-white text-lg mb-6">{error}</p>
                    <div className="flex flex-col gap-3">
                        {error.includes('Ajustes') ? (
                            <button 
                                onClick={() => { window.location.hash = '#settings'; onClose(0); }}
                                className="px-6 py-3 bg-netflix-red text-white font-bold rounded-full"
                            >
                                Ir a Ajustes
                            </button>
                        ) : (
                            <button 
                                onClick={() => { setError(null); setIsLoading(true); setStreamSource('checking'); }}
                                className="px-6 py-3 bg-cyan-500 text-black font-bold rounded-full"
                            >
                                Reintentar
                            </button>
                        )}
                        <button 
                            onClick={() => onClose(0)} 
                            className="px-6 py-3 bg-white/10 text-white font-bold rounded-full"
                        >
                            Cerrar
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div 
            ref={playerRef}
            className="fixed inset-0 bg-black z-[1000] flex flex-col overflow-hidden select-none touch-none h-full w-full pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
            onMouseMove={resetTimer}
            onClick={resetTimer}
            onTouchStart={resetTimer}
        >
            <div className="flex-1 flex items-center justify-center bg-black relative">
                <video
                    ref={videoRef}
                    src={videoUrl}
                    className="w-full h-full object-contain md:object-contain"
                    style={{ backgroundColor: '#000', height: '100%', width: '100%' }}
                    onTimeUpdate={(e) => {
                        setCurrentTime(e.target.currentTime);
                    }}
                    onLoadedMetadata={(e) => {
                        setDuration(e.target.duration);
                        if (videoRef.current) {
                            videoRef.current.preload = 'auto';
                        }
                    }}
                    onLoadedData={handleLoadedData}
                    onCanPlay={handleCanPlay}
                    onPlay={() => setIsPlaying(true)}
                    onPause={(e) => {
                        setIsPlaying(false);
                        if (user && movie?.id && e.target.currentTime > 0) {
                            saveUserProgress(movie.id, Math.floor(e.target.currentTime));
                        }
                    }}
                    onWaiting={() => setIsLoading(true)}
                    onPlaying={() => setIsLoading(false)}
                    onError={handleVideoError}
                    autoPlay
                    playsInline
                    webkit-playsinline="true"
                    crossOrigin="anonymous"
                    preload="metadata"
                    onClick={handleVideoClick}
                >
                    {selectedSubtitle && (
                        <track
                            key={selectedSubtitle.id}
                            kind="subtitles"
                            src={
                                selectedSubtitle.type === 'cloud'
                                    ? BACKEND_URL + '/api/subtitles/cloud?id=' + selectedSubtitle.id
                                    : selectedSubtitle.url || ''
                            }
                            srcLang="es"
                            label={selectedSubtitle.label || 'Español'}
                            default
                        />
                    )}
                </video>
            </div>

            {isLocked && (
                <div className="absolute inset-0 z-[1002] pointer-events-auto">
                    {/* Interaction barrier to block video controls/clicks */}
                    <div className="absolute inset-0 bg-transparent" />
                    
                    {/* Small Lock Icon in Top Right */}
                    <div 
                        className={`absolute top-6 right-6 flex flex-col items-center gap-2 transition-all duration-500 cursor-pointer ${isUnlocking ? 'opacity-100 scale-110' : 'opacity-10'}`}
                        style={{ WebkitTapHighlightColor: 'transparent' }}
                        onMouseDown={handleUnlockStart}
                        onMouseUp={handleUnlockEnd}
                        onMouseLeave={handleUnlockEnd}
                        onTouchStart={handleUnlockStart}
                        onTouchEnd={handleUnlockEnd}
                    >
                        <div className="relative w-16 h-16 flex items-center justify-center">
                            {/* Circular progress background - only visible when unlocking */}
                            <svg className={`absolute inset-0 w-full h-full -rotate-90 transition-opacity duration-300 ${isUnlocking ? 'opacity-100' : 'opacity-0'}`}>
                                <circle
                                    cx="32"
                                    cy="32"
                                    r="28"
                                    stroke="rgba(255,255,255,0.1)"
                                    strokeWidth="3"
                                    fill="none"
                                />
                                <circle
                                    cx="32"
                                    cy="32"
                                    r="28"
                                    stroke="#06b6d4"
                                    strokeWidth="3"
                                    fill="none"
                                    strokeDasharray="175.93"
                                    strokeDashoffset={175.93 - (175.93 * unlockProgress) / 100}
                                    className="transition-all duration-100 ease-linear"
                                />
                            </svg>
                            <div className="flex flex-col items-center">
                                <Lock size={24} className="text-white" />
                                {isUnlocking && <span className="text-cyan-400 font-black text-[10px] mt-0.5">{Math.ceil(3 - (unlockProgress * 3 / 100))}s</span>}
                            </div>
                        </div>
                        {isUnlocking && (
                            <p className="text-white/60 text-[8px] font-black uppercase tracking-[0.2em] whitespace-nowrap bg-black/40 px-2 py-1 rounded-full backdrop-blur-sm">Soltá para desbloquear</p>
                        )}
                    </div>
                </div>
            )}

            {!isLocked && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setIsLocked(true);
                        setShowControls(false);
                    }}
                    className={`absolute left-[max(1.5rem,env(safe-area-inset-left))] top-1/2 -translate-y-1/2 p-4 bg-black/60 backdrop-blur-xl rounded-full text-white/80 hover:text-cyan-400 hover:scale-110 transition-all z-[1001] border border-white/10 shadow-2xl ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                >
                    <Unlock size={28} />
                </button>
            )}

            {currentSubtitle && (
                <div className="absolute bottom-24 left-0 right-0 flex justify-center pointer-events-none px-4">
                    <div className="bg-black/80 px-4 py-2 rounded-lg max-w-90 text-center">
                        <p className="text-white text-lg md:text-xl font-medium">{currentSubtitle.text}</p>
                    </div>
                </div>
            )}

            {isMuted && !isLocked && !isDisplayLoading && (
                <div className="absolute inset-x-0 bottom-[env(safe-area-inset-bottom)] pb-24 md:pb-0 pointer-events-none flex justify-center z-50">
                    <button 
                        onClick={() => {
                            if (videoRef.current) {
                                videoRef.current.muted = false;
                                setIsMuted(false);
                                setVolume(1);
                                videoRef.current.volume = 1;
                                videoRef.current.play().catch(() => {});
                            }
                        }}
                        className="pointer-events-auto flex items-center gap-2 px-6 py-3 bg-cyan-500 text-black text-xs font-black uppercase rounded-full shadow-[0_0_30px_rgba(6,182,212,0.4)] animate-in slide-in-from-bottom-5 duration-500"
                    >
                        <Volume2 size={18} fill="currentColor" />
                        Activar Sonido
                    </button>
                </div>
            )}

            {isStuckAtZero && isPlaying && !isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-[1001] animate-in fade-in duration-300">
                    <div className="text-center p-8">
                        <div 
                            onClick={togglePlay}
                            className="w-24 h-24 bg-cyan-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_0_50px_rgba(6,182,212,0.6)] cursor-pointer active:scale-95 transition-transform"
                        >
                            <Play size={40} className="text-black ml-2" fill="currentColor" />
                        </div>
                        <h2 className="text-white text-xl font-black uppercase tracking-widest mb-2 font-netflix">Toca para Iniciar</h2>
                        <p className="text-white/60 text-xs font-bold uppercase tracking-widest leading-loose">Tu navegador bloqueó la reproducción automática</p>
                    </div>
                </div>
            )}

            {isDisplayLoading && !error && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10 transition-colors">
                    <div className="text-center">
                        <div className="relative">
                            <Loader2 className="text-cyan-500 animate-spin w-20 h-20 mx-auto mb-4" />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Film size={24} className="text-cyan-500/40" />
                            </div>
                        </div>
                        <p className="text-white font-black uppercase tracking-[0.3em] text-[10px] animate-pulse">Iniciando Bóveda...</p>
                    </div>
                </div>
            )}

            <button
                onClick={() => {
                    if (user && movie?.id && currentTime > 0) {
                        saveUserProgress(movie.id, Math.floor(currentTime));
                    }
                    onClose(currentTime);
                }}
                className={`absolute top-[max(1rem,env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))] p-3 bg-black/50 backdrop-blur-sm rounded-full text-white/80 hover:text-white transition-all z-[1001] active:scale-90 ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'}`}
            >
                <X size={isMobile ? 24 : 28} />
            </button>

            {showControls && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-4 md:p-6">
                    <div className="flex flex-col gap-4 max-w-6xl mx-auto w-full">
                        <div className="flex items-center justify-between text-white text-xs md:text-sm">
                            <span>{formatTime(currentTime)}</span>
                            <span>{formatTime(duration)}</span>
                        </div>
                        
                        <input
                            type="range"
                            min="0"
                            max={duration || 100}
                            value={currentTime}
                            onChange={handleSeek}
                            className="w-full h-1.5 md:h-2 bg-white/30 rounded-full appearance-none cursor-pointer accent-cyan-500"
                        />
                        
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 md:gap-6">
                                <button onClick={skipBackward} className="text-white hover:text-cyan-400 transition-colors">
                                    <SkipBack size={isMobile ? 24 : 28} />
                                </button>
                                
                                <button onClick={togglePlay} className="p-3 md:p-4 bg-cyan-500 rounded-full text-black hover:bg-cyan-400 transition-colors">
                                    {isPlaying ? <Pause size={isMobile ? 28 : 32} /> : <Play size={isMobile ? 28 : 32} className="ml-1" />}
                                </button>
                                
                                <button onClick={skipForward} className="text-white hover:text-cyan-400 transition-colors">
                                    <SkipForward size={isMobile ? 24 : 28} />
                                </button>
                            </div>
                            
                            <div className="flex items-center gap-3 md:gap-6">
                                <div className="flex items-center gap-2">
                                    <button onClick={toggleMute} className="text-white/70 hover:text-white transition-colors">
                                        {isMuted ? <VolumeX size={isMobile ? 20 : 24} /> : <Volume2 size={isMobile ? 20 : 24} />}
                                    </button>
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.1"
                                        value={isMuted ? 0 : volume}
                                        onChange={handleVolumeChange}
                                        className="w-16 md:w-24 h-1.5 bg-white/30 rounded-full appearance-none cursor-pointer"
                                        style={{ 
                                            background: 'linear-gradient(to right, #06b6d4 ' + ((isMuted ? 0 : volume) * 100) + '%, rgba(255,255,255,0.3) 0%)' 
                                        }}
                                    />
                                </div>
                                
                                
                                <button onClick={() => { setShowSubtitleMenu(!showSubtitleMenu); setShowControls(true); }} className={'p-3 rounded-full transition-colors ' + (selectedSubtitle ? 'text-cyan-400 bg-cyan-400/20' : 'text-white/70 hover:text-white')}>
                                    <Subtitles size={isMobile ? 24 : 28} />
                                </button>
                                
                                <button onClick={toggleFullscreen} className="p-3 text-white/70 hover:text-white transition-colors active:scale-90">
                                    <Maximize size={isMobile ? 24 : 28} />
                                </button>
                            </div>
                        </div>

                        {showSubtitleMenu && (
                            <div className="bg-slate-900/95 backdrop-blur rounded-xl p-4 mt-2">
                                <div className="flex justify-between items-center mb-3">
                                    <span className="text-white/60 text-xs font-bold uppercase">Subtítulos</span>
                                    <button onClick={() => setShowSubtitleMenu(false)} className="text-white/40">
                                        <X size={16} />
                                    </button>
                                </div>
                                
                                <div className="space-y-2 max-h-48 overflow-y-auto">
                                    <button
                                        onClick={() => { setSelectedSubtitle(null); setSubtitleCues([]); setShowSubtitleMenu(false); }}
                                        className={'w-full text-left p-2.5 rounded-lg text-sm ' + (!selectedSubtitle ? 'bg-cyan-500 text-black font-bold' : 'text-white hover:bg-white/10')}
                                    >
                                        Ninguno
                                    </button>
                                    
                                    {subtitles.map((sub, i) => (
                                        <button
                                            key={i}
                                            onClick={() => { handleSubtitleSelect(sub); setShowSubtitleMenu(false); }}
                                            className={'w-full text-left p-2.5 rounded-lg text-sm ' + (selectedSubtitle === sub ? 'bg-cyan-500 text-black font-bold' : 'text-white hover:bg-white/10')}
                                        >
                                            {sub.file_name || sub.label}
                                        </button>
                                    ))}
                                    
                                    <button
                                        onClick={handleSearchSubtitles}
                                        disabled={isSearchingSubtitles}
                                        className="w-full text-center p-3 text-cyan-400 text-sm font-bold border-t border-white/10 mt-2 hover:bg-cyan-400/10 transition-colors"
                                    >
                                        {isSearchingSubtitles ? 'Buscando...' : 'Buscar Online'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default VideoPlayer;