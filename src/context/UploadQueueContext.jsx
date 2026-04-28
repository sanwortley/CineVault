import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { api } from '../api';

const UploadQueueContext = createContext(null);

export function UploadQueueProvider({ children }) {
    const [queue, setQueue] = useState([]);
    const fileInputRef = useRef(null);
    const pendingMovieRef = useRef(null);

    const updateItem = useCallback((id, updates) =>
        setQueue(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item)), []);

    useEffect(() => {
        let isMounted = true;
        let pollInterval = null;

        const syncQueue = async () => {
            try {
                const serverQueue = await api.getUploadQueue();
                if (Array.isArray(serverQueue) && isMounted) {
                    setQueue(prev => {
                        const newQueue = serverQueue.map(item => {
                            const existing = prev.find(p => String(p.id) === String(item.movieId));
                            return {
                                id: String(item.movieId),
                                title: item.title,
                                progress: item.status === 'done' ? 100 : (item.progress ?? (existing?.progress || 0)),
                                status: item.status,
                                errorMsg: item.error,
                                isOptimizing: !!(item.options && item.options.optimize)
                            };
                        });
                        return newQueue;
                    });

                    // Manage subscriptions for active items
                    serverQueue.forEach(item => {
                        const isWorking = ['uploading', 'pending', 'fetching', 'downloading', 'converting'].some(s => item.status.includes(s));
                        if (isWorking) {
                            api.onDriveUploadProgress(item.movieId, (data) => {
                                if (data && isMounted) {
                                    if (data.status === 'error') {
                                        updateItem(item.movieId, { status: 'error', errorMsg: data.error });
                                    } else {
                                        const prog = data.progress ?? 0;
                                        updateItem(item.movieId, { progress: prog, status: data.status || item.status, isOptimizing: data.isOptimizing ?? false });
                                        if (data.status === 'done' || prog === 100) {
                                            updateItem(item.movieId, { status: 'done', progress: 100 });
                                        }
                                    }
                                }
                            });
                        }
                    });
                }
            } catch(e) {
                console.warn('[QueueSync] Fetch error:', e.message);
            }
        };

        syncQueue();
        pollInterval = setInterval(syncQueue, 3000);

        const handleVisibility = () => { if (!document.hidden) syncQueue(); };
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            isMounted = false;
            if (pollInterval) clearInterval(pollInterval);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [updateItem]);

    const startWebUpload = useCallback(async (movie, file) => {
        try {
            const result = await api.uploadMovieFile(movie.id, file, (progress) => {
                updateItem(movie.id, { progress, isOptimizing: false });
            });
            if (result.success) { updateItem(movie.id, { status: 'done', progress: 100 }); }
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
            
            const unsub = api.onDriveUploadProgress(id, (data) => {
                if (data) {
                    if (data.status === 'error') {
                        updateItem(id, { status: 'error', errorMsg: data.error });
                        unsub();
                    } else {
                        updateItem(id, { progress: data.progress ?? 0, status: data.status || 'converting', isOptimizing: data.isOptimizing ?? false });
                        if (data.status === 'done' || data.progress === 100) {
                            updateItem(id, { status: 'done', progress: 100 });
                            unsub();
                        }
                    }
                }
            });
        } catch (e) {
            console.error('Retry failed:', e);
        }
    }, [updateItem]);

    const addToQueue = useCallback(async (movie) => {
        if (queue.some(item => String(item.id) === String(movie.id))) return;

        const queueEntry = { id: String(movie.id), title: movie.official_title || movie.detected_title, progress: 0, status: 'converting', isOptimizing: false };

        // _directQueue: called from ExplorePage after a Bóveda Global download is initiated
        if (movie._directQueue) {
            setQueue(prev => [...prev, queueEntry]);
            const unsub = api.onDriveUploadProgress(String(movie.id), (data) => {
                if (data) {
                    if (data.status === 'error') {
                        updateItem(String(movie.id), { status: 'error', errorMsg: data.error });
                        unsub();
                    } else {
                        updateItem(String(movie.id), { progress: data.progress ?? 0, status: data.status || 'converting', isOptimizing: data.isOptimizing ?? false });
                        if (data.status === 'done' || data.progress === 100) {
                            updateItem(String(movie.id), { status: 'done', progress: 100 });
                            unsub();
                        }
                    }
                }
            });
            return;
        }

        // Web: Smart Upload logic
        if (movie.file_path) {
            try {
                setQueue(prev => [...prev, queueEntry]);
                
                const unsubscribe = api.onDriveUploadProgress(movie.id, (data) => {
                    if (data) {
                        if (data.status === 'error') {
                            updateItem(movie.id, { status: 'error', errorMsg: data.error });
                            unsubscribe();
                        } else {
                            updateItem(movie.id, { progress: data.progress ?? 0, isOptimizing: data.isOptimizing ?? false });
                            if (data.progress === 100) {
                                updateItem(movie.id, { status: 'done' });
                                unsubscribe();
                            }
                        }
                    }
                });

                const result = await api.uploadMovieToDrive(movie.id, movie.file_path);
                
                if (result.started) {
                    return;
                } else if (result.success) {
                    updateItem(movie.id, { status: 'done', progress: 100 });
                    unsubscribe();
                    return;
                }
            } catch (err) {
                console.warn('[Smart Upload] Local path upload failed, falling back to file picker:', err.message);
                removeFromQueue(movie.id);
            }
        }

        // Web Fallback: trigger manual file picker
        pendingMovieRef.current = movie;
        if (fileInputRef.current) fileInputRef.current.click();
    }, [queue, removeFromQueue, updateItem]);

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
