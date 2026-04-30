import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
    Play, Pause, Volume2, VolumeX, Maximize, X, 
    Loader2, Subtitles, SkipBack, SkipForward, Lock, Unlock, Film,
    Plus, Cloud, Upload, AlertCircle, ExternalLink, Star, Settings, Search
} from 'lucide-react';
import { api, BACKEND_URL } from '../api';
import { useAuth } from '../context/AuthContext';
import { detectVersionInfo } from '../utils/movieUtils';

function VideoPlayer({ movie, onClose, onOpenSettings, onVersionChange, userProgress = {} }) {
    const { user, saveUserProgress } = useAuth();
    const videoRef = useRef(null);
    const playerRef = useRef(null);
    const [fullMovieData, setFullMovieData] = useState(null);
    
    // EFFECT: Auto-repair metadata if runtime is missing
    useEffect(() => {
        if (!movie?.runtime && movie?.id) {
            console.log(`[VideoPlayer] Runtime missing for movie ${movie.id}, repairing...`);
            api.get(`/movies?id=${movie.id}`)
                .then(res => {
                    if (res && res.length > 0) {
                        console.log(`[VideoPlayer] Metadata repaired for ${movie.id}: ${res[0].runtime} min`);
                        setFullMovieData(res[0]);
                    }
                })
                .catch(err => console.error('[VideoPlayer] Repair failed:', err));
        }
    }, [movie?.id, movie?.runtime]);

    // Use repaired data if available
    const activeMovie = fullMovieData || movie;
    const isMobile = typeof window !== 'undefined' && (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768);
    const [isPlaying, setIsPlaying] = useState(true);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const [isLocked, setIsLocked] = useState(false);
    const [isUnlocking, setIsUnlocking] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isStuckAtZero, setIsStuckAtZero] = useState(false);
    const [isInitializing, setIsInitializing] = useState(true);
    const [lastTap, setLastTap] = useState(0);
    const [error, setError] = useState(null);
    const [debugInfo, setDebugInfo] = useState([]);
    const [delayedMount, setDelayedMount] = useState(false);
    
    // Delayed mount for mobile safety
    useEffect(() => {
        const timer = setTimeout(() => setDelayedMount(true), 500);
        return () => clearTimeout(timer);
    }, []);

    // Add to debug log
    const addDebug = (msg) => {
        console.log(`[DEBUG] ${msg}`);
        setDebugInfo(prev => [...prev.slice(-20), { time: new Date().toLocaleTimeString(), msg }]);
    };

    // GLOBAL ERROR CATCHER
    useEffect(() => {
        const handleError = (e) => {
            const msg = e.error ? e.error.message : e.message;
            addDebug(`GLOBAL ERROR: ${msg}`);
            setError({ message: msg, stack: e.error?.stack });
        };
        const handleRejection = (e) => {
            addDebug(`PROMISE REJECTION: ${e.reason}`);
            setError({ message: `Promise Rejection: ${e.reason}` });
        };
        window.addEventListener('error', handleError);
        window.addEventListener('unhandledrejection', handleRejection);
        return () => {
            window.removeEventListener('error', handleError);
            window.removeEventListener('unhandledrejection', handleRejection);
        };
    }, []);

    const [useTranscoding, setUseTranscoding] = useState(false); // Disabled by default - use direct streaming for speed
    const [streamingMode, setStreamingMode] = useState('classic'); // HLS disabled - use direct streaming only
    const [streamSource, setStreamSource] = useState('checking');
    const [unlockProgress, setUnlockProgress] = useState(0);
    const unlockTimerRef = useRef(null);
    
    const [subtitles, setSubtitles] = useState([]);
    const [selectedSubtitle, setSelectedSubtitle] = useState(null);
    const [showSubtitleMenu, setShowSubtitleMenu ] = useState(false);
    const [showDriveExplorer, setShowDriveExplorer] = useState(false);
    const [isSearchingSubtitles, setIsSearchingSubtitles] = useState(false);
    const [subtitleSearchText, setSubtitleSearchText] = useState('');
    const [subtitleCues, setSubtitleCues] = useState([]);
    const [subtitleOffset, setSubtitleOffset] = useState(0); // in seconds
    const [subQuotaReached, setSubQuotaReached] = useState(false);
    
    const [showRatingOverlay, setShowRatingOverlay] = useState(false);
    const [userRating, setUserRating] = useState(0);
    const [isSavingRating, setIsSavingRating] = useState(false);
    const [hoverRating, setHoverRating] = useState(0);
    const [quality, setQuality] = useState('480');
    const [showQualityMenu, setShowQualityMenu] = useState(false);
    const [showVersionMenu, setShowVersionMenu] = useState(false);

    const [subtitleSettings, setSubtitleSettings] = useState(() => {
        const stored = localStorage.getItem('cinevault_subtitle_settings');
        return stored ? JSON.parse(stored) : { size: 'medium', color: 'white' };
    });

    const updateSubtitleSettings = (newSettings) => {
        const updated = { ...subtitleSettings, ...newSettings };
        setSubtitleSettings(updated);
        localStorage.setItem('cinevault_subtitle_settings', JSON.stringify(updated));
    };
    const controlsTimeoutRef = useRef(null);
    const fileInputRef = useRef(null);
    
    const versions = movie.versions || [movie];
    const initialSeekPerformed = useRef(false);
    
    // Use userProgress prop first (now an object), fallback to movie.watched_duration
    const progressObj = userProgress[String(movie?.id)];
    const movieUserProgress = (progressObj && typeof progressObj === 'object') 
        ? progressObj.duration 
        : (progressObj ?? movie?.watched_duration ?? 0);
        
    const initialSeek = movieUserProgress > 0 ? Math.floor(movieUserProgress) : 0;
    const [seekOffset] = useState(initialSeek);

    useEffect(() => {
        console.log('🚀 [CineVault] Player Version 2.1 - Active');
        if (initialSeek > 0) {
            console.log(`[VideoPlayer] Progreso detectado para película ${movie.id}: ${initialSeek}s`);
        }
    }, [movie.id, initialSeek]);


    // Initial mute logic for mobile
    useEffect(() => {
        if (isMobile) {
            setIsMuted(true);
            if (videoRef.current) videoRef.current.muted = true;
        }
    }, [isMobile]);

    // Robust Initial Seek
    useEffect(() => {
        if (!initialSeekPerformed.current && seekOffset > 0 && isPlaying && videoRef.current) {
            const video = videoRef.current;
            if (video.readyState >= 1) {
                console.log(`[VideoPlayer] Seeking to ${seekOffset}s (isPlaying=${isPlaying})`);
                video.currentTime = seekOffset;
                initialSeekPerformed.current = true;
            }
        }
    }, [isPlaying, seekOffset]);

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
                    if (movie.drive_file_id === 'pending_cloud') {
                        setStreamSource('cloud');
                    } else {
                        setStreamSource('drive');
                        if (movie.file_name?.toLowerCase().endsWith('.mkv') || movie.official_title?.toLowerCase().endsWith('.mkv')) {
                            setUseTranscoding(true);
                        }
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
        
        // --- Auto Subtitle Detection ---
        // Skip entirely for movies still being processed in the cloud
        if (movie.drive_file_id === 'pending_cloud') {
            console.log('[VideoPlayer] Autocarga de subtítulos omitida: película en procesamiento.');
        } else {
            const autoLoadSubtitles = async () => {
                try {
                    // 1. Check for local companion files first
                    const localRes = await api.findLocalSubtitle(movie.id);
                    if (localRes.found) {
                        console.log('[VideoPlayer] Autocarga: Subtítulo local detectado:', localRes.path);
                        handleSubtitleSelect({ ...localRes, type: 'local', label: 'Local' });
                    } else {
                        // 2. Check for cloud persistence (Drive)
                        const cloudRes = await api.checkCloudSubtitle(movie.id);
                        if (cloudRes.found) {
                            console.log('[VideoPlayer] Autocarga: Subtítulo en la nube detectado:', cloudRes.name);
                            handleSubtitleSelect({ 
                                id: cloudRes.fileId, 
                                type: 'drive', 
                                label: `Drive (${cloudRes.name})`,
                                provider: 'Drive Cache'
                            });
                        } else {
                            // 3. Fallback to search
                            handleSearchSubtitles();
                        }
                    }
                } catch (err) {
                    console.warn('[VideoPlayer] Error en autocarga de subtítulos:', err);
                    if (err.message?.includes('429')) setSubQuotaReached(true);
                }
            };

            if (!subQuotaReached) {
                autoLoadSubtitles();
            }
        }
    }, [movie.id, subQuotaReached]);

    // Build video URL - Direct streaming only (HLS disabled)
    const videoUrl = useMemo(() => {
        if (streamSource === 'checking' || streamSource === 'error') return '';
        
        if (streamSource === 'cloud') {
            return api.getCloudStreamUrl(movie.id);
        } else if (streamSource === 'drive') {
            return api.getStreamUrl(movie.drive_file_id, movie.file_path, { 
                transcode: useTranscoding, 
                seekOffset,
                quality // Pass selected quality
            });
        } else if (streamSource === 'local') {
            return api.getStreamUrl(null, movie.file_path, { 
                transcode: useTranscoding, 
                seekOffset,
                quality // Pass selected quality
            });
        }
        return '';
    }, [movie.id, movie.drive_file_id, movie.file_path, streamSource, useTranscoding, seekOffset, quality]);

    const isDisplayLoading = isInitializing || isLoading;

    // Fetch existing rating
    useEffect(() => {
        if (movie?.id && user?.id) {
            api.getUserRating(user.id, movie.id).then(res => {
                if (res?.rating) setUserRating(res.rating);
            }).catch(() => {});
        }
    }, [movie?.id, user?.id]);

    const handleRating = async (rating) => {
        setIsSavingRating(true);
        try {
            await api.saveUserRating(user?.id, movie.id, rating);
            setUserRating(rating);
            // Hide overlay after a short delay
            setTimeout(() => setShowRatingOverlay(false), 1000);
        } catch (err) {
            console.error('[Rating] Save error:', err);
        } finally {
            setIsSavingRating(false);
        }
    };

    const handleVideoEnded = () => {
        setIsPlaying(false);
        setShowRatingOverlay(true);
    };
    // Video initialization - Direct streaming only (HLS disabled)
    useEffect(() => {
        if (!videoUrl || streamingMode !== 'classic') return;
        
        const video = videoRef.current;
        if (video) {
            video.src = videoUrl;
            if (seekOffset > 0) {
                video.currentTime = seekOffset;
            }
        }
    }, [videoUrl, streamingMode, seekOffset]);

    const handleVideoError = (e) => {
        const videoElement = e.target;
        const errorCode = videoElement.error ? videoElement.error.code : 'Unknown';
        const errorMsg = videoElement.error?.message || '';
        addDebug(`VIDEO ERROR: Code ${errorCode} - ${errorMsg}`);

        console.error('[VideoPlayer] Video Error:', {
            errorCode,
            errorMessage: errorMsg,
            src: videoElement.currentSrc?.substring(0, 100)
        });
        
        setIsLoading(false);
        
        // Auto-transcode fallback
        if (!useTranscoding && (errorCode === 3 || errorCode === 4)) {
            console.log('[VideoPlayer] Fallback to transcoding...');
            setUseTranscoding(true);
            setError(null);
            setIsLoading(true);
            return;
        }

        let msg = 'Error de reproducción.';
        if (errorCode === 1) msg = 'Reproducción abortada.';
        if (errorCode === 2) msg = 'Error de red al cargar el video.';
        if (errorCode === 3) msg = 'Error al decodificar el video (Formato incompatible).';
        if (errorCode === 4) msg = 'Formato de video no soportado por este dispositivo.';

        setError(msg);
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
                // Perform initial seek if needed
                if (!initialSeekPerformed.current && seekOffset > 0) {
                    console.log(`[VideoPlayer] Initial seek to: ${seekOffset}s`);
                    videoRef.current.currentTime = seekOffset;
                    initialSeekPerformed.current = true;
                }

                // Try to play WITH sound first
                videoRef.current.muted = false;
                setIsMuted(false);
                
                const playPromise = videoRef.current.play();
                if (playPromise !== undefined) {
                    await playPromise;
                    setIsPlaying(true);
                }
            } catch (err) {
                console.warn('[VideoPlayer] Autoplay with sound blocked, trying muted...', err.message);
                try {
                    videoRef.current.muted = true;
                    setIsMuted(true);
                    await videoRef.current.play();
                    setIsPlaying(true);
                } catch (mutedErr) {
                    console.error('[VideoPlayer] Even muted playback failed:', mutedErr.message);
                    setIsPlaying(false);
                }
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
        if (seconds === Infinity) return '--:--';
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
                imdbId: subtitleSearchText ? null : movie.imdb_id,
                title: movie.official_title || movie.file_name,
                query: subtitleSearchText || null
            });
            if (res.data && res.data.length > 0) {
                setSubtitles(prev => {
                    const unique = [...prev];
                    res.data.forEach(s => {
                        if (!unique.find(u => u.id === s.id)) {
                            unique.push({ ...s, type: 'cloud' });
                        }
                    });
                    // Sort cloud results by score
                    return unique.sort((a, b) => (b.score || 0) - (a.score || 0));
                });

                // Auto-select the first (best) Spanish subtitle if none is currently selected
                if (!selectedSubtitle) {
                    const bestSpanish = res.data.find(s => s.language === 'es');
                    if (bestSpanish) {
                        console.log('[VideoPlayer] Autoselección: Mejor opción en Español:', bestSpanish.release);
                        handleSubtitleSelect(bestSpanish);
                    } else if (res.data.length > 0) {
                         // Fallback to English if no Spanish
                        const bestEnglish = res.data.find(s => s.language === 'en');
                        if (bestEnglish) handleSubtitleSelect(bestEnglish);
                    }
                }
            }
        } catch (err) {
            console.error('[VideoPlayer] Error al buscar subtítulos online:', err);
        } finally {
            setIsSearchingSubtitles(false);
        }
    };

    const handleSubtitleSelect = async (subtitle) => {
        setSelectedSubtitle(subtitle);
        setSubtitleCues([]);
        setSubtitleOffset(0); // Reset sync on new sub
        
        if (!subtitle) return;
        
        try {
            let url = '';
            let directContent = null;

            if (subtitle.type === 'cloud') {
                url = BACKEND_URL + '/api/subtitles/cloud?id=' + subtitle.id;
                api.downloadSubtitle(subtitle.id, movie.id).catch(e => console.warn('[VideoPlayer] Pairing failed:', e));
            } else if (subtitle.type === 'local') {
                url = BACKEND_URL + '/api/subtitles/external?path=' + encodeURIComponent(subtitle.path);
            } else if (subtitle.type === 'drive') {
                url = api.getDriveSubtitleUrl(subtitle.id);
            } else if (subtitle.type === 'manual') {
                directContent = subtitle.content;
            }
            
            if (directContent) {
                const cues = parseVTT(directContent);
                setSubtitleCues(cues);
            } else if (url) {
                const response = await fetch(url);
                
                // If it's a 429 or 500, we should check if the body is JSON error or just a failure
                if (!response.ok) {
                    const errorText = await response.text();
                    let isQuota = response.status === 429;
                    try {
                        const errJson = JSON.parse(errorText);
                        if (errJson.isQuota) isQuota = true;
                    } catch(e) {}

                    if (isQuota) setSubQuotaReached(true);
                    throw new Error(`Error ${response.status}: ${errorText.substring(0, 100)}`);
                }

                const text = await response.text();
                
                // Safety check: if it looks like JSON, it's probably an error that bypassed the status check
                if (text.trim().startsWith('{')) {
                    console.error('[VideoPlayer] Received JSON instead of VTT:', text);
                    throw new Error('Formato de subtítulo inválido (JSON)');
                }

                const cues = parseVTT(text);
                if (cues.length === 0) {
                    console.warn('[VideoPlayer] Parser returned 0 cues. Malformed VTT?');
                }
                setSubtitleCues(cues);
            }
        } catch (err) {
            console.error('[VideoPlayer] Subtitle selection error:', err);
            if (err.message?.includes('quota') || err.message?.includes('429')) {
                setSubQuotaReached(true);
            }
        }
    };

    const handleLocalSubtitleUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            let content = event.target.result;
            
            // Basic SRT -> VTT transformation if needed
            if (file.name.toLowerCase().endsWith('.srt')) {
                content = "WEBVTT\n\n" + content.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
            }

            const manualSub = {
                id: 'manual-' + Date.now(),
                label: 'Cargado: ' + file.name,
                file_name: file.name,
                type: 'manual',
                content: content
            };

            setSubtitles(prev => [manualSub, ...prev]);
            handleSubtitleSelect(manualSub);
            setShowSubtitleMenu(false);
        };
        reader.readAsText(file);
    };

    const parseVTT = (vttText) => {
        if (!vttText) return [];
        const cues = [];
        // Robust splitting for both CRLF and LF
        const lines = vttText.split(/\r?\n/);
        let i = 0;
        
        // Find first cue (skip WEBVTT header and metadata)
        while (i < lines.length && !lines[i].includes('-->')) {
            i++;
        }

        while (i < lines.length) {
            if (lines[i].includes('-->')) {
                // Better regex: handles , and . and optional hours
                const timeMatch = lines[i].match(/(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})/);
                if (timeMatch) {
                    const h1 = parseInt(timeMatch[1] || 0);
                    const m1 = parseInt(timeMatch[2]);
                    const s1 = parseInt(timeMatch[3]);
                    const ms1 = parseInt(timeMatch[4]);
                    
                    const h2 = parseInt(timeMatch[5] || 0);
                    const m2 = parseInt(timeMatch[6]);
                    const s2 = parseInt(timeMatch[7]);
                    const ms2 = parseInt(timeMatch[8]);

                    const start = h1 * 3600 + m1 * 60 + s1 + ms1 / 1000;
                    const end = h2 * 3600 + m2 * 60 + s2 + ms2 / 1000;
                    
                    let text = '';
                    i++;
                    while (i < lines.length && lines[i].trim() !== '') {
                        // Skip styling tags if present simple regex
                        const cleanText = lines[i].trim().replace(/<[^>]+>/g, '');
                        text += (text ? '\n' : '') + cleanText;
                        i++;
                    }
                    if (text) {
                        cues.push({ start, end, text });
                    }
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
        cue => {
            const adjustedTime = currentTime + subtitleOffset;
            return adjustedTime >= cue.start && adjustedTime <= cue.end;
        }
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

    return (
        <div 
            ref={playerRef}
            className="fixed inset-0 bg-black z-[1000] flex flex-col overflow-hidden select-none touch-none h-full w-full pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
            onMouseMove={resetTimer}
            onClick={resetTimer}
            onTouchStart={resetTimer}
        >
            <div className="flex-1 flex items-center justify-center bg-black relative">
                {delayedMount ? (
                    <video
                        ref={videoRef}
                        src={videoUrl}
                        className="w-full h-full object-contain md:object-contain"
                        style={{ backgroundColor: '#000', height: '100%', width: '100%' }}
                        playsInline
                        autoPlay
                        muted={isMuted}
                        webkit-playsinline="true"
                        crossOrigin="anonymous"
                        onEnded={handleVideoEnded}
                        onTimeUpdate={(e) => {
                            const time = e.target.currentTime;
                            setCurrentTime(time);
                            
                            // Rating trigger: 95% of the movie
                            if (duration > 60 && time > duration * 0.95 && !showRatingOverlay && userRating === 0) {
                                setShowRatingOverlay(true);
                            }
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
                        onError={handleVideoError}
                    >
                        {selectedSubtitle && (
                            <track 
                                key={selectedSubtitle.id}
                                label={selectedSubtitle.label}
                                kind="subtitles"
                                srcLang={selectedSubtitle.lang}
                                src={selectedSubtitle.url}
                                default
                            />
                        )}
                    </video>
                ) : (
                    <div className="flex flex-col items-center gap-4">
                        <Loader2 className="text-cyan-500 animate-spin" size={40} />
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Iniciando Bóveda...</span>
                    </div>
                )}
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
                <div className={`absolute ${showControls ? 'bottom-32' : 'bottom-16'} left-0 right-0 flex justify-center pointer-events-none px-4 z-[1001] transition-all duration-300`}>
                    <div className="bg-black/80 px-4 py-2 rounded-lg max-w-[90%] text-center border border-white/5 backdrop-blur-md">
                        <p className={`font-black tracking-tight drop-shadow-lg ${
                            subtitleSettings.size === 'small' ? 'text-sm md:text-base' :
                            subtitleSettings.size === 'large' ? 'text-2xl md:text-4xl' :
                            subtitleSettings.size === 'extra' ? 'text-4xl md:text-6xl' :
                            'text-lg md:text-2xl' // medium
                        } ${
                            subtitleSettings.color === 'yellow' ? 'text-yellow-400' :
                            subtitleSettings.color === 'cyan' ? 'text-cyan-400' :
                            'text-white'
                        }`}>
                            {currentSubtitle.text}
                        </p>
                    </div>
                </div>
            )}

            {/* Center unmute button for mobile - Premium style */}
            {isMuted && isPlaying && !isLocked && !isDisplayLoading && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[1001] animate-in fade-in duration-700">
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
                        className="pointer-events-auto flex flex-col items-center gap-4 group"
                    >
                        <div className="w-20 h-20 bg-cyan-500/10 backdrop-blur-xl border border-cyan-500/30 rounded-full flex items-center justify-center shadow-[0_0_50px_rgba(6,182,212,0.2)] group-hover:scale-110 group-active:scale-95 transition-all duration-500">
                            <Volume2 size={32} className="text-cyan-400" fill="currentColor" />
                        </div>
                        <div className="bg-black/40 backdrop-blur-md px-5 py-2 rounded-full border border-white/5">
                            <p className="text-[10px] font-black text-white uppercase tracking-[0.3em]">Activar Sonido</p>
                        </div>
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

            {movie?.drive_file_id === 'pending_cloud' && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-950/90 z-[1010] p-8 text-center animate-in fade-in duration-500">
                    <div className="max-w-md space-y-6">
                        <div className="relative w-24 h-24 mx-auto">
                            <div className="absolute inset-0 border-4 border-cyan-500/10 rounded-full"></div>
                            <div className="absolute inset-0 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Cloud size={32} className="text-cyan-500 animate-pulse" />
                            </div>
                        </div>
                        
                        <div className="space-y-2">
                            <h2 className="text-2xl font-black text-white uppercase tracking-tight">Procesado en Progreso</h2>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] italic">Bóveda Global</p>
                        </div>
                        
                        <p className="text-sm text-slate-400 font-medium leading-relaxed">
                            Esta película se está descargando y optimizando para tu Bóveda. 
                            <button 
                                onClick={() => {
                                    onClose(0);
                                    if (onOpenSettings) onOpenSettings();
                                }}
                                className="block mt-2 text-cyan-400/80 font-black uppercase text-[9px] tracking-widest hover:text-cyan-300 transition-colors cursor-pointer"
                            >
                                Estará disponible en unos minutos.
                            </button>
                        </p>
                        
                        <button 
                            onClick={() => onClose(0)}
                            className="px-8 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-white text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
                        >
                            Cerrar y esperar
                        </button>
                    </div>
                </div>
            )}

            {isDisplayLoading && !error && movie?.drive_file_id !== 'pending_cloud' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/90 z-10 transition-colors">
                    <div className="text-center p-6">
                        <div className="relative">
                            <Loader2 className="text-cyan-500 animate-spin w-16 h-16 mx-auto mb-6" />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Film size={20} className="text-cyan-500/40" />
                            </div>
                        </div>
                        <p className="text-white font-black uppercase tracking-[0.3em] text-[10px] animate-pulse">Conectando Bóveda...</p>
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
                className={`absolute top-[max(1rem,env(safe-area-inset-top))] left-[max(1rem,env(safe-area-inset-left))] p-3 bg-black/50 backdrop-blur-sm rounded-full text-white/80 hover:text-white transition-all z-[1001] active:scale-90 ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'}`}
            >
                <X size={isMobile ? 24 : 28} />
            </button>

            {subQuotaReached && (
                <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1100] animate-in slide-in-from-top-10 duration-500 w-[90%] max-w-md">
                    <div className="glass-card px-6 py-5 rounded-3xl border border-netflix-red/30 bg-netflix-red/10 flex flex-col gap-4 shadow-2xl backdrop-blur-xl">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-netflix-red/20 rounded-full">
                                <AlertCircle className="text-netflix-red" size={24} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-black uppercase tracking-widest text-white">Límite de Subtítulos Alcanzado</p>
                                <p className="text-[10px] font-bold text-slate-400 mt-0.5 leading-relaxed">
                                    OpenSubtitles ha limitado las descargas. Si tienes VIP, asegúrate de haber guardado tus credenciales en Ajustes.
                                </p>
                            </div>
                            <button onClick={() => setSubQuotaReached(false)} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
                                <X size={18} className="text-slate-500" />
                            </button>
                        </div>
                        
                        <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
                            {(() => {
                                const raw = (movie?.file_name || movie?.official_title || "").toLowerCase();
                                const tags = [
                                    "1080p", "720p", "2160p", "4k", 
                                    "bluray", "brrip", "webrip", "web-dl", "dvdrip",
                                    "x264", "x265", "h264", "hevc",
                                    "yts", "rarbg", "psa", "lama", "tigole"
                                ].filter(t => raw.includes(t.toLowerCase()));
                                
                                if (tags.length === 0) return <span className="text-[9px] font-bold text-slate-600 italic">No se detectaron etiquetas técnicas</span>;
                                
                                return tags.map(tag => (
                                    <span key={tag} className="px-2 py-1 bg-white/5 border border-white/10 rounded-lg text-[9px] font-black uppercase tracking-wider text-cyan-400">
                                        {tag}
                                    </span>
                                ));
                            })()}
                        </div>
                        
                        <p className="text-[9px] font-bold text-slate-500 italic text-center">
                            Busca en Subdivx o YTS estas etiquetas junto al título.
                        </p>
                    </div>
                </div>
            )}

            {showControls && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-4 md:p-8">
                    <div className="flex flex-col gap-4 w-full">
                        <div className="flex items-center justify-between text-white text-[10px] md:text-xs font-black uppercase tracking-widest opacity-60 px-1">
                            <span>{formatTime(currentTime)}</span>
                            <span>
                                {(() => {
                                    const metaRuntime = Number(activeMovie.runtime || 0) * 60;
                                    
                                    // COMMON SENSE VALIDATION: 
                                    // If mobile reports a tiny duration (like 1s) but metadata says it's a long movie, 
                                    // ignore the mobile duration until it becomes realistic.
                                    const isDurationSuspicious = duration > 0 && duration < 600 && metaRuntime > 600;
                                    const effectiveDuration = (duration > 1 && duration !== Infinity && !isDurationSuspicious) ? duration : metaRuntime;
                                    
                                    const remaining = Math.max(0, effectiveDuration - currentTime);
                                    return effectiveDuration > 0 ? `-${formatTime(remaining)}` : '--:--';
                                })()}
                            </span>
                        </div>
                        
                        {(() => {
                            const metaRuntime = Number(activeMovie.runtime || 0) * 60;
                            const isDurationSuspicious = duration > 0 && duration < 600 && metaRuntime > 600;
                            const validDuration = (duration > 1 && duration !== Infinity && !isDurationSuspicious) ? duration : 0;
                            
                            // Use actual duration, or movie metadata runtime
                            let totalDuration = validDuration > 0 ? validDuration : metaRuntime;
                            
                            // SAFETY: Only show progress if we have a real duration > 0
                            const progressPercent = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;
                            const safeMax = totalDuration > 0 ? totalDuration : 100;
                            
                            return (
                                <input
                                    type="range"
                                    min="0"
                                    max={safeMax}
                                    value={currentTime}
                                    onChange={handleSeek}
                                    className="w-full h-1.5 md:h-2 bg-white/30 rounded-full appearance-none cursor-pointer accent-cyan-500 disabled:cursor-not-allowed"
                                    style={{ 
                                        background: `linear-gradient(to right, #06b6d4 ${Math.min(100, progressPercent)}%, rgba(255,255,255,0.1) 0%)` 
                                    }}
                                />
                            );
                        })()}
                        
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
                                
                                <button onClick={() => { setShowSubtitleMenu(!showSubtitleMenu); setShowVersionMenu(false); setShowControls(true); }} className={'p-3 rounded-full transition-colors ' + (selectedSubtitle ? 'text-cyan-400 bg-cyan-400/20' : 'text-white/70 hover:text-white')}>
                                    <Subtitles size={isMobile ? 24 : 28} />
                                </button>

                                {versions.length > 1 && (
                                    <button onClick={() => { setShowVersionMenu(!showVersionMenu); setShowSubtitleMenu(false); setShowControls(true); }} className={'p-3 rounded-full transition-colors ' + (showVersionMenu ? 'text-netflix-red bg-netflix-red/20' : 'text-white/70 hover:text-white')}>
                                        <Film size={isMobile ? 24 : 28} />
                                    </button>
                                )}
                                
                                <button onClick={toggleFullscreen} className="p-3 text-white/70 hover:text-white transition-colors active:scale-90">
                                    <Maximize size={isMobile ? 24 : 28} />
                                </button>
                                <button 
                                    onClick={() => { setShowQualityMenu(true); resetTimer(); }}
                                    className="p-3 hover:bg-white/10 rounded-full transition-colors text-white relative group"
                                >
                                    <Settings size={22} className="group-hover:rotate-45 transition-transform duration-300" />
                                    <span className="absolute -top-1 -right-1 bg-netflix-red text-[8px] font-black px-1 rounded-sm">{quality}p</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Sidebar Menu (Subtitles / Versions / Quality) */}
            {(showSubtitleMenu || showVersionMenu || showQualityMenu) && (
                <div 
                    className="absolute inset-0 z-[60] bg-black/40 backdrop-blur-sm flex justify-end"
                    onClick={() => { setShowSubtitleMenu(false); setShowVersionMenu(false); setShowQualityMenu(false); }}
                >
                    <div 
                        className="w-full max-w-[320px] h-full bg-slate-900/95 backdrop-blur-xl border-l border-white/10 shadow-2xl flex flex-col p-6 animate-in slide-in-from-right duration-500"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-center mb-8">
                            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-white/90">
                                {showSubtitleMenu ? 'Subtítulos' : showVersionMenu ? 'Versión' : 'Calidad'}
                            </h3>
                            <button 
                                onClick={() => { setShowSubtitleMenu(false); setShowVersionMenu(false); setShowQualityMenu(false); }} 
                                className="p-2 hover:bg-white/10 rounded-full text-white/40 transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-3">
                            {showQualityMenu && (
                                <div className="space-y-4">
                                    <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest px-1">Selecciona una calidad</p>
                                    {[
                                        { id: '480', label: '480p', desc: 'Fluido (Bajo consumo)', icon: 'SD' },
                                        { id: '720', label: '720p', desc: 'Alta Definición (HD)', icon: 'HD' },
                                        { id: '1080', label: '1080p', desc: 'Full HD (Máxima)', icon: 'FHD' }
                                    ].map((q) => (
                                        <button
                                            key={q.id}
                                            onClick={() => {
                                                setQuality(q.id);
                                                setShowQualityMenu(false);
                                                setIsLoading(true);
                                            }}
                                            className={`w-full text-left p-5 rounded-2xl flex items-center justify-between transition-all border ${
                                                quality === q.id 
                                                ? 'bg-cyan-500 border-cyan-500 text-black shadow-lg shadow-cyan-500/20' 
                                                : 'bg-white/5 border-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                                            }`}
                                        >
                                            <div className="flex flex-col">
                                                <span className="text-sm font-black italic">{q.label}</span>
                                                <span className="text-[9px] opacity-60 uppercase tracking-tighter font-bold">{q.desc}</span>
                                            </div>
                                            <span className="text-[10px] font-black opacity-40">{q.icon}</span>
                                        </button>
                                    ))}
                                    <div className="p-4 bg-amber-500/10 rounded-2xl border border-amber-500/20 flex items-start gap-3 mt-8">
                                        <AlertCircle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                                        <p className="text-[9px] text-amber-200/60 leading-relaxed uppercase font-bold">
                                            Las calidades altas (1080p) pueden causar tirones si el servidor tiene mucha carga o tu internet es inestable.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {showVersionMenu && versions.map((ver) => {
                                const vInfo = detectVersionInfo(ver);
                                const isSelected = String(ver.id) === String(movie.id);
                                return (
                                    <button
                                        key={ver.id}
                                        onClick={() => {
                                            if (onVersionChange) onVersionChange(ver);
                                            setShowVersionMenu(false);
                                        }}
                                        className={`w-full text-left p-5 rounded-[1.5rem] text-xs font-black uppercase tracking-widest transition-all border ${
                                            isSelected 
                                            ? 'bg-netflix-red border-netflix-red text-white shadow-[0_10px_30px_rgba(229,9,20,0.3)]' 
                                            : 'bg-white/5 border-white/5 text-slate-400 hover:bg-white/10 hover:text-white'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span>{vInfo.label}</span>
                                            {isSelected && <div className="w-2 h-2 bg-white rounded-full"></div>}
                                        </div>
                                    </button>
                                );
                            })}

                            {showSubtitleMenu && (
                                <>
                                    <div className="grid grid-cols-2 gap-2 mb-4">
                                        <button 
                                            onClick={() => fileInputRef.current?.click()}
                                            className="flex flex-col items-center gap-1.5 p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-all border border-white/5"
                                        >
                                            <Upload size={16} className="text-cyan-400" />
                                            <span className="text-[8px] font-black uppercase tracking-wider text-white/50">Subir Local</span>
                                        </button>
                                        <button 
                                            onClick={() => { setShowDriveExplorer(true); setShowSubtitleMenu(false); }}
                                            className="flex flex-col items-center gap-1.5 p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-all border border-white/5"
                                        >
                                            <Cloud size={16} className="text-cyan-400" />
                                            <span className="text-[8px] font-black uppercase tracking-wider text-white/50">G. Drive</span>
                                        </button>
                                    </div>

                                    <button
                                        onClick={() => { setSelectedSubtitle(null); setSubtitleCues([]); setSubtitleOffset(0); setShowSubtitleMenu(false); }}
                                        className={`w-full text-left p-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${!selectedSubtitle ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/20' : 'bg-white/5 text-slate-400 hover:text-white'}`}
                                    >
                                        Sin Subtítulos
                                    </button>
                                    
                                    {subtitles.map((sub, i) => (
                                        <button
                                            key={i}
                                            onClick={() => { handleSubtitleSelect(sub); setShowSubtitleMenu(false); }}
                                            className={`w-full text-left p-2.5 rounded-lg text-[10px] flex flex-col gap-0.5 transition-all border ${selectedSubtitle?.id === sub.id ? 'bg-white/10 border-cyan-500/50' : 'bg-transparent border-white/5 text-white/70 hover:bg-white/5 hover:text-white'}`}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className={selectedSubtitle?.id === sub.id ? 'text-cyan-400 font-black' : 'font-bold line-clamp-1'}>
                                                    {sub.file_name || sub.label}
                                                </span>
                                            </div>
                                            {sub.release && sub.release !== sub.label && (
                                                <span className="text-[8px] opacity-40 truncate uppercase tracking-tighter">{sub.release}</span>
                                            )}
                                        </button>
                                    ))}
                                </>
                            )}
                        </div>

                        {showSubtitleMenu && (
                            <div className="mt-4 pt-4 border-t border-white/10 space-y-4">
                                <div className="flex flex-col gap-2 px-1">
                                    <span className="text-[9px] font-black uppercase text-white/30 tracking-widest text-center">Sincronización</span>
                                    <div className="flex items-center justify-between bg-black/40 p-1.5 rounded-xl border border-white/5">
                                        <button 
                                            onClick={() => setSubtitleOffset(prev => prev - 0.5)}
                                            className="w-10 h-10 flex items-center justify-center bg-white/5 rounded-lg text-white hover:bg-white/10 active:scale-90 transition-all text-lg font-bold"
                                        >
                                            -
                                        </button>
                                        <span className={`text-[10px] font-black min-w-[3.5rem] text-center ${subtitleOffset !== 0 ? 'text-cyan-400' : 'text-white/40'}`}>
                                            {subtitleOffset > 0 ? '+' : ''}{subtitleOffset.toFixed(1)}s
                                        </span>
                                        <button 
                                            onClick={() => setSubtitleOffset(prev => prev + 0.5)}
                                            className="w-10 h-10 flex items-center justify-center bg-white/5 rounded-lg text-white hover:bg-white/10 active:scale-90 transition-all text-lg font-bold"
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="relative group">
                                        <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                                            <Search size={14} className="text-white/20 group-focus-within:text-cyan-400 transition-colors" />
                                        </div>
                                        <input 
                                            type="text"
                                            value={subtitleSearchText}
                                            onChange={(e) => setSubtitleSearchText(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleSearchSubtitles()}
                                            placeholder="Buscar otro título..."
                                            className="w-full bg-white/5 border border-white/5 rounded-xl py-3 pl-10 pr-4 text-[10px] text-white placeholder:text-white/20 focus:outline-none focus:border-cyan-500/50 focus:bg-white/10 transition-all"
                                        />
                                    </div>
                                    <button
                                        onClick={handleSearchSubtitles}
                                        disabled={isSearchingSubtitles}
                                        className="w-full py-3.5 bg-cyan-500/10 hover:bg-cyan-500/20 rounded-xl text-cyan-400 text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-50 border border-cyan-500/20 flex items-center justify-center gap-2"
                                    >
                                        {isSearchingSubtitles ? (
                                            <>
                                                <Loader2 size={14} className="animate-spin" />
                                                Buscando...
                                            </>
                                        ) : (
                                            <>
                                                <Subtitles size={14} />
                                                {subtitleSearchText ? 'Buscar Subtítulos' : 'Buscar Mejores Subtítulos'}
                                            </>
                                        )}
                                    </button>
                                </div>

                                <div className="space-y-4 pt-4 border-t border-white/10">
                                    <div className="flex flex-col gap-2">
                                        <span className="text-[9px] font-black uppercase text-white/30 tracking-widest text-center">Tamaño de Texto</span>
                                        <div className="grid grid-cols-4 gap-1 p-1 bg-black/40 rounded-xl border border-white/5">
                                            {[
                                                { id: 'small', label: 'T', size: 'text-[8px]' },
                                                { id: 'medium', label: 'T', size: 'text-[10px]' },
                                                { id: 'large', label: 'T', size: 'text-[13px]' },
                                                { id: 'extra', label: 'T', size: 'text-[16px]' }
                                            ].map((s) => (
                                                <button
                                                    key={s.id}
                                                    onClick={() => updateSubtitleSettings({ size: s.id })}
                                                    className={`py-1.5 rounded-lg flex items-center justify-center transition-all ${
                                                        subtitleSettings.size === s.id 
                                                        ? 'bg-white/10 text-white shadow-inner' 
                                                        : 'text-white/30 hover:text-white/60'
                                                    }`}
                                                >
                                                    <span className={`font-black ${s.size}`}>{s.label}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-2">
                                        <span className="text-[9px] font-black uppercase text-white/30 tracking-widest text-center">Color</span>
                                        <div className="flex justify-center gap-3">
                                            {[
                                                { id: 'white', color: 'bg-white' },
                                                { id: 'yellow', color: 'bg-yellow-400' },
                                                { id: 'cyan', color: 'bg-cyan-500' }
                                            ].map((c) => (
                                                <button
                                                    key={c.id}
                                                    onClick={() => updateSubtitleSettings({ color: c.id })}
                                                    className={`w-7 h-7 rounded-full border-2 transition-all ${
                                                        subtitleSettings.color === c.id 
                                                        ? 'border-white scale-110' 
                                                        : 'border-white/10 scale-100 hover:scale-105'
                                                    } ${c.color}`}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}


            {showDriveExplorer && (
                <DriveExplorer 
                    onClose={() => setShowDriveExplorer(false)} 
                    onSelect={(file) => {
                        handleSubtitleSelect({
                            id: file.id,
                            label: 'Drive: ' + file.name,
                            file_name: file.name,
                            type: 'drive'
                        });
                        setShowDriveExplorer(false);
                    }}
                />
            )}
            {/* DEBUG OVERLAY (Simplified for mobile performance) */}
            {error && (
                <div className="absolute inset-0 z-[1000] bg-black flex items-center justify-center p-6 md:p-12 overflow-y-auto">
                    <div className="max-w-2xl w-full bg-zinc-900 border border-red-500/30 rounded-3xl p-8 md:p-12 shadow-2xl relative">
                        <button 
                            onClick={onClose}
                            className="absolute top-6 right-6 p-3 bg-white/5 hover:bg-white/10 rounded-full transition-colors text-white"
                        >
                            <X size={24} />
                        </button>

                        <div className="flex items-center gap-4 mb-8 text-red-500">
                            <AlertCircle size={40} />
                            <h2 className="text-3xl font-black uppercase italic tracking-tighter">Error de Reproducción</h2>
                        </div>

                        <div className="space-y-6">
                            <div className="p-6 bg-black/50 rounded-2xl border border-red-500/20">
                                <p className="text-red-400 font-bold mb-2">Mensaje:</p>
                                <p className="text-white font-mono text-sm break-words">
                                    {typeof error === 'string' ? error : (error.message || 'Error desconocido')}
                                </p>
                            </div>

                            {error.stack && (
                                <div className="p-6 bg-black/50 rounded-2xl border border-white/5">
                                    <p className="text-slate-500 font-bold mb-2 uppercase text-[10px] tracking-widest">Stack Trace:</p>
                                    <pre className="text-slate-300 font-mono text-[10px] overflow-x-auto max-h-40 whitespace-pre-wrap">
                                        {error.stack}
                                    </pre>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                                    <p className="text-[10px] text-slate-500 uppercase font-black mb-1">Dispositivo</p>
                                    <p className="text-xs text-white font-bold">{isMobile ? 'Móvil / Tablet' : 'Desktop'}</p>
                                </div>
                                <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                                    <p className="text-[10px] text-slate-500 uppercase font-black mb-1">Transcodificación</p>
                                    <p className="text-xs text-white font-bold">{useTranscoding ? 'SÍ (Activa)' : 'NO (Directo)'}</p>
                                </div>
                            </div>

                            <div className="pt-6 border-t border-white/5 flex flex-col gap-4">
                                <button 
                                    onClick={() => window.location.reload()}
                                    className="w-full py-5 bg-white text-black font-black uppercase tracking-widest rounded-2xl hover:scale-[1.02] active:scale-95 transition-all"
                                >
                                    Reiniciar Aplicación
                                </button>
                                <button 
                                    onClick={() => {
                                        const errorStr = typeof error === 'string' ? error : (error.message || 'Error desconocido');
                                        const text = `Error: ${errorStr}\nDevice: ${isMobile ? 'Mobile' : 'Desktop'}\nTranscoding: ${useTranscoding}\nUrl: ${videoUrl}\nStack: ${error.stack || 'No stack'}`;
                                        navigator.clipboard.writeText(text);
                                        alert('Copiado al portapapeles');
                                    }}
                                    className="w-full py-5 bg-white/5 text-white font-bold uppercase tracking-widest rounded-xl border border-white/10 hover:bg-white/10 transition-all active:scale-95"
                                >
                                    Copiar Diagnóstico para Soporte
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {showRatingOverlay && (
                <div className="absolute inset-0 z-[2000] bg-zinc-950/95 backdrop-blur-2xl flex items-center justify-center p-6">
                    <div className="max-w-md w-full text-center space-y-10 animate-in fade-in zoom-in duration-500">
                        <div className="relative inline-block">
                             <div className="absolute -inset-4 bg-cyan-500/20 blur-3xl rounded-full" />
                             <Film className="relative text-cyan-500 mx-auto mb-4" size={48} />
                             <h2 className="relative text-4xl md:text-5xl font-black text-white uppercase italic tracking-tighter leading-none">¿Qué te pareció?</h2>
                        </div>
                        
                        <p className="text-white/40 uppercase text-[11px] font-black tracking-[0.3em] max-w-[280px] mx-auto leading-relaxed">
                            Tu valoración ayuda a mejorar la biblioteca
                        </p>

                        <div className="flex justify-center gap-3">
                            {[1, 2, 3, 4, 5].map((star) => (
                                <button
                                    key={star}
                                    onMouseEnter={() => setHoverRating(star)}
                                    onMouseLeave={() => setHoverRating(0)}
                                    onClick={() => handleRating(star)}
                                    className="group relative p-2 transition-all hover:scale-125 active:scale-90 disabled:opacity-50"
                                    disabled={isSavingRating}
                                >
                                    {/* Star Glow */}
                                    {(hoverRating || userRating) >= star && (
                                        <div className="absolute inset-0 bg-cyan-500/40 blur-xl rounded-full scale-75 group-hover:scale-100 transition-transform" />
                                    )}
                                    
                                    <Star 
                                        size={48} 
                                        fill={(hoverRating || userRating) >= star ? "#06b6d4" : "none"} 
                                        strokeWidth={1.5}
                                        className={`relative transition-all duration-300 ${
                                            (hoverRating || userRating) >= star 
                                            ? "text-cyan-500 drop-shadow-[0_0_15px_rgba(6,182,212,0.5)]" 
                                            : "text-white/20"
                                        }`}
                                    />
                                </button>
                            ))}
                        </div>

                        <div className="flex flex-col items-center gap-6 pt-4">
                            {userRating > 0 && !isSavingRating && (
                                <div className="px-4 py-2 bg-cyan-500/10 border border-cyan-500/20 rounded-full animate-in slide-in-from-bottom-2">
                                    <p className="text-cyan-400 text-[10px] font-black uppercase tracking-widest">¡Gracias por tu voto!</p>
                                </div>
                            )}
                            
                            <button 
                                onClick={onClose}
                                className="group flex items-center gap-2 text-white/30 hover:text-white uppercase text-[11px] font-black tracking-[0.2em] transition-all"
                            >
                                <span>Cerrar</span>
                                <X size={14} className="group-hover:rotate-90 transition-transform" />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default VideoPlayer;