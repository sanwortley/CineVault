import axios from 'axios'
import 'dotenv/config'

const TMDB_API_KEY = process.env.TMDB_API_KEY
const BASE_URL = 'https://api.themoviedb.org/3'

interface TMDBMovieRaw {
  id: number
  title: string
  original_title: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  release_date: string
  genre_ids: number[]
  popularity: number
  vote_average: number
  vote_count: number
  adult?: boolean
}

interface TMDBDetailsRaw extends TMDBMovieRaw {
  genres: { id: number; name: string }[]
  runtime: number
  credits?: {
    crew: { job: string; name: string }[]
    cast: { name: string; character: string; profile_path: string | null }[]
  }
}

interface TMDBReleaseDateResult {
  results: {
    iso_3166_1: string
    release_dates: {
      certification: string
    }[]
  }[]
}

interface MovieDetails {
  official_title: string
  original_title: string
  overview: string
  poster_url: string | null
  backdrop_url: string | null
  genres: string
  runtime: number
  director: string
  cast: string
  rating: number
  detected_year: string | null
  certification: string | null
  adult: boolean
}

interface OMDBRating {
  Source: string
  Value: string
}

interface OMDBResponse {
  Response: string
  Error?: string
  Ratings?: OMDBRating[]
  imdbRating?: string
}

interface OMDbDetails {
  rt_rating: string | undefined
  metascore: string | undefined
}

async function searchMovie(title: string, year: string | null = null): Promise<TMDBMovieRaw | null> {
  if (!TMDB_API_KEY) throw new Error('TMDB_API_KEY is missing')

  try {
    const response = await axios.get<{ results: TMDBMovieRaw[] }>(`${BASE_URL}/search/movie`, {
      params: {
        api_key: TMDB_API_KEY,
        query: title,
        year,
        language: 'es-MX',
      },
    })

    const results = response.data.results
    if (results.length === 0) return null

    return results[0]
  } catch (error: unknown) {
    const err = error as Error
    console.error('TMDb Search Error:', err.message)
    return null
  }
}

async function getMovieDetails(movieId: number): Promise<MovieDetails | null> {
  try {
    const response = await axios.get<TMDBDetailsRaw>(`${BASE_URL}/movie/${movieId}`, {
      params: {
        api_key: TMDB_API_KEY,
        append_to_response: 'credits',
        language: 'es-MX',
      },
    })

    const data = response.data

    // Fetch US certification from release_dates
    let certification: string | null = null
    try {
      const rdRes = await axios.get<TMDBReleaseDateResult>(`${BASE_URL}/movie/${movieId}/release_dates`, {
        params: { api_key: TMDB_API_KEY },
      })
      const usRelease = rdRes.data.results.find((r) => r.iso_3166_1 === 'US')
      if (usRelease && usRelease.release_dates.length > 0) {
        certification = usRelease.release_dates[0].certification || null
      }
    } catch (rdErr) {
      // Non-critical, just skip certification
    }

    return {
      official_title: data.title,
      original_title: data.original_title,
      overview: data.overview,
      poster_url: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
      backdrop_url: data.backdrop_path
        ? `https://image.tmdb.org/t/p/original${data.backdrop_path}`
        : null,
      genres: data.genres.map((g) => g.name).join(', '),
      runtime: data.runtime,
      director:
        data.credits?.crew?.find((c) => c.job === 'Director')?.name || 'Desconocido',
      cast:
        data.credits?.cast?.slice(0, 5).map((a) => a.name).join(', ') || 'N/A',
      rating: data.vote_average,
      detected_year: data.release_date ? data.release_date.substring(0, 4) : null,
      certification,
      adult: data.adult || false,
    }
  } catch (error: unknown) {
    const err = error as Error
    console.error('TMDb Details Error:', err.message)
    return null
  }
}

async function getOMDbDetails(
  title: string,
  year: string | null = null,
  fallbackTitle: string | null = null
): Promise<OMDbDetails | null> {
  const OMDB_API_KEY = process.env.OMDB_API_KEY
  if (!OMDB_API_KEY) {
    console.error('─'.repeat(48))
    console.error('[OMDb] ERROR: Falta la variable OMDB_API_KEY en el entorno.')
    console.error('[OMDb] Debes añadirla en Railway (Variables) o en tu archivo .env')
    console.error('─'.repeat(48))
    return null
  }

  const tryFetch = async (queryTitle: string): Promise<OMDbDetails | null> => {
    try {
      console.log(`[OMDb] Fetching ratings for: "${queryTitle}" (${year || 'N/A'})...`)
      const response = await axios.get<OMDBResponse>('http://www.omdbapi.com/', {
        params: {
          apikey: OMDB_API_KEY,
          t: queryTitle,
          y: year,
        },
      })

      if (response.data.Response === 'False') {
        console.log(`[OMDb] No match found for "${queryTitle}":`, response.data.Error)
        return null
      }

      const rtRating = response.data.Ratings?.find((r) => r.Source === 'Rotten Tomatoes')?.Value
      const metaRating = response.data.Ratings?.find((r) => r.Source === 'Metacritic')?.Value

      console.log(`[OMDb] Success! RT: ${rtRating || 'N/A'}, Metascore: ${metaRating || 'N/A'}`)

      return {
        rt_rating: rtRating,
        metascore: metaRating,
      }
    } catch (error: unknown) {
      const err = error as { response?: { status?: number }; message: string }
      if (err.response?.status === 401) {
        console.error(
          '[OMDb] ERROR: API Key inválida o no activada. Por favor, revisa tu email y haz clic en el enlace de activación.'
        )
      } else {
        console.error(`[OMDb] Error for "${queryTitle}":`, err.message)
      }
      return null
    }
  }

  let result = await tryFetch(title)
  if (!result && fallbackTitle && fallbackTitle !== title) {
    console.log(`[OMDb] Retrying with fallback title: "${fallbackTitle}"`)
    result = await tryFetch(fallbackTitle)
  }

  return result
}

async function searchTVShow(title: string, year: string | null = null): Promise<any | null> {
  if (!TMDB_API_KEY) throw new Error('TMDB_API_KEY is missing')

  try {
    const response = await axios.get<{ results: any[] }>(`${BASE_URL}/search/tv`, {
      params: {
        api_key: TMDB_API_KEY,
        query: title,
        first_air_date_year: year,
        language: 'es-MX',
      },
    })

    const results = response.data.results
    if (results.length === 0) return null

    return results[0]
  } catch (error: unknown) {
    const err = error as Error
    console.error('TMDb TV Search Error:', err.message)
    return null
  }
}

async function getTVShowDetails(tvId: number): Promise<MovieDetails | null> {
  if (!TMDB_API_KEY) throw new Error('TMDB_API_KEY is missing')

  try {
    const response = await axios.get<any>(`${BASE_URL}/tv/${tvId}`, {
      params: {
        api_key: TMDB_API_KEY,
        append_to_response: 'credits',
        language: 'es-MX',
      },
    })

    const data = response.data

    return {
      official_title: data.name,
      original_title: data.original_name,
      overview: data.overview,
      poster_url: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
      backdrop_url: data.backdrop_path
        ? `https://image.tmdb.org/t/p/original${data.backdrop_path}`
        : null,
      genres: data.genres.map((g: any) => g.name).join(', '),
      runtime: data.episode_run_time && data.episode_run_time.length > 0 ? data.episode_run_time[0] : 0,
      director: data.created_by && data.created_by.length > 0 ? data.created_by[0].name : 'Desconocido',
      cast:
        data.credits?.cast?.slice(0, 5).map((a: any) => a.name).join(', ') || 'N/A',
      rating: data.vote_average,
      detected_year: data.first_air_date ? data.first_air_date.substring(0, 4) : null,
      certification: null,
      adult: false,
    }
  } catch (error: unknown) {
    const err = error as Error
    console.error('TMDb TV Details Error:', err.message)
    return null
  }
}

async function getEpisodeDetails(tvId: number, season: number, episode: number): Promise<any | null> {
  if (!TMDB_API_KEY) throw new Error('TMDB_API_KEY is missing')

  try {
    const response = await axios.get<any>(`${BASE_URL}/tv/${tvId}/season/${season}/episode/${episode}`, {
      params: {
        api_key: TMDB_API_KEY,
        language: 'es-MX',
      },
    })

    const data = response.data
    return {
      name: data.name,
      overview: data.overview,
      still_url: data.still_path ? `https://image.tmdb.org/t/p/w500${data.still_path}` : null,
      rating: data.vote_average
    }
  } catch (error: unknown) {
    const err = error as Error
    console.error(`TMDb Episode Details Error (${tvId} S${season}E${episode}):`, err.message)
    return null
  }
}

export { searchMovie, getMovieDetails, getOMDbDetails, searchTVShow, getTVShowDetails, getEpisodeDetails }
export type { TMDBMovieRaw, MovieDetails, OMDbDetails }
