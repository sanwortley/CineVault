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
    const mirrors = [
        'https://apibay.org',
        'https://thepiratebay0.org',
        'https://piratebay.party',
        'https://tpblist.info'
    ];

    for (const mirror of mirrors) {
        try {
            console.log(`[Searcher] Trying TPB mirror: ${mirror}`);
            const url = mirror.includes('apibay') 
                ? `${mirror}/q.php?q=${encodeURIComponent(query)}`
                : `${mirror}/search/${encodeURIComponent(query)}/1/99/0`;
            
            const response = await axios.get(url, {
                headers: COMMON_HEADERS,
                timeout: 6000
            });
            
            if (mirror.includes('apibay')) {
                if (Array.isArray(response.data) && response.data.length > 0 && response.data[0].id !== '0') {
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
            } else {
                // Basic scraper for mirrors if needed, but for now we focus on APIS
                // Most mirrors are HTML only, so we'd need cheerio here if we really want them.
                // For now, let's stick to Solid and YTS as primary and TPB apibay as secondary.
            }
        } catch (err) {
            console.error(`[Searcher] TPB Mirror ${mirror} failed:`, err.message);
        }
    }
    return [];
}

async function searchSolid(query) {
    const mirrors = [
        'https://solidtorrents.to/api/v1',
        'https://solidtorrents.net/api/v1',
        'https://solidtorrents.ch/api/v1'
    ];

    for (const mirror of mirrors) {
        try {
            console.log(`[Searcher] Trying Solid Mirror: ${mirror}`);
            const response = await axios.get(`${mirror}/search`, {
                params: {
                    q: query,
                    category: 'Video',
                    sort: 'seeders'
                },
                headers: COMMON_HEADERS,
                timeout: 5000
            });
            
            if (response.data?.results) {
                return response.data.results.map(item => ({
                    title: item.title,
                    size: (item.size / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
                    seeds: item.swarm.seeders || 0,
                    link: item.magnet,
                    isHash: false,
                    provider: 'Solid'
                }));
            }
        } catch (err) {
            console.error(`[Searcher] Solid Mirror ${mirror} failed:`, err.message);
        }
    }
    return [];
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
