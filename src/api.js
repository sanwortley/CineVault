/**
 * CineVault API Abstraction Layer
 * Automatically detects if running inside Electron or a web browser
 * and routes calls appropriately.
 */

const isElectron = () => typeof window !== 'undefined' && !!window.electronAPI;
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 
    (typeof window !== 'undefined' && window.location.origin.includes('localhost') ? 'http://localhost:3001' : window.location.origin);
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ─── Supabase direct fetch (for web mode) ────────────────────────────────────
async function supabaseFetch(endpoint, options = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
        ...options,
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || JSON.stringify(err));
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

// ─── Backend fetch (for Drive operations in web mode) ─────────────────────────
async function backendFetch(path, options = {}, customHeaders = {}) {
    const sessionId = localStorage.getItem('cinevault_session_id');
    const storedUser = localStorage.getItem('cinevault_user');
    let userEmail = '';
    if (storedUser) {
        try {
            const u = JSON.parse(storedUser);
            userEmail = u.email || '';
        } catch (e) {}
    }

    const res = await fetch(`${BACKEND_URL}${path}`, {
        credentials: 'include',
        ...options,
        headers: { 
            'Content-Type': 'application/json', 
            'x-session-id': sessionId || '',
            'x-user-email': userEmail,
            ...(options.headers || {}),
            ...customHeaders
        }
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        let err = { message: res.statusText };
        try {
            if (text.trim().startsWith('{')) err = JSON.parse(text);
        } catch (e) {}
        
        if (res.status === 401) {
            window.dispatchEvent(new CustomEvent('session-expired'));
        }
        throw new Error(err.message || JSON.stringify(err));
    }

    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
        return res.json();
    }
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch (e) {
        // Fallback for non-JSON or malformed JSON responses
        return { success: res.ok, status: res.status, raw: text };
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────
export const api = {
    // ── Movies ──────────────────────────────────────────────────────────────
    getMovies: () => {
        if (isElectron()) return window.electronAPI.getMovies();
        
        // Caching logic for Web
        const cached = localStorage.getItem('cinevault_movies_cache');
        const fetchRemote = supabaseFetch('movies?select=*&order=created_at.desc').then(d => {
            const data = d || [];
            localStorage.setItem('cinevault_movies_cache', JSON.stringify(data));
            return data;
        });

        if (cached) {
            try {
                // Return cached data immediately, then update cache in background
                const data = JSON.parse(cached);
                // Trigger refresh in background
                fetchRemote.catch(err => console.warn('[api] Background cache refresh failed:', err));
                return Promise.resolve(data);
            } catch (e) {
                return fetchRemote;
            }
        }
        return fetchRemote;
    },

    updateProgress: (movieId, duration) => {
        if (isElectron()) return window.electronAPI.updateMovieProgress(movieId, duration);
        return supabaseFetch(`movies?id=eq.${movieId}`, {
            method: 'PATCH',
            body: JSON.stringify({ watched_duration: duration, last_watched_at: new Date().toISOString() })
        });
    },

    deleteMovie: (id) => {
        const userStr = localStorage.getItem('sb-tlasrdqdjznjnchmtjcc-auth-token');
        let userEmail = '';
        if (userStr) {
            try {
                const session = JSON.parse(userStr);
                userEmail = session.user?.email || '';
            } catch (e) {}
        }

        if (isElectron()) return window.electronAPI.deleteMovie(id);
        
        return backendFetch(`/api/movies/${id}`, { 
            method: 'DELETE',
            headers: { 'x-user-email': userEmail }
        }).then(res => {
            // Clear cache to reflect change on next reload
            localStorage.removeItem('cinevault_movies_cache');
            return res;
        }).catch(err => {
            // If the movie was already deleted (404), treat it as success locally
            // to help clear ghost entries from the UI/cache
            if (err.message.includes('404') || 
                err.message.toLowerCase().includes('not found') || 
                err.message.toLowerCase().includes('no encontrada')) {
                localStorage.removeItem('cinevault_movies_cache');
                return { success: true, ghostCleared: true };
            }
            throw err;
        });
    },

    refreshLibrary: () => {
        if (isElectron()) return window.electronAPI.refreshLibrary();
        return backendFetch('/api/library/refresh', { method: 'POST' });
    },

    refreshAllMetadata: () => {
        return backendFetch('/api/admin/refresh-all-metadata', { method: 'POST' });
    },

    updateMovie: (id, data) => {
        if (isElectron()) return window.electronAPI.updateMovie ? window.electronAPI.updateMovie(id, data) : Promise.reject(new Error('Not implemented in Electron yet'));
        return backendFetch(`/api/movies/${id}`, { 
            method: 'PATCH',
            body: JSON.stringify(data)
        });
    },

    reIdentifyMovie: (id, title, year) => {
        if (isElectron()) return window.electronAPI.reIdentifyMovie ? window.electronAPI.reIdentifyMovie(id, title, year) : Promise.reject(new Error('Not implemented in Electron yet'));
        return backendFetch(`/api/movies/${id}/re-identify`, {
            method: 'POST',
            body: JSON.stringify({ title, year })
        });
    },

    onLibraryUpdated: (callback) => {
        if (isElectron() && window.electronAPI.onLibraryUpdated) {
            return window.electronAPI.onLibraryUpdated(callback);
        }
        // Web: Combine polling with a custom event for immediate updates
        const interval = setInterval(callback, 30000);
        window.addEventListener('library-updated', callback);
        
        return () => {
            clearInterval(interval);
            window.removeEventListener('library-updated', callback);
        };
    },

    // ── File Operations (Electron-only) ──────────────────────────────────────
    checkFileExists: (filePath) => {
        if (isElectron()) return window.electronAPI.checkFileExists(filePath);
        return Promise.resolve(false); // Files don't exist locally in web
    },

    checkAudio: (filePath) => {
        if (isElectron()) return window.electronAPI.checkAudio(filePath);
        return Promise.resolve({ codec: 'unknown', needsTranscode: false, subtitles: [] });
    },

    // ── Subtitles ─────────────────────────────────────────────────────────────
    searchSubtitles: (data) => {
        if (isElectron()) return window.electronAPI.searchSubtitles(data);
        return backendFetch('/api/subtitles/search', { method: 'POST', body: JSON.stringify(data) });
    },

    downloadSubtitle: (fileId, movieId) => {
        if (isElectron()) return window.electronAPI.downloadSubtitle(fileId, movieId);
        return backendFetch('/api/subtitles/download', { method: 'POST', body: JSON.stringify({ fileId, movieId }) });
    },

    findLocalSubtitle: (movieId) => {
        if (isElectron()) return window.electronAPI.findLocalSubtitle(movieId);
        return backendFetch(`/api/subtitles/local/check?movieId=${movieId}`);
    },

    checkCloudSubtitle: (movieId) => {
        if (isElectron()) return window.electronAPI.checkCloudSubtitle ? window.electronAPI.checkCloudSubtitle(movieId) : Promise.resolve({ found: false });
        return backendFetch(`/api/subtitles/cloud/check?movieId=${movieId}`);
    },

    // ── Google Drive ──────────────────────────────────────────────────────────
    checkDriveAuth: () => {
        if (isElectron()) return window.electronAPI.checkDriveAuth();
        return backendFetch('/api/auth/status').then(d => d.authenticated).catch(() => false);
    },

    authenticateDrive: () => {
        if (isElectron()) return window.electronAPI.authenticateDrive();
        // Web: open OAuth page in popup
        return new Promise((resolve, reject) => {
            const popup = window.open(`${BACKEND_URL}/api/auth/google`, 'Drive Auth', 'width=600,height=700');
            const timer = setInterval(() => {
                if (popup.closed) {
                    clearInterval(timer);
                    // Check if auth succeeded
                    backendFetch('/api/auth/status').then(d => {
                        if (d.authenticated) resolve(true);
                        else reject(new Error('Autenticación cancelada o fallida'));
                    }).catch(reject);
                }
            }, 500);
        });
    },

    disconnectDrive: () => {
        if (isElectron()) return window.electronAPI.disconnectDrive();
        return backendFetch('/api/auth/disconnect', { method: 'POST' });
    },

    listDriveFiles: (folderId) => {
        return backendFetch(`/api/drive/ls${folderId ? `?folderId=${folderId}` : ''}`);
    },

    getDriveSubtitleUrl: (fileId) => {
        return `${BACKEND_URL}/api/subtitles/drive?fileId=${fileId}`;
    },

    // ── Sessions ──────────────────────────────────────────────────────────────
    registerSession: (userId, email) => {
        return backendFetch('/api/auth/register-session', {
            method: 'POST',
            body: JSON.stringify({ userId, email })
        });
    },

    checkSession: () => {
        return backendFetch('/api/auth/session-check');
    },

    listSessions: () => {
        return backendFetch('/api/admin/sessions');
    },

    deleteSession: (sessionId) => {
        return backendFetch(`/api/admin/sessions/${sessionId}`, { method: 'DELETE' });
    },

    getRDToken: () => {
        return backendFetch('/api/admin/config/rd-token');
    },

    saveRDToken: (token) => {
        return backendFetch('/api/admin/config/rd-token', {
            method: 'POST',
            body: JSON.stringify({ token })
        });
    },

    // ── Discovery ─────────────────────────────────────────────────────────────
    exploreTrending: () => {
        return backendFetch('/api/discover/trending');
    },

    searchMoviesGlobal: (query) => {
        return backendFetch(`/api/discover/search?query=${encodeURIComponent(query)}`);
    },

    deepSearch: (query) => {
        return backendFetch(`/api/discover/deep-search?query=${encodeURIComponent(query)}`);
    },

    findTorrents: (title) => {
        return backendFetch(`/api/discover/torrents/${encodeURIComponent(title)}`);
    },

    downloadMovie: (tmdbId, title, magnet, year, options = {}) => {
        return backendFetch('/api/discover/download', {
            method: 'POST',
            body: JSON.stringify({ 
                movieId: tmdbId, 
                title, 
                magnet, 
                year,
                isPage: options.isPage,
                isHash: options.isHash
            })
        });
    },

    getDownloadProgress: (movieId) => {
        return backendFetch(`/api/discover/download-status/${movieId}`);
    },

    // ── Drive Streaming URL ───────────────────────────────────────────────────
    getCloudStreamUrl: (movieId) => {
        return `${BACKEND_URL}/api/drive/stream-cloud/${movieId}`;
    },

    getStuckUploads: () => {
        return backendFetch('/api/admin/stuck-uploads');
    },

    retryStuckUpload: (movieId) => {
        return backendFetch(`/api/admin/retry-stuck/${movieId}`, { method: 'POST' });
    },

    getStreamUrl: (fileId, filePath, options = {}) => {
        if (filePath && isElectron()) {
            const normalized = filePath.replace(/\\/g, '/');
            const match = normalized.match(/^([a-zA-Z]):(.*)/);
            const basePath = match ? `cine://${match[1]}${match[2]}` : `cine://${normalized}`;
            return `${basePath}${options.transcode ? `?transcode=true&t=${options.seekOffset || 0}` : ''}`;
        }
        if (fileId) {
            if (isElectron()) return `http://localhost:19998/stream/${fileId}${options.transcode ? `?transcode=true&t=${options.seekOffset || 0}` : ''}`;
            
            const sessionId = localStorage.getItem('cinevault_session_id') || localStorage.getItem('session_id') || '';
            const baseUrl = `${BACKEND_URL}/api/drive/stream/${fileId}`;
            const params = new URLSearchParams();
            
            if (sessionId) params.append('sessionId', sessionId);
            if (options.transcode) {
                params.append('transcode', 'true');
                params.append('t', options.seekOffset || 0);
            }
            
            const queryString = params.toString();
            return queryString ? `${baseUrl}?${queryString}` : baseUrl;
        }
        return null;
    },

    // ── Upload ────────────────────────────────────────────────────────────────
    uploadMovieToDrive: (movieId, filePath, mimeType, options) => {
        if (isElectron()) return window.electronAPI.uploadMovieToDrive(movieId, filePath, mimeType, options);
        // Web: try to tell the backend to upload the local path (works if backend is local)
        if (filePath) {
            let userEmail = '';
            try {
                const userStr = localStorage.getItem('sb-tlasrdqdjznjnchmtjcc-auth-token');
                if (userStr) userEmail = JSON.parse(userStr).user?.email || '';
            } catch (e) {}
            
            return backendFetch('/api/drive/upload-local', {
                method: 'POST',
                headers: { 'x-user-email': userEmail },
                body: JSON.stringify({ movieId, filePath, mimeType, options })
            });
        }
        return Promise.reject(new Error('Use uploadMovieFile for manual file selection in web'));
    },

    uploadToLibrary: async (files, targetPath, onProgress) => {
        // multipart/form-data for movie files
        const formData = new FormData();
        files.forEach(file => formData.append('files', file));
        formData.append('targetPath', targetPath || '');

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable && onProgress) {
                    onProgress(Math.round((e.loaded / e.total) * 100));
                }
            };
            xhr.onload = () => {
                try {
                    const result = JSON.parse(xhr.responseText);
                    if (xhr.status === 200) resolve(result);
                    else reject(new Error(result.error || 'Upload failed'));
                } catch (e) {
                    reject(new Error('Invalid response from server'));
                }
            };
            xhr.onerror = () => reject(new Error('Error de red durante la subida'));
            xhr.open('POST', `${BACKEND_URL}/api/movies/upload`);
            xhr.withCredentials = true;
            xhr.send(formData);
        });
    },

    uploadMovieFile: async (movieId, file, onProgress) => {
        // Web-only: upload via FormData
        const formData = new FormData();
        formData.append('file', file);
        formData.append('movieId', movieId);

        let userEmail = '';
        try {
            const userStr = localStorage.getItem('sb-tlasrdqdjznjnchmtjcc-auth-token');
            if (userStr) userEmail = JSON.parse(userStr).user?.email || '';
        } catch (e) {}

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable && onProgress) {
                    onProgress(Math.round((e.loaded / e.total) * 100));
                }
            };
            xhr.onload = () => {
                const result = JSON.parse(xhr.responseText);
                if (xhr.status === 200) resolve(result);
                else reject(new Error(result.error || 'Upload failed'));
            };
            xhr.onerror = () => reject(new Error('Network error during upload'));
            xhr.open('POST', `${BACKEND_URL}/api/drive/upload`);
            xhr.setRequestHeader('x-user-email', userEmail);
            xhr.withCredentials = true;
            xhr.send(formData);
        });
    },

    onDriveUploadProgress: (movieId, callback) => {
        if (isElectron()) return window.electronAPI.onDriveUploadProgress(movieId, callback);
        // Web: SSE from backend
        const es = new EventSource(`${BACKEND_URL}/api/drive/progress/${movieId}`, { withCredentials: true });
        es.onmessage = (e) => {
            try {
                if (e.data.trim() === ': heartbeat') return;
                const data = JSON.parse(e.data);
                if (data.heartbeat) return;
                callback(data);
            } catch (err) {
                // Ignore parse errors from heartbeat comments or invalid data
            }
        };
        return () => es.close();
    },

    getUploadQueue: () => {
        if (isElectron()) return window.electronAPI.getUploadQueue ? window.electronAPI.getUploadQueue() : Promise.resolve([]);
        return backendFetch('/api/drive/queue');
    },

    retryUpload: (movieId) => {
        if (isElectron()) return window.electronAPI.retryUpload ? window.electronAPI.retryUpload(movieId) : Promise.resolve();
        let userEmail = '';
        try {
            const userStr = localStorage.getItem('sb-tlasrdqdjznjnchmtjcc-auth-token');
            if (userStr) userEmail = JSON.parse(userStr).user?.email || '';
        } catch (e) {}
        return backendFetch('/api/drive/queue/retry', { method: 'POST', headers: { 'x-user-email': userEmail }, body: JSON.stringify({ movieId }) });
    },

    removeUploadFromQueue: (movieId) => {
        if (isElectron()) return window.electronAPI.removeUpload ? window.electronAPI.removeUpload(movieId) : Promise.resolve();
        let userEmail = '';
        try {
            const userStr = localStorage.getItem('sb-tlasrdqdjznjnchmtjcc-auth-token');
            if (userStr) userEmail = JSON.parse(userStr).user?.email || '';
        } catch (e) {}
        return backendFetch(`/api/drive/queue/${movieId}`, { method: 'DELETE', headers: { 'x-user-email': userEmail } });
    },

    // ── Settings ──────────────────────────────────────────────────────────────
    getFolders: () => {
        if (isElectron()) return window.electronAPI.getFolders();
        return backendFetch('/api/folders');
    },

    addFolder: (folderPath) => {
        if (isElectron()) return window.electronAPI.addFolder(folderPath); // You might need to add this to preload if missing
        return backendFetch('/api/folders', {
            method: 'POST',
            body: JSON.stringify({ folder_path: folderPath })
        });
    },

    openDirectory: () => {
        if (isElectron()) return window.electronAPI.openDirectory();
        return Promise.resolve(null); // Native dialog not available in web
    },

    ls: async (path) => {
        if (isElectron()) return Promise.reject(new Error('Use Electron APIs for local FS'));
        try {
            const url = path ? `/api/fs/ls?path=${encodeURIComponent(path)}` : '/api/fs/ls';
            const res = await backendFetch(url);
            return Array.isArray(res) ? res : [];
        } catch (err) {
            console.error('[API ls] Error:', err);
            return [];
        }
    },

    getDrives: () => {
        if (isElectron()) return Promise.reject(new Error('Use Electron APIs for local FS'));
        return backendFetch('/api/fs/drives').then(res => Array.isArray(res) ? res : []);
    },

    getHomeFolders: () => {
        if (isElectron()) return Promise.reject(new Error('Use Electron APIs for local FS'));
        return backendFetch('/api/fs/home');
    },

    removeFolder: (path) => {
        if (isElectron()) return window.electronAPI.removeFolder(path);
        return backendFetch('/api/folders', {
            method: 'DELETE',
            body: JSON.stringify({ folder_path: path })
        });
    },

    clearLibrary: () => {
        if (isElectron()) return window.electronAPI.clearLibrary();
        return backendFetch('/api/library/clear', { method: 'POST' });
    },

    getTMDBKey: () => {
        if (isElectron()) return window.electronAPI.getTMDBKey();
        return backendFetch('/api/admin/config/tmdb-key').then(res => res.key).catch(() => import.meta.env.VITE_TMDB_API_KEY || '');
    },

    saveTMDBKey: (key) => {
        if (isElectron()) return window.electronAPI.saveTMDBKey(key);
        return backendFetch('/api/admin/config/tmdb-key', {
            method: 'POST',
            body: JSON.stringify({ key })
        });
    },

    getOMDbKey: () => {
        if (isElectron()) return Promise.resolve(''); // TODO: Implement in Electron
        return backendFetch('/api/admin/config/omdb-key').then(res => res.key).catch(() => '');
    },

    saveOMDbKey: (key) => {
        if (isElectron()) return Promise.resolve(); // TODO: Implement in Electron
        return backendFetch('/api/admin/config/omdb-key', {
            method: 'POST',
            body: JSON.stringify({ key })
        });
    },

    getOSCredentials: () => {
        if (isElectron()) return window.electronAPI.getOSCredentials ? window.electronAPI.getOSCredentials() : Promise.resolve({});
        return backendFetch('/api/admin/config/os-credentials');
    },

    saveOSCredentials: (username, password) => {
        if (isElectron()) return window.electronAPI.saveOSCredentials ? window.electronAPI.saveOSCredentials(username, password) : Promise.resolve();
        return backendFetch('/api/admin/config/os-credentials', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
    },

    // ── User-specific data (progress & mylist) ──────────────────────────────────
    getUserProgress: (userId) => {
        if (isElectron()) return window.electronAPI.getUserProgress();
        return backendFetch('/api/user/progress', {}, { 'x-user-id': userId });
    },
    saveUserProgress: (userId, movieId, watchedDuration) => {
        if (isElectron()) return window.electronAPI.saveUserProgress(movieId, watchedDuration);
        return backendFetch('/api/user/progress', { 
            method: 'POST', 
            body: JSON.stringify({ movie_id: movieId, watched_duration: watchedDuration }) 
        }, { 'x-user-id': userId });
    },
    getUserMylist: (userId) => {
        if (isElectron()) return window.electronAPI.getUserMylist();
        return backendFetch('/api/user/mylist', {}, { 'x-user-id': userId });
    },
    addToMylist: (userId, movieId) => {
        if (isElectron()) return window.electronAPI.addToMylist(movieId);
        return backendFetch('/api/user/mylist', { 
            method: 'POST', 
            body: JSON.stringify({ movie_id: movieId }) 
        }, { 'x-user-id': userId });
    },
    removeFromMylist: (userId, movieId) => {
        if (isElectron()) return window.electronAPI.removeFromMylist(movieId);
        return backendFetch(`/api/user/mylist/${movieId}`, { method: 'DELETE' }, { 'x-user-id': userId });
    },

    getUserRating: (userId, movieId) => {
        if (isElectron()) return Promise.resolve({ rating: 0 });
        return backendFetch(`/api/user/rating/${movieId}`, {}, { 'x-user-id': userId });
    },
    saveUserRating: (userId, movieId, rating) => {
        if (isElectron()) return Promise.resolve();
        return backendFetch('/api/user/rating', { 
            method: 'POST', 
            body: JSON.stringify({ movie_id: movieId, rating }) 
        }, { 'x-user-id': userId });
    },

    // ── Movie Requests ────────────────────────────────────────────────────────
    submitMovieRequest: (data) => {
        return backendFetch('/api/requests', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    getAdminRequests: () => {
        return backendFetch('/api/admin/requests');
    },

    updateRequestStatus: (id, status) => {
        return backendFetch(`/api/admin/requests/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status })
        });
    },

    // ── Flags ─────────────────────────────────────────────────────────────────
    fetchMovieNews: () => {
        return backendFetch('/api/news');
    },

    isElectron,
    isWeb: () => !isElectron(),
};
