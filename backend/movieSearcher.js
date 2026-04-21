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
    const mirrors = [
        'https://yts.mx/api/v2',
        'https://yts.pm/api/v2',
        'https://yts.lt/api/v2',
        'https://yts.rs/api/v2'
    ];

    for (const mirror of mirrors) {
        try {
            console.log(`[Searcher] Trying YTS Mirror: ${mirror}`);
            const response = await axios.get(`${mirror}/list_movies.json`, {
                params: {
                    query_term: query,
                    limit: 10,
                    sort_by: 'seeds'
                },
                headers: COMMON_HEADERS,
                timeout: 5000
            });

            if (response.data?.data?.movies) {
                return response.data.data.movies.map(m => {
                    const best = m.torrents.reduce((prev, curr) => {
                        const pSeeds = parseInt(prev.seeds) || 0;
                        const cSeeds = parseInt(curr.seeds) || 0;
                        return (pSeeds >= cSeeds ? prev : curr);
                    });
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
        } catch (err) {
            console.warn(`[Searcher] YTS Mirror ${mirror} failed:`, err.message);
        }
    }
    return [];
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
            const isApi = mirror.includes('apibay');
            const url = isApi 
                ? `${mirror}/q.php?q=${encodeURIComponent(query)}`
                : `${mirror}/search/${encodeURIComponent(query)}/1/99/0`;
            
            const response = await axios.get(url, {
                headers: COMMON_HEADERS,
                timeout: 5000
            });
            
            if (isApi) {
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
                // Skimming simple mirrors that might return HTML
                const $ = cheerio.load(response.data);
                const results = [];
                $('#searchResult tr').each((i, el) => {
                    const title = $(el).find('.detName').text().trim();
                    const magnet = $(el).find('a[href^="magnet:"]').attr('href');
                    const seeders = parseInt($(el).find('td[align="right"]').first().text()) || 0;
                    if (title && magnet) {
                        results.push({
                            title,
                            link: magnet,
                            seeds: seeders,
                            isHash: false,
                            provider: 'PirateBay'
                        });
                    }
                });
                if (results.length > 0) return results;
            }
        } catch (err) {
            console.warn(`[Searcher] TPB Mirror ${mirror} failed:`, err.message);
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

async function searchSubtitlesFallback(imdbId, title) {
    try {
        console.log(`[Searcher] Fallback subtitle search (YIFY) for: ${title}`);
        // YIFY Subtitles search is often based on the slugified title or IMDB ID
        // The most reliable search is via IMDB ID if possible
        const searchUrl = `https://yifysubtitles.org/movie-imdb/${imdbId}`;
        const response = await axios.get(searchUrl, { headers: COMMON_HEADERS, timeout: 8000 });
        
        const $ = cheerio.load(response.data);
        const results = [];
        
        $('.other-subs tr').each((i, el) => {
            const lang = $(el).find('.flag').attr('class')?.replace('flag ', '') || '';
            const language = lang === 'es' ? 'es' : (lang === 'en' ? 'en' : '');
            
            if (language) {
                const subLink = $(el).find('a').attr('href');
                const release = $(el).find('.sub-download').prev().text().trim();
                
                if (subLink) {
                    results.push({
                        id: subLink.split('/').pop(),
                        language,
                        release: release || title,
                        provider: 'YIFY (Fallback)',
                        type: 'cloud',
                        link: `https://yifysubtitles.org${subLink}`
                    });
                }
            }
        });
        
        return results;
    } catch (err) {
        console.warn('[Searcher] Fallback subtitles search failed:', err.message);
        return [];
    }
}

module.exports = { searchAll, searchGlobal, searchSubtitlesFallback };
