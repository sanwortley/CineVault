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
    addMovie: async (movieData) => {
        // Remove fields that do not exist in the database schema or shouldn't be overridden
        const payload = { ...movieData };
        delete payload.modified_at;
        delete payload.created_at;

        return await supabaseFetch('movies', { 
            method: 'POST', 
            body: JSON.stringify(payload),
            headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' }
        });
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
        const payload = { ...movieData };
        delete payload.modified_at;
        delete payload.created_at;

        return await supabaseFetch(`movies?id=eq.${id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
        });
    },
    deleteMovie: async (id) => {
        return await supabaseFetch(`movies?id=eq.${id}`, { method: 'DELETE' });
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
        return await supabaseFetch('user_movie_progress', { 
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
