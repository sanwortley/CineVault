const axios = require('axios');
const db = require('./db');
const movieSearcher = require('./movieSearcher');
const debridManager = require('./debridManager');
const uploadManager = require('./uploadManager');
const { adminMiddleware } = require('./middleware');
const cheerio = require('cheerio');

// --- Helper Functions ---
const fetchTMDB = async (endpoint, params = {}) => {
    const response = await axios.get(`${TMDB_BASE_URL}${endpoint}`, {
        params: { api_key: TMDB_API_KEY, language: 'es-ES', ...params }
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
        // 1. Initial Shadow Record
        const tmdbDetails = await fetchTMDB(`/movie/${movieId}`);
        let movie = await db.addMovie({
            title: tmdbDetails.title,
            year: year || tmdbDetails.release_date?.substring(0, 4),
            drive_file_id: 'pending_cloud', 
            poster_url: tmdbDetails.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbDetails.poster_path}` : null,
            tmdb_id: movieId
        });

        // 2. Add to Queue as 'converting'
        uploadManager.enqueue(movie.id, title, 'pending', 'video/mp4', { status: 'converting' });

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
    const status = torrentManager.getDownloadStatus(req.params.movieId);
    if (!status) return res.status(404).json({ error: 'Descarga no activa' });
    res.json(status);
});

module.exports = router;
