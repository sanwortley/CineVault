import { useState, useRef, useEffect, useMemo } from 'react';
import {
    Play, Pause, Volume2, VolumeX, Maximize, X,
    Loader2, Subtitles, SkipBack, SkipForward, Lock, Unlock, Film,
    Plus, Cloud, Upload, AlertCircle, ExternalLink, Star, Settings, Search,
    MessageSquare, Check
} from 'lucide-react';
import { api, BACKEND_URL } from '../api';
import type { Movie, SubtitleSearchQuery, SubtitleSearchResponse, CloudSubtitleCheck } from '../types';
import { useAuth } from '../context/AuthContext';
import { detectVersionInfo } from '../utils/movieUtils';

type DetailMovie = Movie & { versions?: Movie[]; title?: string };

interface SubtitleEntry {
    id?: string | number
    label?: string
    type?: string
    path?: string
    provider?: string
    content?: string
    language?: string
    release?: string
    score?: number
    file_name?: string
}

interface AudioTrack {
    index: number
    language: string
    title: string
    codec: string
    default?: boolean
}

interface QualityOption {
    id: string
    label: string
    desc: string
}

interface SubtitleCue {
    start: number
    end: number
    text: string
}

interface DebugEntry {
    time: string
    msg: string
}

interface SubtitleSettings {
    size: string
    color: string
}

interface VideoPlayerProps {
    movie: DetailMovie
    onClose: (savedTime?: number) => void
    onOpenSettings: () => void
    onVersionChange: (movie: DetailMovie) => void
    userProgress?: Record<string, { duration?: number }>
}

function VideoPlayer({ movie, onClose, onOpenSettings, onVersionChange, userProgress = {} }: VideoPlayerProps) {
    const { user, saveUserProgress } = useAuth();
    const videoRef = useRef<HTMLVideoElement>(null!);
    const playerRef = useRef<HTMLDivElement>(null!);
    const [fullMovieData, setFullMovieData] = useState<DetailMovie | null>(null);

    useEffect(() => {
        if (!movie?.runtime && movie?.id) {
            console.log(`[VideoPlayer] Runtime missing for movie ${movie.id}, repairing...`);
            const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
            const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
            fetch(`${SUPABASE_URL}/rest/v1/movies?id=eq.${movie.id}&select=*`, {
                headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
            })
                .then(res => res.json())
                .then((data: DetailMovie[]) => {
                    if (data && data.length > 0) {
                        console.log(`[VideoPlayer] Metadata repaired for ${movie.id}: ${data[0].runtime} min`);
                        setFullMovieData(data[0]);
                    }
                })
                .catch((err: Error) => console.error('[VideoPlayer] Repair failed:', err));
        }
    }, [movie?.id, movie?.runtime]);

    const activeMovie = fullMovieData || movie;
    const isMobile = typeof window !== 'undefined' && (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768);
    const isSafari = typeof window !== 'undefined' && (
        /^((?!chrome|android).)*safari/i.test(navigator.userAgent) ||
        /iPhone|iPad|iPod/i.test(navigator.userAgent)
    );
    const isIOS = typeof window !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isAndroid = typeof window !== 'undefined' && /Android/i.test(navigator.userAgent);
    const useNativeControls = isIOS;
    const [isPlaying, setIsPlaying] = useState(true);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const [isLocked, setIsLocked] = useState(false);
    const [isUnlocking, setIsUnlocking] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [loadingProgress, setLoadingProgress] = useState(0);
    const [isStuckAtZero, setIsStuckAtZero] = useState(false);
    const [isInitializing, setIsInitializing] = useState(true);
    const [lastTap, setLastTap] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [dragTime, setDragTime] = useState(0);
    const [error, setError] = useState<{ message: string; stack?: string; code?: string | number; mediaError?: string; mimeCheck?: string } | null>(null);
    const [debugInfo, setDebugInfo] = useState<DebugEntry[]>([]);
    const [delayedMount] = useState(true);

    const addDebug = (msg: string) => {
        console.log(`[DEBUG] ${msg}`);
        setDebugInfo(prev => [...prev.slice(-20), { time: new Date().toLocaleTimeString(), msg }]);
    };

    useEffect(() => {
        const handleError = (e: ErrorEvent) => {
            const msg = e.error ? e.error.message : e.message;
            addDebug(`GLOBAL ERROR: ${msg}`);
            setError({ message: msg, stack: e.error?.stack });
        };
        const handleRejection = (e: PromiseRejectionEvent) => {
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

    const [useTranscoding, setUseTranscoding] = useState(false);
    const [localFileReady, setLocalFileReady] = useState(false);
    const [localFileDownloading, setLocalFileDownloading] = useState(false);
    const [streamingMode, setStreamingMode] = useState('classic');
    const [streamSource, setStreamSource] = useState<'checking' | 'drive' | 'local' | 'cloud' | 'error'>('checking');
    const [unlockProgress, setUnlockProgress] = useState(0);
    const unlockTimerRef = useRef<number | null>(null);

    const [subtitles, setSubtitles] = useState<SubtitleEntry[]>([]);
    const [selectedSubtitle, setSelectedSubtitle] = useState<SubtitleEntry | null>(null);
    const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
    const [selectedAudioTrack, setSelectedAudioTrack] = useState<AudioTrack | null>(null);
    const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
    const [showAudioMenu, setShowAudioMenu] = useState(false);
    const [showDriveExplorer, setShowDriveExplorer] = useState(false);
    const [isSearchingSubtitles, setIsSearchingSubtitles] = useState(false);
    const [subtitleSearchText, setSubtitleSearchText] = useState('');
    const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
    const [subtitleOffset, setSubtitleOffset] = useState(0);
    const [subtitleTrackUrl, setSubtitleTrackUrl] = useState<string | null>(null);
    const [subtitleTrackKey, setSubtitleTrackKey] = useState(0);
    const [subQuotaReached, setSubQuotaReached] = useState(false);

    const [showRatingOverlay, setShowRatingOverlay] = useState(false);
    const [userRating, setUserRating] = useState(0);
    const [isSavingRating, setIsSavingRating] = useState(false);
    const [hoverRating, setHoverRating] = useState(0);
    const [quality, setQuality] = useState('original');
    const [showQualityMenu, setShowQualityMenu] = useState(false);
    const [showVersionMenu, setShowVersionMenu] = useState(false);

    const [subtitleSettings, setSubtitleSettings] = useState<SubtitleSettings>(() => {
        const stored = localStorage.getItem('cinevault_subtitle_settings');
        if (stored) {
            try { return JSON.parse(stored); } catch { }
        }
        return { size: 'medium', color: 'white' };
    });

    const updateSubtitleSettings = (newSettings: Partial<SubtitleSettings>) => {
        const updated = { ...subtitleSettings, ...newSettings };
        setSubtitleSettings(updated);
        localStorage.setItem('cinevault_subtitle_settings', JSON.stringify(updated));
    };

    const adjustSubtitleOffset = (amount: number) => {
        setSubtitleOffset(prev => prev + amount);
    };
    const controlsTimeoutRef = useRef<number | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null!);

    const versions = movie.versions || [movie];
    const initialSeekPerformed = useRef(false);

    const progressObj = userProgress[String(movie?.id)];
    const movieUserProgress: number = (progressObj && typeof progressObj === 'object')
        ? (progressObj.duration ?? 0)
        : (progressObj ?? movie?.watched_duration ?? 0);

    const initialSeek = movieUserProgress > 0 ? Math.floor(movieUserProgress) : 0;
    const [seekOffset, setSeekOffset] = useState(initialSeek);

    useEffect(() => {
        console.log('🚀 [CineVault] Player Version 2.1 - Active');
        if (initialSeek > 0) {
            console.log(`[VideoPlayer] Progreso detectado para película ${movie.id}: ${initialSeek}s`);
        }
    }, [movie.id, initialSeek]);

    useEffect(() => {
        if (isMobile) {
            setIsMuted(true);
            if (videoRef.current) videoRef.current.muted = true;
        }
    }, [isMobile]);

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

    useEffect(() => {
        const resolveSource = async () => {
            setIsInitializing(true);
            setError(null);

            try {
                const hasDriveFile = !!movie.drive_file_id;
                const hasLocalFile = movie.file_path && movie.file_path.length > 0;

                if (hasDriveFile) {
                    if (movie.drive_file_id === 'pending_cloud') {
                        try {
                            const prog = await api.getDownloadProgress(movie.id) as { status?: string };
                            if (prog && prog.status && prog.status.includes('converting')) {
                                setStreamSource('error');
                                setError({ message: 'La película se está descargando en la nube. Por favor, espera un momento y vuelve a intentarlo.' });
                                return;
                            }
                        } catch (e) {
                            if (!movie.cloud_source_url) {
                                setStreamSource('error');
                                setError({ message: 'La película aún no está lista para reproducción instantánea.' });
                                return;
                            }
                        }
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
                    setError({ message: 'No se pudo encontrar la fuente del video.' });
                }
            } catch (err) {
                setError({ message: 'Error al inicializar la fuente de video.' });
            } finally {
                setIsInitializing(false);
            }
        };

        resolveSource();

        if (movie.drive_file_id === 'pending_cloud') {
            console.log('[VideoPlayer] Autocarga de subtítulos omitida: película en procesamiento.');
        } else {
            const autoLoadSubtitles = async () => {
                try {
                    const localRes = await api.findLocalSubtitle(movie.id) as { found: boolean; path?: string };
                    if (localRes.found) {
                        console.log('[VideoPlayer] Autocarga: Subtítulo local detectado:', localRes.path);
                        handleSubtitleSelect({ ...localRes, type: 'local', label: 'Local' } as SubtitleEntry);
                    } else {
                        const cloudRes = await api.checkCloudSubtitle(movie.id) as CloudSubtitleCheck;
                        if (cloudRes.found) {
                            console.log('[VideoPlayer] Autocarga: Subtítulo en la nube detectado:', cloudRes.name);
                            handleSubtitleSelect({
                                id: cloudRes.fileId,
                                type: 'drive',
                                label: `Drive (${cloudRes.name})`,
                                provider: 'Drive Cache'
                            } as SubtitleEntry);
                        } else {
                            handleSearchSubtitles();
                        }
                    }
                } catch (err) {
                    console.warn('[VideoPlayer] Error en autocarga de subtítulos:', err);
                    const error = err as Error;
                    if (error.message?.includes('429')) setSubQuotaReached(true);
                }
            };

            if (!subQuotaReached) {
                autoLoadSubtitles();
            }

            if (movie.id) {
                api.getAudioTracks(movie.id).then(tracks => {
                    const audioTracksData = tracks as AudioTrack[];
                    if (audioTracksData && audioTracksData.length > 0) {
                        setAudioTracks(audioTracksData);
                        console.log(`[VideoPlayer] Audio tracks loaded:`, audioTracksData);

                        const spanishTrack = audioTracksData.find(t =>
                            t.language?.toLowerCase().includes('spa') ||
                            t.language?.toLowerCase() === 'es' ||
                            t.language?.toLowerCase().includes('lat') ||
                            t.title?.toLowerCase().includes('spa') ||
                            t.title?.toLowerCase().includes('latino') ||
                            t.title?.toLowerCase().includes('castellano') ||
                            t.title?.toLowerCase().includes('spanish') ||
                            t.title?.toLowerCase().includes('español') ||
                            t.title?.toLowerCase().includes('espanol')
                        );

                        if (spanishTrack && spanishTrack.index > 0) {
                            console.log('[VideoPlayer] Autoselección de audio: Español detectado:', spanishTrack.title);
                            setSelectedAudioTrack(spanishTrack);
                        }
                    }
                }).catch((err: Error) => console.warn('[VideoPlayer] Error fetching audio tracks:', err));
            }
        }
    }, [movie.id, subQuotaReached]);

    const availableQualities = useMemo(() => {
        const qualities: QualityOption[] = [];
        const height = movie.video_height || 0;

        if (height >= 1080) qualities.push({ id: '1080', label: '1080p', desc: 'Full HD (Máxima)' });
        if (height >= 720) qualities.push({ id: '720', label: '720p', desc: 'Alta Definición (HD)' });
        qualities.push({ id: '480', label: '480p', desc: 'Fluido (Bajo consumo)' });
        qualities.push({ id: 'original', label: `Original (${movie.original_resolution || '...'})`, desc: 'Directo (Sin transcodificar)' });

        return qualities;
    }, [movie.video_height, movie.original_resolution]);

    const needsTranscoding = useMemo(() => {
        let vidCodec = (movie.video_codec || '').toLowerCase();
        if (!vidCodec) {
            const fileName = (movie.file_name || movie.official_title || '').toLowerCase();
            if (fileName.includes('hevc') || fileName.includes('x265') || fileName.includes('h265')) vidCodec = 'hevc';
            else if (fileName.includes('h264') || fileName.includes('x264') || fileName.includes('avc')) vidCodec = 'h264';
        }

        const audCodec = (movie.audio_codec || '').toLowerCase();
        const isMKV = movie.file_path?.toLowerCase().endsWith('.mkv') ||
            movie.file_name?.toLowerCase().endsWith('.mkv');

        if (isSafari && isMKV) return true;

        if (selectedAudioTrack && selectedAudioTrack.index > 0) return true;

        const isVideoCompatible = ['h264', 'avc1', 'avc2', 'hevc', 'h265'].some(c => vidCodec.includes(c));
        const isAudioCompatible = ['aac', 'mp3'].some(c => audCodec.includes(c));

        const isVidUnknown = !vidCodec;
        const isAudUnknown = !audCodec;

        if (quality === 'original') {
            return isMKV || !isVideoCompatible || !isAudioCompatible;
        }

        const height = movie.video_height || 0;
        if (height > parseInt(quality)) return true;

        const result = isMKV || !isVideoCompatible || !isAudioCompatible;
        console.log('[VideoPlayer] needsTranscoding:', result, { isMKV, isVideoCompatible, isAudioCompatible, selectedAudioTrack: selectedAudioTrack?.index });
        return result;
    }, [quality, movie.video_codec, movie.audio_codec, movie.video_height, movie.file_path, movie.file_name, selectedAudioTrack]);

    useEffect(() => {
        const isMkv = movie.file_path?.toLowerCase().endsWith('.mkv') ||
            movie.file_name?.toLowerCase().endsWith('.mkv');
        if (streamSource === 'drive' && isSafari && movie.drive_file_id && !isMkv && !localFileReady) {
            setLocalFileDownloading(true);
            const statusUrl = api.getLocalFileStatusUrl(movie.drive_file_id);
            const pollId = setInterval(async () => {
                try {
                    const r = await fetch(statusUrl);
                    const data = await r.json();
                    if (data.ready) {
                        setLocalFileReady(true);
                        setLocalFileDownloading(false);
                        clearInterval(pollId);
                    }
                } catch {}
            }, 3000);
            return () => clearInterval(pollId);
        }
    }, [streamSource, isSafari, movie.drive_file_id, movie.file_path, movie.file_name, localFileReady]);

    const videoUrl = useMemo(() => {
        if (streamSource === 'checking' || streamSource === 'error') return '';

        let actualQuality = quality;
        if (needsTranscoding || useTranscoding) {
            if (quality === 'original') {
                let vidC = (movie.video_codec || '').toLowerCase();
                if (!vidC) {
                    const fn = (movie.file_name || '').toLowerCase();
                    if (fn.includes('hevc') || fn.includes('x265') || fn.includes('h265')) vidC = 'hevc';
                }
                if (vidC && !['h264', 'avc1', 'avc2', 'vp8', 'vp9', 'av1'].some(c => vidC.includes(c))) {
                    actualQuality = '1080';
                }
            }
        }

        console.log('[VideoPlayer] Building videoUrl. transcode:', needsTranscoding || useTranscoding, 'audioTrack:', selectedAudioTrack?.index);

        if (streamSource === 'cloud') {
            let url = api.getCloudStreamUrl(movie.id);
            if (needsTranscoding || useTranscoding) {
                url += `?transcode=true&quality=${actualQuality}&t=${seekOffset}`;
                if (selectedAudioTrack) url += `&audio=${selectedAudioTrack.index}`;
            }
            return url;
        } else if (streamSource === 'drive') {
            const isMkv = movie.file_path?.toLowerCase().endsWith('.mkv') ||
                movie.file_name?.toLowerCase().endsWith('.mkv');
            if (isSafari && movie.drive_file_id && !isMkv) {
                if (localFileReady) {
                    return api.getLocalFileUrl(movie.drive_file_id);
                }
                return '';
            }
            return api.getStreamUrl(movie.drive_file_id, movie.file_path, {
                transcode: needsTranscoding || useTranscoding,
                quality: actualQuality,
                startTime: seekOffset,
                audioTrack: selectedAudioTrack ? selectedAudioTrack.index : null
            }) || '';
        } else if (streamSource === 'local') {
            return api.getStreamUrl(null, movie.file_path, {
                transcode: needsTranscoding,
                startTime: seekOffset,
                quality: needsTranscoding ? actualQuality : undefined,
                audioTrack: selectedAudioTrack ? selectedAudioTrack.index : null
            }) || '';
        }
        return '';
    }, [movie.id, movie.drive_file_id, movie.file_path, movie.video_codec, movie.audio_codec, movie.video_height, streamSource, needsTranscoding, useTranscoding, quality, seekOffset, movie.file_name, selectedAudioTrack, localFileReady]);

    const isDisplayLoading = isInitializing || isLoading || localFileDownloading;

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        const isTranscoding = needsTranscoding || useTranscoding;
        if (!isTranscoding && isPlaying && currentTime === 0 && !isLoading && !isInitializing && !localFileDownloading) {
            const stuckTimeout = isIOS ? 8000 : 3000;
            timer = setTimeout(() => {
                setIsStuckAtZero(true);
                console.log('[VideoPlayer] Playback seems stuck at 0:00. Showing overlay.');
            }, stuckTimeout);
        } else {
            setIsStuckAtZero(false);
        }
        return () => clearTimeout(timer);
    }, [isPlaying, currentTime, isLoading, isInitializing, needsTranscoding, useTranscoding]);

    useEffect(() => {
        if (movie?.id && user?.id) {
            api.getUserRating(user.id, movie.id).then(res => {
                const ratingRes = res as { rating?: number };
                if (ratingRes?.rating) setUserRating(ratingRes.rating);
            }).catch(() => { });
        }
    }, [movie?.id, user?.id]);

    const handleRating = async (rating: number) => {
        setIsSavingRating(true);
        try {
            if (!user?.id) return;
            await api.saveUserRating(user.id, movie.id, rating);
            setUserRating(rating);
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

    const handleLoadedData = () => {
        setIsLoading(false);
        console.log('[VideoPlayer] Video loaded, isLoading=false');
    };

    const handleProgress = () => {
        const video = videoRef.current;
        if (video && video.buffered.length > 0 && video.duration > 0 && video.duration !== Infinity) {
            const bufferedEnd = video.buffered.end(video.buffered.length - 1);
            // Scale 0-30s of buffered video to 0-99% for visible early progress
            const pct = Math.min(99, Math.round((bufferedEnd / 30) * 100));
            setLoadingProgress(pct);
        }
    };

    useEffect(() => {
        if (!videoUrl || streamingMode !== 'classic') return;

        setIsLoading(true);
        console.log('[VideoPlayer] Source changed:', videoUrl);

        if (videoRef.current && videoRef.current.src !== videoUrl) {
            setTimeout(() => {
                if (videoRef.current) {
                    videoRef.current.load();
                    if (isPlaying) videoRef.current.play().catch((e: Error) => console.warn('Autoplay blocked:', e));
                }
            }, 50);
        }

        const timer = setTimeout(() => {
            if (isLoading && !localFileDownloading) {
                console.warn('[VideoPlayer] Timeout (45s): forcing isLoading=false');
                setIsLoading(false);
            }
        }, 45000);

        return () => clearTimeout(timer);
    }, [videoUrl, streamingMode, localFileDownloading]);

    const handleVideoError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
        const videoElement = e.target as HTMLVideoElement;
        const errorCode = videoElement.error ? videoElement.error.code : 'Unknown';
        const errorMsg = videoElement.error?.message || '';
        addDebug(`VIDEO ERROR: Code ${errorCode} - ${errorMsg}`);

        let mimeCheck = ''
        try {
            mimeCheck = videoElement.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')
        } catch {}

        console.error('[VideoPlayer] Video Error:', {
            errorCode,
            errorMessage: errorMsg,
            mediaError: videoElement.error,
            src: videoElement.currentSrc?.substring(0, 100),
            networkState: videoElement.networkState,
            readyState: videoElement.readyState,
            canPlayH264AAC: mimeCheck,
            userAgent: navigator.userAgent.substring(0, 120),
        });

        if (!useTranscoding && !localFileDownloading && (errorCode === 3 || errorCode === 4)) {
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

        setError({ message: msg, code: errorCode, mediaError: errorMsg, mimeCheck });
    };

    const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        setIsInitializing(false);
        if (videoRef.current) {
            videoRef.current.preload = 'auto';
        }
    };

    const handleCanPlay = () => {
        setIsLoading(false);
        const video = videoRef.current;
        if (!video) return;

        const isTranscoded = needsTranscoding || useTranscoding;
        if (!isTranscoded && !initialSeekPerformed.current && seekOffset > 0) {
            console.log(`[VideoPlayer] Initial seek to: ${seekOffset}s`);
            video.currentTime = seekOffset;
            initialSeekPerformed.current = true;
        } else if (isTranscoded && !initialSeekPerformed.current) {
            initialSeekPerformed.current = true;
        }
        setIsPlaying(!video.paused);
    };

    const resetTimer = () => {
        if (isLocked) return;
        setShowControls(true);
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);

        if (isPlaying) {
            controlsTimeoutRef.current = window.setTimeout(() => {
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
                videoRef.current.play().catch((err: Error) => {
                    console.warn('[VideoPlayer] Play blocked:', err.message);
                    setIsPlaying(false);
                });
            } else {
                videoRef.current.pause();
            }
        }
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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

    const handleSeekStart = () => {
        setIsDragging(true);
    };

    const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const time = parseFloat(e.target.value);
        setDragTime(time);
    };

    const handleSeekEnd = (e: React.PointerEvent<HTMLInputElement>) => {
        setIsDragging(false);
        const time = parseFloat((e.target as HTMLInputElement).value);
        if (needsTranscoding || useTranscoding) {
            setSeekOffset(time);
            setCurrentTime(time);
        } else if (videoRef.current) {
            videoRef.current.currentTime = time;
            setCurrentTime(time);
        }
    };

    const skipBackward = () => {
        if (needsTranscoding || useTranscoding) {
            const newTime = Math.max(0, currentTime - 10);
            setSeekOffset(newTime);
            setCurrentTime(newTime);
        } else if (videoRef.current) {
            videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
        }
    };

    const skipForward = () => {
        if (needsTranscoding || useTranscoding) {
            const newTime = Math.min(duration, currentTime + 10);
            setSeekOffset(newTime);
            setCurrentTime(newTime);
        } else if (videoRef.current) {
            videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 10);
        }
    };

    const toggleFullscreen = async () => {
        if (!playerRef.current && !videoRef.current) return;

        const isCurrentlyFullscreen = (document as unknown as Record<string, unknown>).fullscreenElement ||
            (document as unknown as Record<string, unknown>).webkitFullscreenElement ||
            (document as unknown as Record<string, unknown>).mozFullScreenElement ||
            (document as unknown as Record<string, unknown>).msFullscreenElement;

        if (isCurrentlyFullscreen) {
            if (document.exitFullscreen) await document.exitFullscreen();
            else if ((document as unknown as Record<string, unknown>).webkitExitFullscreen) {
                await ((document as unknown as Record<string, unknown>).webkitExitFullscreen as () => Promise<void>)();
            }

            if (window.screen.orientation && window.screen.orientation.unlock) {
                Promise.resolve(window.screen.orientation.unlock()).catch(() => { });
            }
        } else {
            const videoEl = videoRef.current;
            const containerEl = playerRef.current;

            if (isIOS && videoEl) {
                const vid = videoEl as unknown as Record<string, unknown>;
                if (vid.webkitEnterFullscreen) {
                    try {
                        await (vid.webkitEnterFullscreen as () => Promise<void>)();
                        return;
                    } catch (err) {
                        const error = err as Error;
                        console.warn('[VideoPlayer] webkitEnterFullscreen failed:', error.message);
                    }
                }
            }

            const container = containerEl as unknown as Record<string, unknown>;
            const requestFS = (containerEl.requestFullscreen ||
                container.webkitRequestFullscreen ||
                container.mozRequestFullScreen ||
                container.msRequestFullscreen) as ((() => Promise<void>) | undefined);

            if (requestFS) {
                try {
                    await requestFS.call(containerEl);
                    if (window.screen.orientation?.lock) {
                        try {
                            await window.screen.orientation.lock('landscape');
                        } catch (e) { }
                    }
                } catch (err) {
                    if (videoEl) {
                        const vid2 = videoEl as unknown as Record<string, unknown>;
                        if (vid2.webkitRequestFullscreen) {
                            await (vid2.webkitRequestFullscreen as () => Promise<void>).call(videoEl);
                        }
                    }
                }
            }
        }
    };

    useEffect(() => {
        const handleOrientationChange = () => {
            if (isMobile && window.screen.orientation?.type?.startsWith('landscape')) {
                resetTimer();
            }
        };

        window.screen.orientation?.addEventListener('change', handleOrientationChange);
        return () => window.screen.orientation?.removeEventListener('change', handleOrientationChange);
    }, [isMobile]);

    const formatTime = (seconds: number): string => {
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
                imdbId: subtitleSearchText ? undefined : (movie as unknown as Record<string, unknown>).imdb_id as string,
                title: movie.official_title,
                filename: movie.file_name,
                year: movie.detected_year,
                query: subtitleSearchText || undefined
            } as SubtitleSearchQuery) as SubtitleSearchResponse;
            if (res.data && res.data.length > 0) {
                setSubtitles(prev => {
                    const unique = [...prev];
                    res.data.forEach(s => {
                        if (!unique.find(u => u.id === s.id)) {
                            unique.push({ ...s, type: 'cloud' });
                        }
                    });
                    return unique.sort((a, b) => (b.score || 0) - (a.score || 0));
                });

                if (!selectedSubtitle) {
                    const bestSpanish = res.data.find(s => s.language === 'es');
                    if (bestSpanish) {
                        console.log('[VideoPlayer] Autoselección: Mejor opción en Español:', bestSpanish.release);
                        handleSubtitleSelect(bestSpanish);
                    } else if (res.data.length > 0) {
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

    const handleSubtitleSelect = async (subtitle: SubtitleEntry | null) => {
        setSelectedSubtitle(subtitle);
        setSubtitleCues([]);
        setSubtitleOffset(0);

        if (!subtitle) return;

        try {
            let url = '';
            let directContent: string | null = null;

            if (subtitle.type === 'os' || subtitle.type === 'cloud') {
                url = BACKEND_URL + '/api/subtitles/cloud?id=' + subtitle.id;
                api.downloadSubtitle(subtitle.id as number, movie.id).catch((e: Error) => console.warn('[VideoPlayer] Pairing failed:', e));
            } else if (subtitle.type === 'local') {
                url = BACKEND_URL + '/api/subtitles/external?path=' + encodeURIComponent(subtitle.path || '');
            } else if (subtitle.type === 'drive') {
                url = api.getDriveSubtitleUrl(subtitle.id as string);
            } else if (subtitle.type === 'manual') {
                directContent = subtitle.content || null;
            }

            if (directContent) {
                const cues = parseVTT(directContent);
                setSubtitleCues(cues);
            } else if (url) {
                const response = await fetch(url);

                if (!response.ok) {
                    const errorText = await response.text();
                    let isQuota = response.status === 429;
                    try {
                        const errJson = JSON.parse(errorText);
                        if (errJson.isQuota) isQuota = true;
                    } catch (e) { }

                    if (isQuota) setSubQuotaReached(true);
                    throw new Error(`Error ${response.status}: ${errorText.substring(0, 100)}`);
                }

                const text = await response.text();

                if (text.trim().startsWith('{')) {
                    console.error('[VideoPlayer] Received JSON instead of VTT:', text);
                    throw new Error('Formato de subtítulo inválido (JSON)');
                }

                const cues = parseVTT(text);
                console.log(`[VideoPlayer] Subtitles loaded: ${cues.length} cues found`);
                if (cues.length === 0) {
                    console.warn('[VideoPlayer] Parser returned 0 cues. Malformed VTT? Raw text starts with:', text.substring(0, 50));
                }
                setSubtitleCues(cues);
            }
        } catch (err) {
            console.error('[VideoPlayer] Subtitle selection error:', err);
            const error = err as Error;
            if (error.message?.includes('quota') || error.message?.includes('429')) {
                setSubQuotaReached(true);
            }
        }
    };

    const handleLocalSubtitleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event: ProgressEvent<FileReader>) => {
            const target = event.target;
            if (!target?.result) return;
            let content = target.result as string;

            if (file.name.toLowerCase().endsWith('.srt')) {
                content = "WEBVTT\n\n" + content.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
            }

            const manualSub: SubtitleEntry = {
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

    const parseVTT = (vttText: string | null | undefined): SubtitleCue[] => {
        if (!vttText) return [];
        const cues: SubtitleCue[] = [];
        const lines = vttText.split(/\r?\n/);
        let i = 0;

        while (i < lines.length && !lines[i].includes('-->')) {
            i++;
        }

        while (i < lines.length) {
            if (lines[i].includes('-->')) {
                const timeMatch = lines[i].match(/(?:(\d+):)?(\d+):(\d+)[.,](\d+)\s*-->\s*(?:(\d+):)?(\d+):(\d+)[.,](\d+)/);
                if (timeMatch) {
                    const h1 = parseInt(timeMatch[1] || '0');
                    const m1 = parseInt(timeMatch[2]);
                    const s1 = parseInt(timeMatch[3]);
                    const ms1 = parseInt(timeMatch[4]);

                    const h2 = parseInt(timeMatch[5] || '0');
                    const m2 = parseInt(timeMatch[6]);
                    const s2 = parseInt(timeMatch[7]);
                    const ms2 = parseInt(timeMatch[8]);

                    const start = h1 * 3600 + m1 * 60 + s1 + ms1 / 1000;
                    const end = h2 * 3600 + m2 * 60 + s2 + ms2 / 1000;

                    let text = '';
                    i++;
                    while (i < lines.length && lines[i].trim() !== '') {
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

    const formatVTTTime = (seconds: number): string => {
        const totalMs = Math.round(seconds * 1000);
        const h = Math.floor(totalMs / 3600000);
        const m = Math.floor((totalMs % 3600000) / 60000);
        const s = Math.floor((totalMs % 60000) / 1000);
        const ms = totalMs % 1000;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
    };

    const cuesToVTT = (cues: SubtitleCue[], offset: number): string => {
        let vtt = 'WEBVTT\n\n';
        for (const cue of cues) {
            const start = cue.start + offset;
            const end = cue.end + offset;
            if (start < 0) continue;
            vtt += `${formatVTTTime(start)} --> ${formatVTTTime(end)}\n${cue.text}\n\n`;
        }
        return vtt;
    };

    useEffect(() => {
        if (subtitleCues.length === 0) {
            setSubtitleTrackUrl(null);
            return;
        }
        const vtt = cuesToVTT(subtitleCues, subtitleOffset);
        const blob = new Blob([vtt], { type: 'text/vtt' });
        const url = URL.createObjectURL(blob);
        setSubtitleTrackUrl(url);
        setSubtitleTrackKey(k => k + 1);
        return () => URL.revokeObjectURL(url);
    }, [subtitleCues, subtitleOffset]);

    const handleVideoClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const now = Date.now();

        if (showSubtitleMenu) {
            setShowSubtitleMenu(false);
            return;
        }

        if (now - lastTap < 300) {
            const rect = (e.target as HTMLElement).getBoundingClientRect();
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

        unlockTimerRef.current = window.setInterval(() => {
            setUnlockProgress(prev => {
                if (prev >= 100) {
                    clearInterval(unlockTimerRef.current!);
                    setIsLocked(false);
                    setIsUnlocking(false);
                    setShowControls(true);
                    return 0;
                }
                return prev + (100 / 30);
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
                        playsInline={!useNativeControls}
                        autoPlay
                        muted={isMuted}
                        controls={useNativeControls}
                        preload="auto"
                        poster={activeMovie.poster_url ?? undefined}
                        {...(!useNativeControls ? { webkitPlaysinline: 'true' } : {})}
                        src={videoUrl}
                        onEnded={handleVideoEnded}
                        onTimeUpdate={(e: React.SyntheticEvent<HTMLVideoElement>) => {
                            if (isDragging) return;
                            const isTranscoded = needsTranscoding || useTranscoding;
                            const time = isTranscoded ? seekOffset + (e.target as HTMLVideoElement).currentTime : (e.target as HTMLVideoElement).currentTime;
                            setCurrentTime(time);

                            if (isLoading && time > 0) {
                                setIsLoading(false);
                            }


                        }}
                        onLoadedMetadata={(e: React.SyntheticEvent<HTMLVideoElement>) => {
                            const isTranscoded = needsTranscoding || useTranscoding;
                            const trueDuration = (isTranscoded && (e.target as HTMLVideoElement).duration && (e.target as HTMLVideoElement).duration !== Infinity)
                                ? seekOffset + (e.target as HTMLVideoElement).duration
                                : (e.target as HTMLVideoElement).duration;
                            setDuration(trueDuration);
                        }}
                        onLoadedData={handleLoadedData}
                        onProgress={handleProgress}
                        onCanPlay={handleCanPlay}
                        onPause={(e: React.SyntheticEvent<HTMLVideoElement>) => {
                            setIsPlaying(false);
                            const isTranscoded = needsTranscoding || useTranscoding;
                            const absTime = isTranscoded ? seekOffset + (e.target as HTMLVideoElement).currentTime : (e.target as HTMLVideoElement).currentTime;
                            if (user && movie?.id && absTime > 0) {
                                saveUserProgress(movie.id, Math.floor(absTime));
                            }
                        }}
                        onPlay={() => {
                            setIsPlaying(true);
                            setIsLoading(false);
                            if (isAndroid && videoRef.current?.requestFullscreen) {
                                videoRef.current.requestFullscreen().catch(() => {});
                            }
                        }}
                        onPlaying={() => {
                            setIsPlaying(true);
                            setIsLoading(false);
                        }}
                        onWaiting={() => setIsLoading(true)}
                        onError={handleVideoError}
                        onSeeking={() => setIsLoading(true)}
                        onSeeked={() => setIsLoading(false)}
                    >
                        {subtitleTrackUrl && selectedSubtitle && (
                            <track
                                key={subtitleTrackKey}
                                kind="subtitles"
                                src={subtitleTrackUrl}
                                srcLang={selectedSubtitle.language || 'en'}
                                label={selectedSubtitle.label || 'Subtitles'}
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

                {currentSubtitle && !useNativeControls && (
                    <div
                        className={`absolute bottom-[12%] left-1/2 -translate-x-1/2 bg-black/80 px-6 py-3 rounded-2xl max-w-[80%] text-center pointer-events-none transition-all duration-300 z-[150] ${
                            showControls ? 'translate-y-[-60px]' : 'translate-y-0'
                        }`}
                        style={{
                            fontSize: subtitleSettings.size === 'small' ? '16px' :
                                subtitleSettings.size === 'medium' ? '22px' :
                                    subtitleSettings.size === 'large' ? '32px' :
                                        subtitleSettings.size === 'xl' ? '42px' : '22px',
                            color: subtitleSettings.color === 'yellow' ? '#FFD700' :
                                subtitleSettings.color === 'cyan' ? '#22D3EE' : 'white',
                            textShadow: '0 2px 10px rgba(0,0,0,0.9), 0 0 20px rgba(0,0,0,0.5)',
                            lineHeight: '1.4',
                            whiteSpace: 'pre-wrap'
                        }}
                    >
                        {currentSubtitle.text}
                    </div>
                )}
            </div>

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

            {localFileDownloading && !localFileReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/90 z-[1010]">
                    <div className="text-center p-6">
                        <div className="relative w-20 h-20 mx-auto mb-4">
                            <div className="absolute inset-0 border-4 border-cyan-500/10 rounded-full"></div>
                            <div className="absolute inset-0 border-4 border-t-cyan-500 rounded-full animate-spin"></div>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <svg className="w-8 h-8 text-cyan-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                            </div>
                        </div>
                        <p className="text-white font-bold uppercase tracking-[0.3em]">Preparando archivo</p>
                        <p className="text-[10px] font-medium text-slate-400 mt-2 leading-relaxed italic">
                            Descargando película al servidor. Esto puede tomar unos segundos...
                        </p>
                    </div>
                </div>
            )}

            {isDisplayLoading && !isInitializing && !localFileDownloading && !showSubtitleMenu && !showQualityMenu && !showAudioMenu && !showVersionMenu && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-[40]">
                    <div className="text-center p-6">
                        <div className="relative w-28 h-28 mx-auto mb-6">
                            <div className="absolute inset-0 border-[3px] border-cyan-500/20 rounded-full"></div>
                            <div className="absolute inset-0 border-[3px] border-t-cyan-500 rounded-full animate-spin"></div>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-2xl font-bold text-cyan-400 select-none">{loadingProgress}%</span>
                            </div>
                        </div>
                        <p className="text-white font-bold uppercase tracking-[0.3em]">Cargando Video</p>
                    </div>
                </div>
            )}

            {useNativeControls && selectedSubtitle && !showSubtitleMenu && !showQualityMenu && !showAudioMenu && !showVersionMenu && !localFileDownloading && !isDisplayLoading && (
                <button
                    onClick={() => setShowSubtitleMenu(true)}
                    className="absolute top-4 right-4 z-[50] p-3 bg-black/50 backdrop-blur-sm rounded-full text-white/80 hover:text-white border border-white/10 transition-all active:scale-90"
                >
                    <MessageSquare size={20} />
                </button>
            )}

            {error && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/90 z-[1010] animate-in fade-in duration-500">
                    <div className="glass-card px-6 py-5 rounded-3xl border border-netflix-red/30 bg-netflix-red/10 flex flex-col gap-4 shadow-2xl backdrop-blur-xl">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-netflix-red/20 rounded-full">
                                <AlertCircle className="text-netflix-red" size={24} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-bold uppercase tracking-wider text-white">{error.message}</p>
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

                        {error.code != null && (
                            <div className="pt-1 border-t border-white/5">
                                <p className="text-[8px] font-mono text-slate-600 leading-relaxed">
                                    Code: {error.code}{error.mediaError ? ` — ${error.mediaError}` : ''}
                                    {error.mimeCheck ? ` — canPlay: ${error.mimeCheck}` : ''}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            )}

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

            {showControls && !useNativeControls && (
                <div
                    className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 to-transparent p-4 pb-10 md:p-8 md:pb-12"
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    onDoubleClick={(e: React.MouseEvent) => e.stopPropagation()}
                >
                    <div className="flex flex-col gap-4 w-full">
                        <div className="flex items-center justify-between text-white text-[10px] md:text-xs font-bold uppercase tracking-widest opacity-60 px-1">
                            <span>{formatTime(currentTime)}</span>
                            <span>
                                {(() => {
                                    const metaRuntime = Number(activeMovie.runtime || 0) * 60;

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

                            const displayTime = isDragging ? dragTime : currentTime;
                            const clampedTime = Math.min(displayTime, effectiveDuration || displayTime);
                            const progressPct = effectiveDuration > 0 ? (clampedTime / effectiveDuration) * 100 : 0;

                            return (
                                <div className="relative group/progress">
                                    <input
                                        type="range"
                                        min="0"
                                        max={effectiveDuration || 100}
                                        value={clampedTime}
                                        onPointerDown={handleSeekStart}
                                        onChange={handleSeekChange}
                                        onPointerUp={handleSeekEnd}
                                        style={{ background: `linear-gradient(to right, #06b6d4 ${progressPct}%, rgba(255,255,255,0.2) ${progressPct}%)` }}
                                        className="w-full h-1 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:shadow-lg"
                                    />

                                    <div className={`absolute top-6 left-1/2 -translate-x-1/2 transition-all duration-500 flex flex-col items-center gap-1 ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
                                        <div className="h-0.5 w-8 bg-cyan-500/50 rounded-full mb-1" />
                                        <h2 className="text-white text-[10px] md:text-sm font-black uppercase tracking-[0.4em] drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)] text-center whitespace-nowrap opacity-80">
                                            {movie.official_title || movie.title}
                                        </h2>
                                    </div>
                                </div>
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

                            <div className="flex items-center gap-2 md:gap-3">
                                <button
                                    onClick={() => { setShowSubtitleMenu(true); setShowQualityMenu(false); setShowVersionMenu(false); setShowControls(true); }}
                                    className={`p-2.5 rounded-full transition-colors ${showSubtitleMenu ? 'text-cyan-400 bg-cyan-400/10' : 'text-white/70 hover:text-white'}`}
                                >
                                    <MessageSquare size={isMobile ? 22 : 26} />
                                </button>

                                {versions.length > 1 && (
                                    <button onClick={() => { setShowVersionMenu(true); setShowSubtitleMenu(false); setShowQualityMenu(false); setShowControls(true); }} className={'p-2.5 rounded-full transition-colors ' + (showVersionMenu ? 'text-netflix-red bg-netflix-red/20' : 'text-white/70 hover:text-white')}>
                                        <Film size={isMobile ? 22 : 26} />
                                    </button>
                                )}

                                <button onClick={toggleFullscreen} className="p-2.5 text-white/70 hover:text-white transition-colors active:scale-90">
                                    <Maximize size={isMobile ? 22 : 26} />
                                </button>

                                <button
                                    onClick={() => { setShowQualityMenu(true); setShowSubtitleMenu(false); setShowVersionMenu(false); resetTimer(); }}
                                    className={`p-2.5 rounded-full transition-colors relative group ${showQualityMenu ? 'text-cyan-400 bg-cyan-400/10' : 'text-white'}`}
                                >
                                    <Settings size={isMobile ? 22 : 26} className="group-hover:rotate-45 transition-transform duration-300" />
                                    <span className="absolute -top-1 -right-1 bg-netflix-red text-[8px] font-bold px-1 rounded-sm">{quality}p</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {(showSubtitleMenu || showVersionMenu || showQualityMenu || showAudioMenu) && (
                <div
                    className="absolute inset-0 z-[100] bg-black/60 backdrop-blur-md flex items-center justify-center p-4 md:p-10 animate-in fade-in duration-300"
                    onClick={() => { setShowSubtitleMenu(false); setShowVersionMenu(false); setShowQualityMenu(false); setShowAudioMenu(false); }}
                >
                    <div
                        className="w-full max-w-4xl bg-black/40 border border-white/10 rounded-[40px] p-8 md:p-12 relative shadow-2xl overflow-hidden"
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    >
                        <div className="absolute top-8 right-8">
                            <button
                                onClick={() => { setShowSubtitleMenu(false); setShowVersionMenu(false); setShowQualityMenu(false); setShowAudioMenu(false); }}
                                className="p-3 hover:bg-white/10 rounded-full text-white/60 transition-colors"
                            >
                                <X size={28} />
                            </button>
                        </div>

                        <div className="flex items-center justify-center gap-6 border-b border-white/10 pb-4 mb-6">
                            <button
                                onClick={() => { setShowSubtitleMenu(true); setShowQualityMenu(false); setShowVersionMenu(false); setShowAudioMenu(false); }}
                                className={`text-[10px] md:text-xs font-black uppercase tracking-widest transition-colors pb-1 ${
                                    showSubtitleMenu ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-white/40 hover:text-white'
                                }`}
                            >
                                Subtítulos
                            </button>
                            <button
                                onClick={() => { setShowQualityMenu(true); setShowSubtitleMenu(false); setShowVersionMenu(false); setShowAudioMenu(false); }}
                                className={`text-[10px] md:text-xs font-black uppercase tracking-widest transition-colors pb-1 ${
                                    showQualityMenu ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-white/40 hover:text-white'
                                }`}
                            >
                                Calidad
                            </button>
                            {audioTracks.length > 0 && (
                                <button
                                    onClick={() => { setShowAudioMenu(true); setShowSubtitleMenu(false); setShowQualityMenu(false); setShowVersionMenu(false); }}
                                    className={`text-[10px] md:text-xs font-black uppercase tracking-widest transition-colors pb-1 ${
                                        showAudioMenu ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-white/40 hover:text-white'
                                    }`}
                                >
                                    Audio
                                </button>
                            )}
                            {versions.length > 1 && (
                                <button
                                    onClick={() => { setShowVersionMenu(true); setShowSubtitleMenu(false); setShowQualityMenu(false); setShowAudioMenu(false); }}
                                    className={`text-[10px] md:text-xs font-black uppercase tracking-widest transition-colors pb-1 ${
                                        showVersionMenu ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-white/40 hover:text-white'
                                    }`}
                                >
                                    Versión
                                </button>
                            )}
                        </div>

                        <div className="grid grid-cols-1 gap-12 md:gap-20">
                            <div className={`space-y-6 ${!showSubtitleMenu ? 'hidden' : ''}`}>
                                <h3 className="text-xl font-bold text-white/40 uppercase tracking-[0.2em] border-b border-white/10 pb-4">Subtítulos</h3>

                                <div className="space-y-6 bg-white/5 rounded-3xl p-5 border border-white/5">
                                    <div className="space-y-3">
                                        <div className="flex justify-between items-center">
                                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30">Sincronización</span>
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${subtitleOffset === 0 ? 'text-white/40' : 'bg-cyan-500 text-black'}`}>
                                                {subtitleOffset > 0 ? '+' : ''}{subtitleOffset.toFixed(1)}s
                                            </span>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => adjustSubtitleOffset(-0.5)}
                                                className="flex-1 py-2 bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 text-white font-bold transition-all active:scale-95"
                                            >
                                                -0.5s
                                            </button>
                                            <button
                                                onClick={() => setSubtitleOffset(0)}
                                                className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 text-white/40 text-[10px] font-bold uppercase transition-all"
                                            >
                                                Reset
                                            </button>
                                            <button
                                                onClick={() => adjustSubtitleOffset(0.5)}
                                                className="flex-1 py-2 bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 text-white font-bold transition-all active:scale-95"
                                            >
                                                +0.5s
                                            </button>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4 pt-2">
                                        <div className="space-y-2">
                                            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/20">Tamaño</span>
                                            <div className="grid grid-cols-2 gap-1">
                                                {['small', 'medium', 'large', 'xl'].map(s => (
                                                    <button
                                                        key={s}
                                                        onClick={() => updateSubtitleSettings({ size: s })}
                                                        className={`py-1.5 text-[8px] font-bold uppercase rounded-md border transition-all ${subtitleSettings.size === s ? 'bg-cyan-500 border-cyan-500 text-black' : 'bg-transparent border-white/5 text-white/30 hover:border-white/20'}`}
                                                    >
                                                        {s}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/20">Color</span>
                                            <div className="flex flex-col gap-1">
                                                {[
                                                    { id: 'white', bg: 'bg-white' },
                                                    { id: 'yellow', bg: 'bg-yellow-400' },
                                                    { id: 'cyan', bg: 'bg-cyan-400' }
                                                ].map(c => (
                                                    <button
                                                        key={c.id}
                                                        onClick={() => updateSubtitleSettings({ color: c.id })}
                                                        className={`flex items-center gap-2 px-2 py-1.5 rounded-md border transition-all ${subtitleSettings.color === c.id ? 'border-cyan-500 bg-cyan-500/10' : 'border-white/5'}`}
                                                    >
                                                        <div className={`w-2 h-2 rounded-full ${c.bg}`} />
                                                        <span className={`text-[8px] font-bold uppercase ${subtitleSettings.color === c.id ? 'text-cyan-400' : 'text-white/20'}`}>{c.id}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-2 max-h-[30vh] overflow-y-auto custom-scrollbar pr-4">
                                    <button
                                        onClick={() => handleSubtitleSelect(null)}
                                        className={`w-full text-left py-3 px-4 rounded-xl transition-all flex items-center gap-3 ${!selectedSubtitle ? 'text-white font-bold' : 'text-white/40 hover:text-white'}`}
                                    >
                                        {!selectedSubtitle && <Check size={18} className="text-cyan-400" />}
                                        <span className="text-lg">Apagado</span>
                                    </button>

                                    {isSearchingSubtitles ? (
                                        <div className="flex items-center gap-3 py-4 text-cyan-400">
                                            <Loader2 size={20} className="animate-spin" />
                                            <span className="text-sm font-bold uppercase tracking-widest">Buscando...</span>
                                        </div>
                                    ) : subtitles.map(sub => (
                                        <button
                                            key={sub.id}
                                            onClick={() => handleSubtitleSelect(sub)}
                                            className={`w-full text-left py-3 px-4 rounded-xl transition-all flex items-center gap-3 ${selectedSubtitle?.id === sub.id ? 'text-white font-bold' : 'text-white/40 hover:text-white'}`}
                                        >
                                            {selectedSubtitle?.id === sub.id && <Check size={18} className="text-cyan-400" />}
                                            <div className="flex flex-col">
                                                <span className="text-lg">{sub.label}</span>
                                                <span className="text-[10px] uppercase opacity-40">{sub.provider || 'Local'}</span>
                                            </div>
                                        </button>
                                    ))}

                                    <div className="pt-4 mt-4 border-t border-white/5 grid grid-cols-2 gap-3">
                                        <button
                                            onClick={handleSearchSubtitles}
                                            className="py-3 px-4 bg-white/5 hover:bg-white/10 rounded-xl text-white text-xs font-bold transition-all flex items-center justify-center gap-2 border border-white/5"
                                        >
                                            <Search size={16} />
                                            <span>Buscar</span>
                                        </button>
                                        <div className="relative">
                                            <input
                                                type="file"
                                                id="sub-up-hbo"
                                                className="hidden"
                                                onChange={handleLocalSubtitleUpload}
                                                accept=".srt,.vtt"
                                            />
                                            <button
                                                onClick={() => (document.getElementById('sub-up-hbo') as HTMLInputElement).click()}
                                                className="w-full py-3 px-4 bg-white/5 hover:bg-white/10 rounded-xl text-white/60 text-xs transition-all border border-white/5"
                                            >
                                                Local
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className={`space-y-8 ${showSubtitleMenu ? 'hidden' : ''}`}>
                                <h3 className="text-xl font-bold text-white/40 uppercase tracking-[0.2em] border-b border-white/10 pb-4">
                                    {showVersionMenu ? 'Versión' : showAudioMenu ? 'Audio' : 'Calidad'}
                                </h3>
                                <div className="space-y-2 max-h-[40vh] overflow-y-auto custom-scrollbar pr-4">
                                    {showAudioMenu ? (
                                        audioTracks.map(track => (
                                            <button
                                                key={`audio-${track.index}`}
                                                onClick={() => {
                                                    setSelectedAudioTrack(track);
                                                    setShowAudioMenu(false);
                                                }}
                                                className={`w-full text-left py-3 px-4 rounded-xl transition-all flex items-center gap-3 ${selectedAudioTrack?.index === track.index || (!selectedAudioTrack && track.index === 0) ? 'text-white font-bold' : 'text-white/40 hover:text-white'}`}
                                            >
                                                {(selectedAudioTrack?.index === track.index || (!selectedAudioTrack && track.index === 0)) && <Check size={18} className="text-cyan-400" />}
                                                <div className="flex flex-col">
                                                    <span className="text-lg">{track.title}</span>
                                                    <span className="text-[10px] uppercase opacity-40">{track.language} ({track.codec})</span>
                                                </div>
                                            </button>
                                        ))
                                    ) : showQualityMenu ? (
                                        availableQualities.map(q => (
                                            <button
                                                key={q.id}
                                                onClick={() => {
                                                    setQuality(q.id);
                                                    setShowQualityMenu(false);
                                                }}
                                                className={`w-full text-left py-3 px-4 rounded-xl transition-all flex items-center gap-3 ${quality === q.id ? 'text-white font-bold' : 'text-white/40 hover:text-white'}`}
                                            >
                                                {quality === q.id && <Check size={18} className="text-cyan-400" />}
                                                <div className="flex flex-col">
                                                    <span className="text-lg">{q.label}</span>
                                                    <span className="text-[10px] uppercase opacity-40">{q.desc}</span>
                                                </div>
                                            </button>
                                        ))
                                    ) : (
                                        versions.map((v, i) => (
                                            <button
                                                key={v.id || i}
                                                onClick={() => {
                                                    onVersionChange(v);
                                                    setShowVersionMenu(false);
                                                }}
                                                className={`w-full text-left py-3 px-4 rounded-xl transition-all flex items-center gap-3 ${v.id === movie.id ? 'text-white font-bold' : 'text-white/40 hover:text-white'}`}
                                            >
                                                {v.id === movie.id && <Check size={18} className="text-cyan-400" />}
                                                <div className="flex flex-col">
                                                    <span className="text-lg">{v.official_title || v.detected_title}</span>
                                                    <span className="text-[10px] uppercase opacity-40">{v.detected_year || 'Versión alterna'}</span>
                                                </div>
                                            </button>
                                        ))
                                    )}

                                    <div className="pt-10">
                                        <button
                                            onClick={() => {
                                                if (showQualityMenu) { setShowQualityMenu(false); setShowVersionMenu(true); }
                                                else { setShowQualityMenu(true); setShowVersionMenu(false); }
                                            }}
                                            className="text-cyan-400 text-sm font-bold uppercase tracking-[0.2em] hover:text-cyan-300 transition-colors"
                                        >
                                            {showQualityMenu ? 'Ver otras versiones' : 'Cambiar calidad'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

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
                    <div className="absolute inset-0 bg-transparent" />

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
