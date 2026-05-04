const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('[DB] SUPABASE_URL or SUPABASE_ANON_KEY is not set in .env');
}

const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json'
};

async function supabaseFetch(endpoint, options = {}) {
    if (!SUPABASE_URL) return null;
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
            ...options,
            headers: { ...headers, ...(options.headers || {}) }
        });
        
        if (!res.ok) {
            let err;
            try { err = await res.json(); } catch(e) { err = { message: res.statusText }; }
            console.error(`[Supabase Error] ${options.method || 'GET'} ${endpoint}:`, err);
            // Ignore duplicate key errors gracefully
            if (err.code === '23505') return null;
            throw new Error(err.message || JSON.stringify(err));
        }
        
        if (res.status === 204) return null; // No content (like DELETE)
        
        const text = await res.text();
        if (!text) return null;
        try {
            return JSON.parse(text);
        } catch (e) {
            console.warn(`[Supabase] Failed to parse JSON response from ${endpoint}:`, text);
            return null;
        }
    } catch (err) {
        if (err.cause) {
            console.error(`[Supabase Fetch Error] Detalle de red:`, err.cause);
        } else {
            console.error(`[Supabase Fetch Error] on ${endpoint}:`, err.message);
        }
        throw err;
    }
}

const database = {
    getFolders: async () => {
        return await supabaseFetch('folders?select=*') || [];
    },
    addFolder: async (folder_path) => {
        return await supabaseFetch('folders', { 
            method: 'POST', 
            body: JSON.stringify({ folder_path }),
            headers: { 'Prefer': 'resolution=ignore-duplicates' }
        });
    },
    removeFolder: async (folder_path) => {
        return await supabaseFetch(`folders?folder_path=eq.${encodeURIComponent(folder_path)}`, { method: 'DELETE' });
    },
    getMovies: async () => {
        return await supabaseFetch('movies?select=*&order=created_at.desc') || [];
    },
    findMovies: async (filters = {}) => {
        // Build query string from filters
        const queryParams = Object.entries(filters)
            .map(([key, val]) => `${key}=eq.${encodeURIComponent(val)}`)
            .join('&');
        const endpoint = `movies?select=*${queryParams ? '&' + queryParams : ''}`;
        return await supabaseFetch(endpoint) || [];
    },
    sanitizePayload: (data) => {
        const payload = { ...data };
        // Remove fields that definitely don't exist in production schema
        const legacyFields = ['original_title', 'imdb_rating', 'tmdb_id', 'release_date', 'modified_at', 'created_at', 'id'];
        legacyFields.forEach(f => delete payload[f]);

        // Convert empty strings to null for numeric fields to avoid Supabase errors
        const numericFields = ['detected_year', 'runtime', 'rating', 'watched_duration', 'video_width', 'video_height', 'video_bitrate', 'duration_seconds'];
        numericFields.forEach(f => {
            if (payload[f] === '') payload[f] = null;
            if (f === 'detected_year' && payload[f]) {
                const year = parseInt(payload[f]);
                payload[f] = isNaN(year) ? null : year;
            }
        });

        // Handle new video metadata fields
        const metadataFields = ['video_width', 'video_height', 'video_codec', 'audio_codec', 'video_bitrate', 'duration_seconds', 'original_resolution'];
        metadataFields.forEach(f => {
            if (payload[f] === undefined || payload[f] === '') {
                delete payload[f]; // Let Supabase use default/null
            }
        });

        return payload;
    },
    addMovie: async (movieData) => {
        const payload = database.sanitizePayload(movieData);
        console.log('[DB] Attempting addMovie with payload:', JSON.stringify(payload, null, 2));

        try {
            let existing = null;
            
            // Check by exact path (only for local files)
            if (payload.file_path && !payload.file_path.startsWith('remote://')) {
                const byPath = await database.findMovies({ file_path: payload.file_path });
                if (byPath.length > 0) existing = byPath[0];
            }
            
            // Check by official title and year
            if (!existing && payload.official_title && payload.detected_year) {
                const byTitle = await database.findMovies({ official_title: payload.official_title, detected_year: payload.detected_year });
                if (byTitle.length > 0) {
                    existing = byTitle[0];
                } else {
                    // Try loosely matching title without tags like [English]
                    const baseTitle = payload.official_title.replace(/\s*\[.*?\]/g, '').trim();
                    if (baseTitle && baseTitle !== payload.official_title) {
                        const allMovies = await database.getMovies();
                        const looseMatch = allMovies.find(m => 
                            m.official_title && 
                            m.official_title.replace(/\s*\[.*?\]/g, '').trim() === baseTitle &&
                            m.detected_year == payload.detected_year
                        );
                        if (looseMatch) existing = looseMatch;
                    } else {
                        // Also check if the DB has a title with a tag and we are adding one without
                        const allMovies = await database.getMovies();
                        const looseMatch = allMovies.find(m => 
                            m.official_title && 
                            m.official_title.replace(/\s*\[.*?\]/g, '').trim() === payload.official_title &&
                            m.detected_year == payload.detected_year
                        );
                        if (looseMatch) existing = looseMatch;
                    }
                }
            }

            if (existing) {
                console.log(`[DB] Duplicado detectado para "${payload.official_title}". Actualizando el registro existente (ID: ${existing.id})...`);
                if (existing.drive_file_id && existing.drive_file_id !== 'pending_cloud' && payload.drive_file_id === 'pending_cloud') {
                    delete payload.drive_file_id;
                }
                await database.updateMovie(existing.id, payload);
                return { ...existing, ...payload };
            }

            const res = await supabaseFetch('movies', { 
                method: 'POST', 
                body: JSON.stringify(payload),
                headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' }
            });
            
            if (Array.isArray(res) && res.length > 0) return res[0];
            if (res && res.id) return res;
            
            // If it returned null (duplicate handled in supabaseFetch), try to find it
            console.log(`[DB] Movie creation returned null (likely duplicate), finding existing: ${payload.official_title}`);
            const existing = await database.findMovies({ official_title: payload.official_title });
            return existing.length > 0 ? existing[0] : null;
        } catch (err) {
            console.error('[DB] addMovie error:', err.message);
            // Fallback: search for existing movie
            const existing = await database.findMovies({ official_title: payload.official_title, detected_year: payload.detected_year });
            return existing.length > 0 ? existing[0] : null;
        }
    },
    setDriveFileId: async (id, drive_file_id) => {
        return await supabaseFetch(`movies?id=eq.${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ drive_file_id })
        });
    },
    updateMovieProgress: async (id, watched_duration) => {
        return await supabaseFetch(`movies?id=eq.${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ 
                watched_duration,
                last_watched_at: new Date().toISOString()
            })
        });
    },
    updateMovie: async (id, movieData) => {
        const payload = database.sanitizePayload(movieData);

        return await supabaseFetch(`movies?id=eq.${id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
        });
    },
    deleteMovie: async (id) => {
        return await supabaseFetch(`movies?id=eq.${id}`, { method: 'DELETE' });
    },
    getMovieByFileId: async (fileId) => {
        const results = await supabaseFetch(`movies?drive_file_id=eq.${fileId}&select=*`) || [];
        if (results.length === 0) return null;
        const movie = results[0];
        // Convert runtime (minutes) to duration (seconds) if needed
        if (movie.runtime && !movie.duration) {
            movie.duration = movie.runtime * 60;
        }
        return movie;
    },
    removeMoviesLike: async (matchPath, onlyLocal = false) => {
        let endpoint = `movies?file_path=ilike.${encodeURIComponent(matchPath)}`;
        if (onlyLocal) {
            endpoint += `&drive_file_id=is.null`;
        }
        return await supabaseFetch(endpoint, { method: 'DELETE' });
    },
    clearMovies: async () => {
        return await supabaseFetch('movies?id=gt.0', { method: 'DELETE' });
    },
    clearFolders: async () => {
        return await supabaseFetch('folders?id=gt.0', { method: 'DELETE' });
    },
    
    // User-specific data (per-user progress and mylist)
    getUserProgress: async (userId) => {
        return await supabaseFetch(`user_movie_progress?user_id=eq.${userId}&select=*`) || [];
    },
    saveUserProgress: async (userId, movieId, watchedDuration) => {
        return await supabaseFetch('user_movie_progress?on_conflict=user_id,movie_id', { 
            method: 'POST', 
            body: JSON.stringify({ 
                user_id: userId,
                movie_id: movieId,
                watched_duration: watchedDuration,
                updated_at: new Date().toISOString()
            }),
            headers: { 'Prefer': 'resolution=merge-duplicates' }
        });
    },
    hideUserProgress: async (userId, movieId) => {
        return await supabaseFetch(`user_movie_progress?user_id=eq.${userId}&movie_id=eq.${movieId}`, {
            method: 'PATCH',
            body: JSON.stringify({ is_hidden: true })
        });
    },
    
    getUserMylist: async (userId) => {
        return await supabaseFetch(`user_mylist?user_id=eq.${userId}&select=*`) || [];
    },
    addToMylist: async (userId, movieId) => {
        return await supabaseFetch('user_mylist', { 
            method: 'POST', 
            body: JSON.stringify({ user_id: userId, movie_id: movieId }),
            headers: { 'Prefer': 'resolution=ignore-duplicates' }
        });
    },
    removeFromMylist: async (userId, movieId) => {
        return await supabaseFetch(`user_mylist?user_id=eq.${userId}&movie_id=eq.${movieId}`, { method: 'DELETE' });
    },
    isInMylist: async (userId, movieId) => {
        const result = await supabaseFetch(`user_mylist?user_id=eq.${userId}&movie_id=eq.${movieId}&select=id`) || [];
        return result.length > 0;
    },
    
    // User Ratings
    getUserRating: async (userId, movieId) => {
        const results = await supabaseFetch(`user_movie_ratings?user_id=eq.${userId}&movie_id=eq.${movieId}&select=rating`) || [];
        return results.length > 0 ? results[0].rating : null;
    },
    saveUserRating: async (userId, movieId, rating) => {
        // Use upsert-like behavior with Prefer: resolution=merge-duplicates
        return await supabaseFetch('user_movie_ratings', {
            method: 'POST',
            body: JSON.stringify({
                user_id: userId,
                movie_id: movieId,
                rating: rating,
                updated_at: new Date().toISOString()
            }),
            headers: { 'Prefer': 'resolution=merge-duplicates' }
        });
    },
    
    // Session Management
    registerSession: async (userId, email, userAgent, ip) => {
        // First, delete old sessions for this email (Unique session per email)
        await supabaseFetch(`sessions?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE' });
        
        // Create new session
        return await supabaseFetch('sessions', {
            method: 'POST',
            body: JSON.stringify({
                user_id: userId,
                email: email,
                user_agent: userAgent,
                ip_address: ip,
                last_active: new Date().toISOString()
            }),
            headers: { 'Prefer': 'return=representation' }
        });
    },
    validateSession: async (sessionId, timeoutMinutes = 60) => {
        const sessions = await supabaseFetch(`sessions?id=eq.${sessionId}&select=*`) || [];
        if (sessions.length === 0) return null;
        
        const session = sessions[0];
        const lastActive = new Date(session.last_active);
        const now = new Date();
        const diffMs = now - lastActive;
        const diffMins = Math.floor(diffMs / 60000);
        
        if (diffMins > timeoutMinutes) {
            console.warn(`[DB] Session ${sessionId} expired due to inactivity (${diffMins}m > ${timeoutMinutes}m)`);
            await database.deleteSession(sessionId);
            return null;
        }
        
        // Update last_active
        await supabaseFetch(`sessions?id=eq.${sessionId}`, {
            method: 'PATCH',
            body: JSON.stringify({ last_active: now.toISOString() })
        });
        
        return session;
    },
    listSessions: async () => {
        return await supabaseFetch('sessions?select=*&order=last_active.desc') || [];
    },
    deleteSession: async (sessionId) => {
        return await supabaseFetch(`sessions?id=eq.${sessionId}`, { method: 'DELETE' });
    },
    cleanupExpiredSessions: async (timeoutMinutes = 60) => {
        // This is harder with Supabase REST API (no complex DELETE where with date math easily)
        // For now, we'll rely on on-demand validation cleanup or simple full clear if desired.
        // A better way would be a Supabase function, but we'll list and delete for now if called.
        const all = await database.listSessions();
        const now = new Date();
        const expired = all.filter(s => {
            const diff = now - new Date(s.last_active);
            return (diff / 60000) > timeoutMinutes;
        });
        
        for (const s of expired) {
            await database.deleteSession(s.id);
        }
        return expired.length;
    },

    // Movie Requests
    addRequest: async (requestData) => {
        return await supabaseFetch('movie_requests', {
            method: 'POST',
            body: JSON.stringify(requestData),
            headers: { 'Prefer': 'return=representation' }
        });
    },
    getRequests: async (filters = {}) => {
        const queryParams = Object.entries(filters)
            .map(([key, val]) => `${key}=eq.${encodeURIComponent(val)}`)
            .join('&');
        const endpoint = `movie_requests?select=*${queryParams ? '&' + queryParams : ''}&order=created_at.desc`;
        return await supabaseFetch(endpoint) || [];
    },
    updateRequest: async (id, data) => {
        return await supabaseFetch(`movie_requests?id=eq.${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data)
        });
    },
    
    // Global Config Persistence (using folders table as a hack for key-value store)
    getGlobalConfig: async (key) => {
        try {
            const results = await supabaseFetch(`folders?folder_path=ilike.CONFIG:${key}:*&select=folder_path`);
            if (results && results.length > 0) {
                const prefix = `CONFIG:${key}:`;
                return JSON.parse(results[0].folder_path.substring(prefix.length));
            }
        } catch (e) {
            console.error(`[DB] getGlobalConfig error for ${key}:`, e.message);
        }
        return null;
    },
    setGlobalConfig: async (key, value) => {
        try {
            const prefix = `CONFIG:${key}:`;
            const payload = prefix + JSON.stringify(value);
            
            // Delete existing
            await supabaseFetch(`folders?folder_path=ilike.CONFIG:${key}:*`, { method: 'DELETE' });
            
            // Insert new
            return await supabaseFetch('folders', {
                method: 'POST',
                body: JSON.stringify({ folder_path: payload }),
                headers: { 'Prefer': 'resolution=merge-duplicates' }
            });
        } catch (e) {
            console.error(`[DB] setGlobalConfig error for ${key}:`, e.message);
        }
    },
    
    supabaseFetch: supabaseFetch
};

// Quick connection test
if (SUPABASE_URL) {
    supabaseFetch('folders?select=id&limit=1').then(() => {
        // Connected successfully
    }).catch(err => {
        console.error('[DB] Cloud Database connection failed:', err.message);
    });
}

module.exports = database;
