const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('./db');
const movieSearcher = require('./movieSearcher');
const debridManager = require('./debridManager');
const uploadManager = require('./uploadManager');
const { adminMiddleware } = require('./middleware');
const { normalizeFilename } = require('./parser');
const cheerio = require('cheerio');

const getTMDBKey = () => process.env.TMDB_API_KEY || '';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// --- Helper Functions ---
const fetchTMDB = async (endpoint, params = {}) => {
    const key = getTMDBKey();
    if (!key) throw new Error('TMDB_API_KEY no configurada');
    
    const response = await axios.get(`${TMDB_BASE_URL}${endpoint}`, {
        params: { api_key: key, language: 'es-ES', ...params }
    });
    return response.data;
};

// --- Routes ---

// Get trending movies for "Explore" page
router.get('/trending', async (req, res) => {
    try {
        const data = await fetchTMDB('/trending/movie/week');
        res.json(data.results);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener tendencias' });
    }
});

// Search global TMDB
router.get('/search', async (req, res) => {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: 'Falta consulta' });
    try {
        const data = await fetchTMDB('/search/movie', { query });
        res.json(data.results);
    } catch (err) {
        res.status(500).json({ error: 'Error en la búsqueda' });
    }
});

// Find sources for a specific movie
router.get('/torrents/:title', async (req, res) => {
    const title = req.params.title;
    try {
        const results = await movieSearcher.searchAll(title);
        res.json(results);
    } catch (err) {
        console.error('[Discover] Search error:', err.message);
        res.status(500).json({ error: 'Error al buscar fuentes' });
    }
});

// Download a movie (Admin only)
router.post('/download', adminMiddleware, async (req, res) => {
    const { movieId, title, magnet, isPage, isHash, year } = req.body;
    
    if (!movieId || !title || !magnet) {
        return res.status(400).json({ error: 'Datos insuficientes' });
    }

    try {
        let tmdbDetails = null;
        const isNumericId = !isNaN(parseInt(movieId)) && /^\d+$/.test(String(movieId));

        if (isNumericId) {
            try {
                tmdbDetails = await fetchTMDB(`/movie/${movieId}`);
            } catch (tmdbErr) {
                console.warn(`[Discover] Failed to fetch TMDB details for ID ${movieId}:`, tmdbErr.message);
            }
        }

        // --- Step 1.5: Aggressive Search if no details yet ---
        if (!tmdbDetails) {
            const { clean_title, year: parsedYear } = normalizeFilename(title);
            console.log(`[Discover] Pre-match normalization: "${title}" -> "${clean_title}" (${parsedYear || 'N/A'})`);
            try {
                const searchResults = await fetchTMDB('/search/movie', { 
                    query: clean_title, 
                    year: parsedYear || year 
                });
                if (searchResults.results && searchResults.results.length > 0) {
                    // Pick the best match (first one)
                    tmdbDetails = await fetchTMDB(`/movie/${searchResults.results[0].id}`);
                    console.log(`[Discover] Encontrado match oficial en TMDB: "${tmdbDetails.title}"`);
                }
            } catch (searchErr) {
                console.warn(`[Discover] Falló búsqueda agresiva para "${clean_title}":`, searchErr.message);
            }
        }

        // --- Step 1: Create or Get Movie Entry ---
        // Ensuring no NULL values for mandatory columns
        const finalOfficialTitle = tmdbDetails?.title || tmdbDetails?.original_title || title || '';
        
        let movie = await db.addMovie({
            official_title: finalOfficialTitle,
            detected_title: title || '',
            detected_year: year || tmdbDetails?.release_date?.substring(0, 4) || new Date().getFullYear().toString(),
            file_name: title || 'unknown_movie',
            file_path: `remote://cloud-ingestion/${title || 'unknown'}`,
            file_size: 0,
            extension: '.mp4',
            drive_file_id: 'pending_cloud', 
            poster_url: tmdbDetails?.poster_url || (tmdbDetails?.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbDetails.poster_path}` : ''),
            backdrop_url: tmdbDetails?.backdrop_url || '',
            overview: tmdbDetails?.overview || '',
            genres: tmdbDetails?.genres || '',
            director: tmdbDetails?.director || '',
            cast: tmdbDetails?.cast || '',
            rating: tmdbDetails?.rating || 0
        });

        if (!movie || !movie.id) {
            // Last ditch effort: try finding by title if addMovie failed (though it should handle it now)
            console.log('[Discover] Movie creation failed, searching as last resort:', title);
            const search = await db.findMovies({ official_title: title });
            movie = search.length > 0 ? search[0] : null;
        }

        if (!movie || !movie.id) {
            throw new Error('No se pudo crear ni encontrar el registro de la película en la base de datos');
        }

        // 2. Add to Queue as 'converting'
        uploadManager.enqueue(movie.id, title, 'pending', 'video/mp4', { status: 'converting' });
        
        // Use normalized title for follow-up
        const finalTitle = movie.title || title;

        // 3. Resolve Magnet if it's a page link
        let finalMagnet = magnet;
        if (isHash) {
            finalMagnet = `magnet:?xt=urn:btih:${magnet}&dn=${encodeURIComponent(title)}`;
        } else if (isPage) {
            console.log('[Discover] Resolviendo magnet desde página...');
            const pageResp = await axios.get(magnet);
            const $ = cheerio.load(pageResp.data);
            finalMagnet = $('a[href^="magnet:"]').first().attr('href');
        }

        if (!finalMagnet) throw new Error('No se pudo resolver el enlace magnet');

        // 4. Trigger Real-Debrid Flow in background
        (async () => {
            try {
                const debridResult = await debridManager.processMagnet(finalMagnet, (progress, status) => {
                    uploadManager.updateJob(movie.id, { 
                        progress, 
                        status: `converting (${status})` 
                    });
                });

                console.log(`[Discover] Enlace listo: ${debridResult.downloadUrl}`);
                
                // 5. Update job to 'pending-fetch' (Now uploadManager will download from URL)
                uploadManager.updateJob(movie.id, { 
                    status: 'pending', 
                    filePath: debridResult.downloadUrl, // URL instead of local path
                    isUrl: true,
                    options: { deleteAfter: true, optimize: true }
                });

            } catch (err) {
                console.error('[Discover] Debrid process failed:', err.message);
                uploadManager.updateJob(movie.id, { status: 'error', error: err.message });
            }
        })();

        res.json({ message: 'Proceso iniciado vía Real-Debrid', movieId: movie.id });
    } catch (err) {
        console.error('[Discover] Download error:', err);
        res.status(500).json({ error: 'Error al iniciar proceso Cloud: ' + err.message });
    }
});

// Get download progress
router.get('/download-status/:movieId', (req, res) => {
    const job = uploadManager.getJobStatus(req.params.movieId);
    if (!job) return res.status(404).json({ error: 'Descarga no activa o terminada' });
    res.json({
        progress: job.progress,
        status: job.status,
        error: job.error
    });
});

// Direct torrent search (non-TMDB)
router.get('/deep-search', async (req, res) => {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: 'Query requerida' });
    
    try {
        const results = await movieSearcher.searchGlobal(query);
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: 'Error en búsqueda profunda' });
    }
});

module.exports = router;
