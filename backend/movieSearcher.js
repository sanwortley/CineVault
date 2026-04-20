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

async function searchGlobal(query) {
    try {
        const response = await axios.get(`https://1337x.to/search/${encodeURIComponent(query)}/1/`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        const $ = cheerio.load(response.data);
        const results = [];
        
        $('.table-list tbody tr').each((i, el) => {
            if (i > 15) return;
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
        
        return results.sort((a, b) => b.seeds - a.seeds);
    } catch (err) {
        console.error('[Searcher] Global Error:', err.message);
        return [];
    }
}

async function searchAll(query) {
    const [yts, spanish] = await Promise.all([
        searchYTS(query),
        searchSpanish(query)
    ]);
    
    return [...spanish, ...yts].sort((a, b) => (b.seeds || 0) - (a.seeds || 0));
}

module.exports = { searchAll, searchGlobal };
