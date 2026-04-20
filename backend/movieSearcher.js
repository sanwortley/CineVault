const axios = require('axios');
const cheerio = require('cheerio');

// Realistic headers to avoid bot detection on cloud providers (Railway/AWS)
const COMMON_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache'
};

async function searchYTS(query) {
    try {
        const response = await axios.get(`https://yts.mx/api/v2/list_movies.json`, {
            params: {
                query_term: query,
                limit: 10,
                sort_by: 'seeds'
            },
            headers: COMMON_HEADERS,
            timeout: 8000
        });

        if (response.data?.data?.movies) {
            return response.data.data.movies.map(m => {
                const best = m.torrents.reduce((prev, curr) => (parseInt(prev.quality) > parseInt(curr.quality) ? prev : curr));
                return {
                    title: `${m.title_long} [${best.quality}]`,
                    size: best.size,
                    seeds: best.seeds,
                    link: best.hash,
                    isHash: true,
                    provider: 'YTS'
                };
            });
        }
        return [];
    } catch (err) {
        console.error('[Searcher] YTS Error:', err.message);
        return [];
    }
}

async function searchTPB(query) {
    try {
        const response = await axios.get(`https://apibay.org/q.php?q=${encodeURIComponent(query)}`, {
            headers: COMMON_HEADERS,
            timeout: 8000
        });
        
        if (Array.isArray(response.data)) {
            return response.data
                .filter(item => item.id !== '0' && item.info_hash !== '0000000000000000000000000000000000000000')
                .map(item => ({
                    title: item.name,
                    size: (parseInt(item.size) / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
                    seeds: parseInt(item.seeders) || 0,
                    link: item.info_hash,
                    isHash: true,
                    provider: 'PirateBay'
                }));
        }
        return [];
    } catch (err) {
        console.error('[Searcher] TPB Error:', err.message);
        return [];
    }
}

async function searchSolid(query) {
    try {
        // SolidTorrents has a very cloud-friendly API
        const response = await axios.get(`https://solidtorrents.to/api/v1/search`, {
            params: {
                q: query,
                category: 'Video',
                sort: 'seeders'
            },
            headers: COMMON_HEADERS,
            timeout: 8000
        });

        if (response.data?.results) {
            return response.data.results.map(item => ({
                title: item.title,
                size: (item.size / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
                seeds: item.swarm.seeders || 0,
                link: item.magnet,
                isHash: false, // SolidTorrents returns full magnets
                provider: 'Solid'
            }));
        }
        return [];
    } catch (err) {
        console.error('[Searcher] SolidTorrents Error:', err.message);
        return [];
    }
}

async function searchGlobal(query) {
    // We use AllSettled to ensure that one failing provider doesn't kill the whole search
    const results = await Promise.allSettled([
        searchSolid(query),
        searchYTS(query),
        searchTPB(query)
    ]);
    
    let combined = [];
    results.forEach(res => {
        if (res.status === 'fulfilled') {
            combined = [...combined, ...res.value];
        }
    });

    // Unique by title or hash/magnet if possible, but for now simple sort
    return combined.sort((a, b) => b.seeds - a.seeds);
}

async function searchAll(query) {
    const results = await Promise.allSettled([
        searchYTS(query),
        searchSolid(query)
    ]);
    
    let combined = [];
    results.forEach(res => {
        if (res.status === 'fulfilled') {
            combined = [...combined, ...res.value];
        }
    });
    
    return combined.sort((a, b) => b.seeds - a.seeds);
}

module.exports = { searchAll, searchGlobal };
