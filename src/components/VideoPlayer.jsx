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
    const [quality, setQuality] = useState('original'); // Default to original (direct streaming)
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

    // Available qualities based on video metadata
    const availableQualities = useMemo(() => {
        const qualities = [];
        const height = movie.video_height || 0;
        
        if (height >= 1080) qualities.push({ id: '1080', label: '1080p', desc: 'Full HD (Máxima)' });
        if (height >= 720) qualities.push({ id: '720', label: '720p', desc: 'Alta Definición (HD)' });
        qualities.push({ id: '480', label: '480p', desc: 'Fluido (Bajo consumo)' });
        qualities.push({ id: 'original', label: `Original (${movie.original_resolution || '...'})`, desc: 'Directo (Sin transcodificar)' });
        
        return qualities;
    }, [movie.video_height, movie.original_resolution]);

    // Determine if we need transcoding based on selected quality vs video metadata
    const needsTranscoding = useMemo(() => {
        if (quality === 'original') return false; // Never transcode if "original"
        
        const vidCodec = (movie.video_codec || '').toLowerCase();
        const audCodec = (movie.audio_codec || '').toLowerCase();
        
        // Compatible codecs with browsers
        const isVideoCompatible = ['h264', 'avc1', 'avc2', 'vp8', 'vp9', 'av1'].some(c => vidCodec.includes(c));
        const isAudioCompatible = ['aac', 'mp3', 'opus', 'vorbis'].some(c => audCodec.includes(c));
        
        // If already compatible and selected quality >= original height -> No transcode
        if (isVideoCompatible && isAudioCompatible) {
            const height = movie.video_height || 0;
            if (height <= parseInt(quality)) return false; // Original is good enough
        }
        
        // Otherwise, we need transcode
        return !isVideoCompatible || !isAudioCompatible;
    }, [quality, movie.video_codec, movie.audio_codec, movie.video_height]);

    // Build video URL - Smart transcoding based on compatibility
    const videoUrl = useMemo(() => {
        if (streamSource === 'checking' || streamSource === 'error') return '';
        
        // Don't include quality in deps if we don't need transcoding
        // This avoids unnecessary video reloads when quality changes but no transcoding needed
        if (streamSource === 'cloud') {
            return api.getCloudStreamUrl(movie.id);
        } else if (streamSource === 'drive') {
            return api.getStreamUrl(movie.drive_file_id, movie.file_path, { 
                transcode: needsTranscoding,
                seekOffset,
                quality: needsTranscoding ? quality : null // Only pass quality if transcoding
            });
        } else if (streamSource === 'local') {
            return api.getStreamUrl(null, movie.file_path, { 
                transcode: needsTranscoding, 
                seekOffset,
                quality: needsTranscoding ? quality : null
            });
        }
        return '';
    }, [movie.id, movie.drive_file_id, movie.file_path, movie.video_codec, movie.audio_codec, movie.video_height, streamSource, needsTranscoding, quality, seekOffset]);

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

    // Handle video loaded data event
    const handleLoadedData = () => {
        setIsLoading(false);
        console.log('[VideoPlayer] Video loaded, isLoading=false');
    };

    // Video initialization - reset loading state when URL changes
    useEffect(() => {
        if (!videoUrl || streamingMode !== 'classic') return;
        
        setIsLoading(true);
        
        // Safety timeout: if video takes >15s, force-clear loading
        const safetyTimer = setTimeout(() => {
            console.warn('[VideoPlayer] Timeout: forcing isLoading=false');
            setIsLoading(false);
        }, 15000);
        
        return () => clearTimeout(safetyTimer);
    }, [videoUrl, streamingMode]);

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

    const handleLoadedMetadata = (e) => {
        setIsInitializing(false);
        if (videoRef.current) {
            videoRef.current.preload = 'auto';
        }
    };

    const handleCanPlay = () => {
        setIsLoading(false);
        const video = videoRef.current;
        if (!video) return;
        
        // Perform initial seek once
        if (!initialSeekPerformed.current && seekOffset > 0) {
            console.log(`[VideoPlayer] Initial seek to: ${seekOffset}s`);
            video.currentTime = seekOffset;
            initialSeekPerformed.current = true;
        }
        // Let autoPlay handle playback — no manual play() call to avoid race condition
        setIsPlaying(!video.paused);
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
                url = BACKEND_URL + '/api/subtitles/download?id=' + subtitle.id;
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
            onClick={handleVideoClick}
            onTouchStart={resetTimer}
        >
            <div className="flex-1 flex items-center justify-center bg-black relative">
                {delayedMount ? (
                    <video
                        ref={videoRef}
                        className="w-full h-full object-contain md:object-contain"
                        style={{ backgroundColor: '#000', height: '100%', width: '100%' }}
                        playsInline
                        autoPlay
                        muted={isMuted}
                        webkit-playsinline="true"
                        src={videoUrl}
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
                        onPause={(e) => {
                            setIsPlaying(false);
                            if (user && movie?.id && e.target.currentTime > 0) {
                                saveUserProgress(movie.id, Math.floor(e.target.currentTime));
                            }
                        }}
                        onPlay={() => setIsPlaying(true)}
                        onError={handleVideoError}
                        onSeeking={() => {}}
                        onSeeked={() => {}}
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
                        <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">Iniciando Bóveda...</span>
                    </div>
                )}
                
                {/* Subtitle Display */}
                {currentSubtitle && (
                    <div 
                        className={`absolute bottom-[10%] left-1/2 -translate-x-1/2 bg-black/80 px-6 py-3 rounded-2xl max-w-[80%] text-center pointer-events-none transition-opacity duration-300 ${
                            showControls ? 'opacity-0' : 'opacity-100'
                        }`}
                        style={{
                            fontSize: subtitleSettings.size === 'small' ? '14px' : 
                                     subtitleSettings.size === 'medium' ? '18px' : 
                                     subtitleSettings.size === 'large' ? '24px' : '30px',
                            color: subtitleSettings.color === 'yellow' ? '#FFD700' : 
                                     subtitleSettings.color === 'cyan' ? '#22D3EE' : 'white'
                        }}
                    >
                        {currentSubtitle.text}
                    </div>
                )}
            </div>

            {/* Playback seems stuck overlay */}
            {isStuckAtZero && isPlaying && !isLoading && !isInitializing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/90 z-[1010] animate-in fade-in duration-500">
                    <div className="flex flex-col gap-4 w-full max-w-md">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-3 bg-netflix-red/20 rounded-full">
                                    <AlertCircle className="text-netflix-red" size={24} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-[11px] font-bold uppercase tracking-wider text-white">Reproducción trabada</p>
                                    <p className="text-[10px] font-bold text-slate-400 mt-0.5 leading-relaxed">
                                        Parece que el video no puede reproducirse. Intenta cambiar la calidad o verifica tu conexión.
                                    </p>
                                </div>
                            </div>
                            <button onClick={() => setShowControls(true)} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
                                <X size={18} className="text-slate-500" />
                            </button>
                        </div>
                        
                        <button 
                            onClick={() => {
                                if (user && movie?.id && currentTime > 0) {
                                    saveUserProgress(movie.id, Math.floor(currentTime));
                                }
                                onClose(currentTime);
                            }}
                            className="w-full p-3 bg-netflix-red/20 hover:bg-netflix-red/30 border border-netflix-red/30 rounded-2xl text-white text-[10px] font-bold uppercase tracking-wider transition-colors active:scale-95"
                        >
                            Saltar y Salir
                        </button>
                    </div>
                </div>
            )}

            {/* Initializing overlay */}
            {isInitializing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/90 z-[1010]">
                    <div className="text-center p-6">
                        <div className="relative w-20 h-20 mx-auto mb-4">
                            <div className="absolute inset-0 border-4 border-cyan-500/10 rounded-full"></div>
                            <div className="absolute inset-0 border-4 border-t-cyan-500 rounded-full animate-spin"></div>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Film size={32} className="text-cyan-500 animate-pulse" />
                            </div>
                        </div>
                        <p className="text-white font-bold uppercase tracking-[0.3em]">Cargando Película</p>
                        <p className="text-[10px] font-medium text-slate-400 mt-2 leading-relaxed italic">
                            Conectando con el servidor de streaming...
                        </p>
                    </div>
                </div>
            )}

            {/* Loading overlay */}
            {isDisplayLoading && !isInitializing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/90 z-[1010]">
                    <div className="text-center p-6">
                        <Loader2 className="w-16 h-16 text-cyan-500 mx-auto mb-6 animate-spin" />
                        <p className="text-white font-bold uppercase tracking-[0.3em]">Cargando Video</p>
                        <p className="text-[10px] font-medium text-slate-400 mt-2 leading-relaxed">
                            Esto puede tardar unos segundos...
                        </p>
                    </div>
                </div>
            )}

            {/* Error overlay */}
            {error && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/90 z-[1010] animate-in fade-in duration-500">
                    <div className="glass-card px-6 py-5 rounded-3xl border border-netflix-red/30 bg-netflix-red/10 flex flex-col gap-4 shadow-2xl backdrop-blur-xl">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-netflix-red/20 rounded-full">
                                <AlertCircle className="text-netflix-red" size={24} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-bold uppercase tracking-wider text-white">{error}</p>
                                {error.stack && (
                                    <p className="text-[9px] font-bold text-slate-400 mt-0.5 leading-relaxed">
                                        {error.stack.substring(0, 100)}
                                    </p>
                                )}
                            </div>
                            <button onClick={() => {
                                if (user && movie?.id && currentTime > 0) {
                                    saveUserProgress(movie.id, Math.floor(currentTime));
                                }
                                onClose(currentTime);
                            }} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
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
                                    <span key={tag} className="px-2 py-1 bg-white/5 border border-white/10 rounded-lg text-[9px] font-bold uppercase tracking-wider text-cyan-400">
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

            {/* Subtitle quota reached overlay */}
            {subQuotaReached && (
                <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1100] animate-in slide-in-from-top-10 duration-500 w-[90%] max-w-md">
                    <div className="glass-card px-6 py-5 rounded-3xl border border-netflix-red/30 bg-netflix-red/10 flex flex-col gap-4 shadow-2xl backdrop-blur-xl">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-netflix-red/20 rounded-full">
                                <AlertCircle className="text-netflix-red" size={24} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-bold uppercase tracking-wider text-white">Límite de Subtítulos Alcanzado</p>
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
                                    <span key={tag} className="px-2 py-1 bg-white/5 border border-white/10 rounded-lg text-[9px] font-bold uppercase tracking-wider text-cyan-400">
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

            {/* Bottom Controls */}
            {showControls && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-4 md:p-8">
                    <div className="flex flex-col gap-4 w-full">
                        <div className="flex items-center justify-between text-white text-[10px] md:text-xs font-bold uppercase tracking-widest opacity-60 px-1">
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
                            const effectiveDuration = (duration > 1 && duration !== Infinity && !isDurationSuspicious)
                                ? duration
                                : (metaRuntime > 0 ? metaRuntime : 0);
                            const clampedTime = Math.min(currentTime, effectiveDuration || currentTime);
                            const progressPct = effectiveDuration > 0 ? (clampedTime / effectiveDuration) * 100 : 0;
                            return (
                                <input
                                    type="range"
                                    min="0"
                                    max={effectiveDuration || 100}
                                    value={clampedTime}
                                    onChange={handleSeek}
                                    style={{ background: `linear-gradient(to right, #06b6d4 ${progressPct}%, rgba(255,255,255,0.2) ${progressPct}%)` }}
                                    className="w-full h-1 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:shadow-lg"
                                />
                            );
                        })()}

                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <button 
                                    onClick={togglePlay}
                                    className="p-2 hover:bg-white/10 rounded-full transition-colors active:scale-90"
                                >
                                    {isPlaying ? <Pause size={isMobile ? 24 : 28} /> : <Play size={isMobile ? 24 : 28} />}
                                </button>

                                <button onClick={skipBackward} className="p-2 hover:bg-white/10 rounded-full transition-colors active:scale-90">
                                    <SkipBack size={isMobile ? 20 : 24} />
                                </button>

                                <button onClick={skipForward} className="p-2 hover:bg-white/10 rounded-full transition-colors active:scale-90">
                                    <SkipForward size={isMobile ? 20 : 24} />
                                </button>

                                <div className="flex items-center gap-2 group">
                                    <button 
                                        onClick={toggleMute}
                                        className="p-2 hover:bg-white/10 rounded-full transition-colors active:scale-90"
                                    >
                                        {isMuted || volume === 0 ? <VolumeX size={isMobile ? 20 : 24} /> : <Volume2 size={isMobile ? 20 : 24} />}
                                    </button>
                                    <input 
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        value={isMuted ? 0 : volume}
                                        onChange={handleVolumeChange}
                                        style={{ background: `linear-gradient(to right, #06b6d4 ${(isMuted ? 0 : volume) * 100}%, rgba(255,255,255,0.2) ${(isMuted ? 0 : volume) * 100}%)` }}
                                        className="w-20 h-1 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
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
                                    <span className="absolute -top-1 -right-1 bg-netflix-red text-[8px] font-bold px-1 rounded-sm">{quality}p</span>
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
                            <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-white/90">
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
                                    {availableQualities.map((q) => (
                                        <button
                                            key={q.id}
                                            onClick={() => {
                                                setQuality(q.id);
                                                setShowQualityMenu(false);
                                                if (needsTranscoding) {
                                                    setIsLoading(true); // Only set loading if we actually need to transcode
                                                }
                                            }}
                                            className={`w-full text-left p-5 rounded-2xl flex items-center justify-between transition-all border ${
                                                quality === q.id 
                                                    ? 'bg-cyan-500 border-cyan-500 text-black shadow-lg shadow-cyan-500/20' 
                                                    : 'bg-white/5 border-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                                            }`}
                                        >
                                            <div className="flex flex-col">
                                                <span className="text-sm font-bold italic">{q.label}</span>
                                                <span className="text-[9px] opacity-60 uppercase tracking-tighter font-bold">{q.desc}</span>
                                            </div>
                                            <span className="text-[10px] font-bold opacity-40">{q.icon}</span>
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

                            {showSubtitleMenu && (
                                <div className="space-y-4">
                                    <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest px-1">Subtítulos encontrados</p>
                                    {isSearchingSubtitles ? (
                                        <div className="flex items-center gap-3 p-4 bg-white/5 rounded-2xl">
                                            <Loader2 size={18} className="text-cyan-400 animate-spin" />
                                            <span className="text-[10px] text-slate-400">Buscando...</span>
                                        </div>
                                    ) : subtitles.length > 0 ? (
                                        subtitles.map(sub => (
                                            <button
                                                key={sub.id}
                                                onClick={() => handleSubtitleSelect(sub)}
                                                className={`w-full text-left p-4 rounded-2xl transition-all border ${
                                                    selectedSubtitle?.id === sub.id 
                                                        ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400' 
                                                        : 'bg-white/5 border-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                                                }`}
                                            >
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-bold">{sub.label}</span>
                                                    <span className="text-[9px] opacity-60">{sub.lang || 'unknown'}</span>
                                                    {sub.provider && <span className="text-[8px] opacity-40 uppercase tracking-widest">{sub.provider}</span>}
                                                </div>
                                            </button>
                                        ))
                                    ) : (
                                        <p className="text-[10px] text-slate-600 text-center py-4">No se encontraron subtítulos. ¡Prueba buscar manualmente!</p>
                                    )}
                                    
                                    <div className="pt-4 border-t border-white/5 space-y-3">
                                        <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest px-1">Opciones</p>
                                        <button 
                                            onClick={handleSearchSubtitles}
                                            className="w-full p-4 bg-white/5 hover:bg-white/10 border border-white/5 rounded-2xl text-left transition-colors flex items-center gap-3"
                                        >
                                            <Search size={18} className="text-cyan-400" />
                                            <span className="text-sm">Buscar en línea</span>
                                        </button>
                                        <div className="relative">
                                            <button 
                                                onClick={() => document.getElementById('subtitleUpload')?.click()}
                                                className="w-full p-4 bg-white/5 hover:bg-white/10 border border-white/5 rounded-2xl text-left transition-colors flex items-center gap-3"
                                            >
                                                <Plus size={18} className="text-cyan-400" />
                                                <span className="text-sm">Cargar archivo local</span>
                                            </button>
                                            <input 
                                                id="subtitleUpload"
                                                type="file"
                                                accept=".srt,.vtt,.sub,.sbv,.ass"
                                                className="hidden"
                                                onChange={handleLocalSubtitleUpload}
                                            />
                                        </div>
                                        <div className="flex items-center gap-2 px-1">
                                            <input 
                                                type="text"
                                                value={subtitleSearchText}
                                                onChange={(e) => setSubtitleSearchText(e.target.value)}
                                                placeholder="Buscar por título..."
                                                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
                                            />
                                            <button 
                                                onClick={handleSearchSubtitles}
                                                className="p-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/30 rounded-lg text-cyan-400 transition-colors"
                                            >
                                                <Search size={16} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {showVersionMenu && (
                                <div className="space-y-4">
                                    <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest px-1">Versiones disponibles</p>
                                    {versions.map((v, i) => (
                                        <button
                                            key={v.id || i}
                                            onClick={() => {
                                                onVersionChange(v);
                                                setShowVersionMenu(false);
                                            }}
                                            className={`w-full text-left p-4 rounded-2xl transition-all border ${
                                                v.id === movie.id 
                                                    ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400' 
                                                    : 'bg-white/5 border-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                                            }`}
                                        >
                                            <div className="flex flex-col">
                                                <span className="text-sm font-bold">{v.official_title || v.detected_title}</span>
                                                <span className="text-[9px] opacity-60">{v.file_name || v.detected_year}</span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Lock/Unlock UI */}
            {!isLocked && (
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
            )}

            {isLocked && (
                <div className="absolute inset-0 z-[1002]">
                    {/* Interaction barrier to block video controls/clicks */}
                    <div className="absolute inset-0 bg-transparent" />
                    
                    {/* Small Lock Icon in Top Right */}
                    <div 
                        className={`absolute top-6 right-6 flex flex-col items-center gap-2 transition-all duration-500 cursor-pointer ${isUnlocking ? 'opacity-100 scale-110' : 'opacity-10'}`}
                        onClick={handleUnlockStart}
                        onMouseUp={handleUnlockEnd}
                        onMouseLeave={handleUnlockEnd}
                        onTouchStart={handleUnlockStart}
                        onTouchEnd={handleUnlockEnd}
                    >
                        <div className="relative w-16 h-16 flex items-center justify-center">
                            <div className="absolute inset-0 border-4 border-white/10 rounded-full"></div>
                            <div 
                                className="absolute inset-0 border-4 border-t-cyan-500 rounded-full animate-spin"
                                style={{ 
                                    borderTopColor: isUnlocking ? '#06b6d4' : 'transparent',
                                    transform: `rotate(${unlockProgress * 3.6}deg)`
                                }}
                            ></div>
                            <div className="relative z-10">
                                <Lock size={24} className="text-white" />
                            </div>
                        </div>
                        {isUnlocking && (
                            <span className="text-[10px] font-bold text-cyan-400">Suelta para desbloquear</span>
                        )}
                    </div>
                </div>
            )}

            {/* Rating Overlay */}
            {showRatingOverlay && (
                <div className="absolute inset-0 z-[1100] bg-black/80 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-500">
                    <div className="glass-card p-8 rounded-3xl max-w-sm w-full mx-4 text-center border border-cyan-500/20 shadow-2xl shadow-cyan-500/10">
                        <h3 className="text-lg font-black uppercase tracking-wider text-white mb-6">¿Qué te pareció?</h3>
                        <div className="flex justify-center gap-3 mb-8">
                            {[1, 2, 3, 4, 5].map(star => (
                                <button
                                    key={star}
                                    onClick={() => handleRating(star)}
                                    onMouseEnter={() => setHoverRating(star)}
                                    onMouseLeave={() => setHoverRating(0)}
                                    className={`p-2 rounded-full transition-all ${
                                        star <= (hoverRating || userRating) 
                                            ? 'text-yellow-400 scale-110' 
                                            : 'text-white/30 hover:text-yellow-400/50'
                                    }`}
                                >
                                    <Star size={40} fill={star <= (hoverRating || userRating) ? 'currentColor' : 'none'} />
                                </button>
                            ))}
                        </div>
                        {isSavingRating ? (
                            <Loader2 size={24} className="text-cyan-500 animate-spin mx-auto" />
                        ) : (
                            <button 
                                onClick={() => setShowRatingOverlay(false)}
                                className="text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-white transition-colors"
                            >
                                Omitir
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default VideoPlayer;
