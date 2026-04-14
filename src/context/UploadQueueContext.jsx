import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { api } from '../api';

const UploadQueueContext = createContext(null);

export function UploadQueueProvider({ children }) {
    const [queue, setQueue] = useState([]);
    const fileInputRef = useRef(null);
    const pendingMovieRef = useRef(null);

    const updateItem = useCallback((id, updates) =>
        setQueue(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item)), []);

    const autoRemove = useCallback((id) => setTimeout(() => setQueue(prev => prev.filter(i => i.id !== id)), 4000), []);

    useEffect(() => {
        let activeUnsubs = {};
        let isMounted = true;

        const initQueue = async () => {
            if (api.isElectron()) return;
            try {
                const serverQueue = await api.getUploadQueue();
                if (Array.isArray(serverQueue) && isMounted) {
                    setQueue(serverQueue.map(item => ({
                        id: item.movieId,
                        title: item.title,
                        progress: item.progress,
                        status: item.status,
                        errorMsg: item.error,
                        isOptimizing: !!(item.options && item.options.optimize)
                    })));

                    serverQueue.forEach(item => {
                        if (item.status === 'uploading' || item.status === 'pending') {
                            activeUnsubs[item.movieId] = api.onDriveUploadProgress(item.movieId, (data) => {
                                if (data) {
                                    if (data.status === 'error') {
                                        updateItem(item.movieId, { status: 'error', errorMsg: data.error });
                                    } else {
                                        const prog = data.progress ?? 0;
                                        updateItem(item.movieId, { progress: prog, isOptimizing: data.isOptimizing ?? false });
                                        if (data.status === 'done' || prog === 100) {
                                            updateItem(item.movieId, { status: 'done', progress: 100 });
                                            autoRemove(item.movieId);
                                        }
                                    }
                                }
                            });
                        }
                    });
                }
            } catch(e) {}
        };

        initQueue();

        return () => {
            isMounted = false;
            Object.values(activeUnsubs).forEach(unsub => unsub && typeof unsub === 'function' && unsub());
        };
    }, [updateItem, autoRemove]);

    const startElectronUpload = useCallback(async (movie) => {
        const ext = movie.file_path.split('.').pop().toLowerCase();
        const mimeType = { 'mp4': 'video/mp4', 'mkv': 'video/x-matroska', 'webm': 'video/webm' }[ext] || 'video/mp4';

        const unsubscribe = api.onDriveUploadProgress(movie.id, (data) => {
            if (data) {
                updateItem(movie.id, { progress: data.progress ?? 0, isOptimizing: data.isOptimizing ?? false });
            }
        });

        try {
            const result = await api.uploadMovieToDrive(movie.id, movie.file_path, mimeType);
            unsubscribe();
            if (result.success) { updateItem(movie.id, { status: 'done', progress: 100 }); autoRemove(movie.id); }
            else { updateItem(movie.id, { status: 'error', errorMsg: result.error }); }
        } catch (err) {
            unsubscribe();
            updateItem(movie.id, { status: 'error', errorMsg: err.message });
        }
    }, []);

    const startWebUpload = useCallback(async (movie, file) => {
        try {
            const result = await api.uploadMovieFile(movie.id, file, (progress) => {
                updateItem(movie.id, { progress, isOptimizing: false });
            });
            if (result.success) { updateItem(movie.id, { status: 'done', progress: 100 }); autoRemove(movie.id); }
            else { updateItem(movie.id, { status: 'error', errorMsg: result.error }); }
        } catch (err) {
            updateItem(movie.id, { status: 'error', errorMsg: err.message });
        }
    }, []);

    const removeFromQueue = useCallback(async (id) => {
        try {
            await api.removeUploadFromQueue(id);
        } catch (e) {}
        setQueue(prev => prev.filter(item => String(item.id) !== String(id)));
    }, []);

    const retryQueueItem = useCallback(async (id) => {
        try {
            await api.retryUpload(id);
            updateItem(id, { status: 'pending', progress: 0, errorMsg: null });
            
            // Re-bind SSE just in case
            if (!api.isElectron()) {
                const unsub = api.onDriveUploadProgress(id, (data) => {
                    if (data) {
                        if (data.status === 'error') {
                            updateItem(id, { status: 'error', errorMsg: data.error });
                            unsub();
                        } else {
                            updateItem(id, { progress: data.progress ?? 0, isOptimizing: data.isOptimizing ?? false });
                            if (data.status === 'done' || data.progress === 100) {
                                updateItem(id, { status: 'done', progress: 100 });
                                autoRemove(id);
                                unsub();
                            }
                        }
                    }
                });
            }
        } catch (e) {
            console.error('Retry failed:', e);
        }
    }, [updateItem, autoRemove]);

    const addToQueue = useCallback(async (movie) => {
        if (queue.some(item => item.id === movie.id)) return;

        const queueEntry = { id: movie.id, title: movie.official_title || movie.detected_title, progress: 0, status: 'uploading', isOptimizing: false };

        if (api.isElectron()) {
            setQueue(prev => [...prev, queueEntry]);
            startElectronUpload(movie);
        } else {
            // Web: Smart Upload logic
            // If the movie has a local path and we are on web, try the backend-direct upload first
            if (movie.file_path) {
                try {
                    // Pre-emptively add to queue with uploading status
                    setQueue(prev => [...prev, queueEntry]);

                    // Listen for progress via SSE
                    const unsubscribe = api.onDriveUploadProgress(movie.id, (data) => {
                        if (data) {
                            if (data.status === 'error') {
                                updateItem(movie.id, { status: 'error', errorMsg: data.error });
                                unsubscribe();
                            } else {
                                updateItem(movie.id, { progress: data.progress ?? 0, isOptimizing: data.isOptimizing ?? false });
                                if (data.progress === 100) {
                                    updateItem(movie.id, { status: 'done' });
                                    autoRemove(movie.id);
                                    unsubscribe();
                                }
                            }
                        }
                    });

                    const result = await api.uploadMovieToDrive(movie.id, movie.file_path);
                    
                    if (result.started) {
                        // Success: upload is running in background, SSE will do the rest
                        return;
                    } else if (result.success) {
                        // Fallback in case backend is still synchronous
                        updateItem(movie.id, { status: 'done', progress: 100 });
                        autoRemove(movie.id);
                        unsubscribe();
                        return;
                    }
                } catch (err) {
                    console.warn('[Smart Upload] Local path upload failed, falling back to file picker:', err.message);
                    removeFromQueue(movie.id);
                    // Continue to fallback below
                }
            }

            // Web Fallback: trigger manual file picker
            pendingMovieRef.current = movie;
            if (fileInputRef.current) fileInputRef.current.click();
        }
    }, [queue, startElectronUpload, autoRemove, removeFromQueue]);

    const handleFileSelected = useCallback((e) => {
        const file = e.target.files?.[0];
        const movie = pendingMovieRef.current;
        e.target.value = ''; // reset for re-use
        if (!file || !movie) return;
        setQueue(prev => [...prev, { id: movie.id, title: movie.official_title || movie.detected_title, progress: 0, status: 'uploading', isOptimizing: false }]);
        startWebUpload(movie, file);
    }, [startWebUpload]);

    return (
        <UploadQueueContext.Provider value={{ queue, addToQueue, removeFromQueue, retryQueueItem }}>
            {/* Hidden file input for web upload */}
            <input
                ref={fileInputRef}
                type="file"
                accept="video/*,.mkv"
                className="hidden"
                onChange={handleFileSelected}
            />
            {children}
        </UploadQueueContext.Provider>
    );
}

export function useUploadQueue() {
    return useContext(UploadQueueContext);
}
