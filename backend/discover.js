const express = require('express');
const router = express.Router();
const torrentSearch = require('torrent-search-api');
const axios = require('axios');
const db = require('./db');
const torrentManager = require('./torrentManager');
const uploadManager = require('./uploadManager');
const { adminMiddleware } = require('./middleware');

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// Initialize torrent providers
torrentSearch.enableProvider('1337x');
torrentSearch.enableProvider('ThePirateBay');
torrentSearch.enableProvider('Yts');

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

// Find torrents for a specific TMDB movie
router.get('/torrents/:title', async (req, res) => {
    const title = req.params.title;
    try {
        // Search across enabled providers
        // We try a few search queries: Title original, and "Title Dual"
        let results = await torrentSearch.search(title, 'Movies', 20);
        
        // Filter and sort by quality and "Dual" tags
        const formatted = results.map(t => ({
            title: t.title,
            size: t.size,
            seeds: t.seeds,
            peers: t.peers,
            time: t.time,
            link: t.desc || t.magnet || t.link, // Magnet/Link
            provider: t.provider
        }))
        .filter(t => t.seeds > 0)
        .sort((a, b) => b.seeds - a.seeds);

        res.json(formatted);
    } catch (err) {
        console.error('[Discover] Torrent search error:', err.message);
        res.status(500).json({ error: 'Error al buscar torrents' });
    }
});

// Download a movie (Admin only)
router.post('/download', adminMiddleware, async (req, res) => {
    const { movieId, title, magnet, year } = req.body;
    
    if (!movieId || !title || !magnet) {
        return res.status(400).json({ error: 'Datos insuficientes' });
    }

    try {
        // 1. Add to local database if not exists (as a "shadow" entry until it's downloaded)
        // We might want get more details from TMDB first to have poster_url etc.
        const tmdbDetails = await fetchTMDB(`/movie/${movieId}`);
        let movie = await db.addMovie({
            title: tmdbDetails.title,
            year: year || tmdbDetails.release_date?.substring(0, 4),
            drive_file_id: 'pending_download', // Flag to show it's being fetched
            poster_url: tmdbDetails.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbDetails.poster_path}` : null,
            tmdb_id: movieId
        });

        // 2. Resolve Magnet Link if needed
        let finalMagnet = magnet;
        if (!magnet.startsWith('magnet:')) {
            const searchAgain = await torrentSearch.search(title, 'Movies', 10);
            const match = searchAgain.find(t => t.title === title) || searchAgain[0];
            if (match) {
                finalMagnet = await torrentSearch.getMagnet(match);
            }
        }
        
        // 3. Add to UploadManager queue as 'downloading'
        uploadManager.enqueue(movie.id, title, 'pending', 'video/mp4', { status: 'downloading' });

        // 4. Start Torrent Download
        torrentManager.addDownload(movie.id, title, finalMagnet, async (localPath, filename) => {
            // Callback when done: Update job to 'pending' with actual path
            console.log(`[Discover] Descarga terminada para ${title}. Iniciando proceso de subida...`);
            uploadManager.updateJob(movie.id, { 
                status: 'pending', 
                filePath: localPath,
                options: { deleteAfter: true, optimize: true }
            });
        });

        res.json({ message: 'Descarga iniciada', movieId: movie.id });
    } catch (err) {
        console.error('[Discover] Download error:', err);
        res.status(500).json({ error: 'Error al iniciar descarga: ' + err.message });
    }
});

// Get download progress
router.get('/download-status/:movieId', (req, res) => {
    const status = torrentManager.getDownloadStatus(req.params.movieId);
    if (!status) return res.status(404).json({ error: 'Descarga no activa' });
    res.json(status);
});

module.exports = router;
