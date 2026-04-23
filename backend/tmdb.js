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
            original_title: data.original_title, // Guardamos el título original para OMDb
            overview: data.overview,
            poster_url: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
            backdrop_url: data.backdrop_path ? `https://image.tmdb.org/t/p/original${data.backdrop_path}` : null,
            genres: data.genres.map(g => g.name).join(', '),
            runtime: data.runtime,
            director: data.credits?.crew?.find(c => c.job === 'Director')?.name || 'Desconocido',
            cast: data.credits?.cast?.slice(0, 5).map(a => a.name).join(', ') || 'N/A',
            rating: data.vote_average,
            detected_year: data.release_date ? data.release_date.substring(0, 4) : null
        };
    } catch (error) {
        console.error('TMDb Details Error:', error.message);
        return null;
    }
}

async function getOMDbDetails(title, year = null, fallbackTitle = null) {
    const OMDB_API_KEY = process.env.OMDB_API_KEY;
    if (!OMDB_API_KEY) {
        console.error('────────────────────────────────────────────────────────────────');
        console.error('[OMDb] ERROR: Falta la variable OMDB_API_KEY en el entorno.');
        console.error('[OMDb] Debes añadirla en Railway (Variables) o en tu archivo .env');
        console.error('────────────────────────────────────────────────────────────────');
        return null;
    }

    const tryFetch = async (queryTitle) => {
        try {
            console.log(`[OMDb] Fetching ratings for: "${queryTitle}" (${year || 'N/A'})...`);
            const response = await axios.get(`http://www.omdbapi.com/`, {
                params: {
                    apikey: OMDB_API_KEY,
                    t: queryTitle,
                    y: year
                }
            });

            if (response.data.Response === 'False') {
                console.log(`[OMDb] No match found for "${queryTitle}":`, response.data.Error);
                return null;
            }

            const rtRating = response.data.Ratings?.find(r => r.Source === 'Rotten Tomatoes')?.Value;
            const metaRating = response.data.Ratings?.find(r => r.Source === 'Metacritic')?.Value;
            const imdbRating = response.data.imdbRating;

            console.log(`[OMDb] Success! RT: ${rtRating || 'N/A'}, Metascore: ${metaRating || 'N/A'}`);

            return {
                rt_rating: rtRating,
                metascore: metaRating
            };
        } catch (error) {
            if (error.response && error.response.status === 401) {
                console.error('[OMDb] ERROR: API Key inválida o no activada. Por favor, revisa tu email y haz clic en el enlace de activación.');
            } else {
                console.error(`[OMDb] Error for "${queryTitle}":`, error.message);
            }
            return null;
        }
    };

    let result = await tryFetch(title);
    if (!result && fallbackTitle && fallbackTitle !== title) {
        console.log(`[OMDb] Retrying with fallback title: "${fallbackTitle}"`);
        result = await tryFetch(fallbackTitle);
    }

    return result;
}

module.exports = { searchMovie, getMovieDetails, getOMDbDetails };
