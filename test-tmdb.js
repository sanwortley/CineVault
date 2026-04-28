require('dotenv').config();
const db = require('./backend/db');
const tmdb = require('./backend/tmdb');

async function test() {
    const movies = await db.getMovies();
    console.log(`Checking ${movies.length} movies...`);
    
    let success = 0;
    let failed = [];

    for (let i = 0; i < movies.length; i++) {
        const movie = movies[i];
        const searchTitle = movie.official_title ? movie.official_title.replace(/\[.*?\]|\(.*?\)/g, '').trim() : '';
        const searchResult = await tmdb.searchMovie(searchTitle || movie.official_title, movie.detected_year);
        if (searchResult && searchResult.id) {
            success++;
        } else {
            failed.push(`${movie.official_title} (${movie.detected_year})`);
        }
        if (i % 20 === 0) console.log(`Processed ${i}/${movies.length}...`);
    }
    
    console.log(`Success: ${success}/${movies.length}`);
    console.log(`Failed:`, failed.slice(0, 10), '...', `(${failed.length} total)`);
}

test();
