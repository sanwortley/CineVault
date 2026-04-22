const axios = require('axios');

// Cache in memory
let newsCache = {
    items: [],
    lastUpdate: 0
};

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const RSS_URL = 'https://www.sensacine.com/rss/noticias.xml';

async function fetchMovieNews() {
    // Return cache if valid
    if (newsCache.items.length > 0 && (Date.now() - newsCache.lastUpdate < CACHE_DURATION)) {
        return newsCache.items;
    }

    try {
        const response = await axios.get(RSS_URL, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        });
        const xml = response.data;

        // Simple Regex Parser for RSS Items
        const items = [];
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        let match;

        while ((match = itemRegex.exec(xml)) !== null && items.length < 8) {
            const content = match[1];
            
            const title = (content.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || content.match(/<title>([\s\S]*?)<\/title>/))?.[1] || '';
            const description = (content.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || content.match(/<description>([\s\S]*?)<\/description>/))?.[1] || '';
            const link = (content.match(/<link>([\s\S]*?)<\/link>/))?.[1] || '';
            const pubDate = (content.match(/<pubDate>([\s\S]*?)<\/pubDate>/))?.[1] || '';
            
            // Try to find image in media:content or description
            let image = (content.match(/<media:content[^>]*url="([^"]*)"/))?.[1];
            if (!image) {
                // Fallback: look for <img> in description
                const imgMatch = description.match(/<img[^>]*src="([^"]*)"/);
                image = imgMatch?.[1];
            }

            // Clean description (remove HTML)
            const cleanDesc = description.replace(/<[^>]*>?/gm, '').substring(0, 150) + '...';

            items.push({
                id: Math.random().toString(36).substr(2, 9),
                title: title.trim(),
                description: cleanDesc.trim(),
                link: link.trim(),
                date: new Date(pubDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }),
                image: image || 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&q=80&w=1000',
                category: 'Cine'
            });
        }

        newsCache = {
            items,
            lastUpdate: Date.now()
        };

        return items;
    } catch (err) {
        console.error('[NewsService] Error fetching news:', err.message);
        return newsCache.items; // Return stale cache on error
    }
}

module.exports = { fetchMovieNews };
