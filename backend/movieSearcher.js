const axios = require('axios');
const cheerio = require('cheerio');

async function searchYTS(query) {
    try {
        const response = await axios.get(`https://yts.mx/api/v2/list_movies.json`, {
            params: {
                query_term: query,
                limit: 10,
                sort_by: 'seeds'
            }
        });

        if (response.data?.data?.movies) {
            return response.data.data.movies.map(m => {
                // Find the best quality torrent
                const best = m.torrents.reduce((prev, curr) => (parseInt(prev.quality) > parseInt(curr.quality) ? prev : curr));
                return {
                    title: `${m.title_long} [${best.quality}]`,
                    size: best.size,
                    seeds: best.seeds,
                    link: best.hash, // Link is a hash for magnet construction
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

async function searchSpanish(query) {
    // This is a basic scraper for a Spanish source (example: DonTorrent mirror)
    // We'll use a resilient approach
    try {
        // Note: We use a generic approach to avoid hardcoding domain that might die
        // Searching for Dual/Castellano versions
        const response = await axios.get(`https://1337x.to/category-search/${encodeURIComponent(query + ' Dual')}/Movies/1/`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        const $ = cheerio.load(response.data);
        const results = [];
        
        $('.table-list tbody tr').each((i, el) => {
            if (i > 10) return;
            const $el = $(el);
            const title = $el.find('.name a').last().text();
            const link = $el.find('.name a').last().attr('href');
            const seeds = $el.find('.seeds').text();
            const size = $el.find('.size').text().replace('B ', 'B');
            
            results.push({
                title,
                size,
                seeds: parseInt(seeds) || 0,
                link: `https://1337x.to${link}`,
                isPage: true,
                provider: '1337x'
            });
        });
        
        return results;
    } catch (err) {
        console.error('[Searcher] 1337x Error:', err.message);
        return [];
    }
}

async function searchTPB(query) {
    try {
        const response = await axios.get(`https://apibay.org/q.php?q=${encodeURIComponent(query)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 5000
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

async function searchGlobal(query) {
    // Combine YTS and TPB for a very stable global search
    const [tpbResults, ytsResults] = await Promise.all([
        searchTPB(query),
        searchYTS(query)
    ]);
    
    // Merge and sort
    const combined = [...tpbResults, ...ytsResults].sort((a, b) => b.seeds - a.seeds);
    
    // If absolutely nothing found, try 1337x as a last resort (might fail due to 403)
    if (combined.length === 0) {
        try {
            const x1337 = await searchSpanish(query); // It uses 1337x but without the "Dual" appended in this scope if we refactor
            return x1337;
        } catch (e) {
            return [];
        }
    }
    
    return combined;
}

async function searchAll(query) {
    const [yts, spanish] = await Promise.all([
        searchYTS(query),
        searchSpanish(query)
    ]);
    
    return [...spanish, ...yts].sort((a, b) => (b.seeds || 0) - (a.seeds || 0));
}

module.exports = { searchAll, searchGlobal };
