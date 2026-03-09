const axios = require('axios');
require('dotenv').config();

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const BASE_URL = 'https://api.themoviedb.org/3';

async function searchMovie(title, year = null) {
    if (!TMDB_API_KEY) throw new Error('TMDB_API_KEY is missing');

    try {
        const response = await axios.get(`${BASE_URL}/search/movie`, {
            params: {
                api_key: TMDB_API_KEY,
                query: title,
                year: year,
                language: 'es-ES'
            }
        });

        const results = response.data.results;
        if (results.length === 0) return null;

        // Return the most likely match (usually the first one)
        return results[0];
    } catch (error) {
        console.error('TMDb Search Error:', error.message);
        return null;
    }
}

async function getMovieDetails(movieId) {
    try {
        const response = await axios.get(`${BASE_URL}/movie/${movieId}`, {
            params: {
                api_key: TMDB_API_KEY,
                append_to_response: 'credits',
                language: 'es-ES'
            }
        });

        const data = response.data;
        return {
            official_title: data.title,
            overview: data.overview,
            poster_url: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
            backdrop_url: data.backdrop_path ? `https://image.tmdb.org/t/p/original${data.backdrop_path}` : null,
            genres: data.genres.map(g => g.name).join(', '),
            runtime: data.runtime,
            director: data.credits?.crew?.find(c => c.job === 'Director')?.name || 'Desconocido',
            rating: data.vote_average,
            release_date: data.release_date
        };
    } catch (error) {
        console.error('TMDb Details Error:', error.message);
        return null;
    }
}

module.exports = { searchMovie, getMovieDetails };
