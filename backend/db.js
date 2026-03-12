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
        console.error(`[Supabase Fetch Error] on ${endpoint}:`, err.message);
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
        return await supabaseFetch('movies', { 
            method: 'POST', 
            body: JSON.stringify(movieData),
            headers: { 'Prefer': 'resolution=ignore-duplicates' }
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
    deleteMovie: async (id) => {
        return await supabaseFetch(`movies?id=eq.${id}`, { method: 'DELETE' });
    },
    removeMoviesLike: async (matchPath) => {
        return await supabaseFetch(`movies?file_path=like.${encodeURIComponent(matchPath)}`, { method: 'DELETE' });
    },
    clearMovies: async () => {
        return await supabaseFetch('movies?id=gt.0', { method: 'DELETE' });
    },
    clearFolders: async () => {
        return await supabaseFetch('folders?id=gt.0', { method: 'DELETE' });
    }
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
