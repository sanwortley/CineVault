import { Router, type Request, type Response } from 'express'
import axios from 'axios'
import * as cheerio from 'cheerio'
import db from './db'
import { searchAll, searchGlobal } from './movieSearcher'
import debridManager from './debridManager'
import uploadManager from './uploadManager'
import { adminMiddleware } from './middleware'
import { normalizeFilename } from './parser'

const router = Router()

const getTMDBKey = (): string => process.env.TMDB_API_KEY || ''
const TMDB_BASE_URL = 'https://api.themoviedb.org/3'

const fetchTMDB = async (
  endpoint: string,
  params: Record<string, string> = {}
): Promise<Record<string, unknown>> => {
  const key = getTMDBKey()
  if (!key) throw new Error('TMDB_API_KEY no configurada')

  const response = await axios.get(`${TMDB_BASE_URL}${endpoint}`, {
    params: { api_key: key, language: 'es-MX', ...params },
  })
  return response.data
}

router.get('/trending', async (req: Request, res: Response) => {
  try {
    const data = (await fetchTMDB('/trending/movie/week')) as { results: unknown[] }
    res.json(data.results)
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener tendencias' })
  }
})

router.get('/search', async (req: Request, res: Response) => {
  const query = req.query.query
  if (typeof query !== 'string' || !query) {
    res.status(400).json({ error: 'Falta consulta' })
    return
  }
  try {
    const data = (await fetchTMDB('/search/movie', { query })) as { results: unknown[] }
    res.json(data.results)
  } catch (err) {
    res.status(500).json({ error: 'Error en la búsqueda' })
  }
})

router.get('/torrents/:title', async (req: Request, res: Response) => {
  const title = req.params.title as string
  try {
    const results = await searchAll(title)
    res.json(results)
  } catch (err) {
    const error = err as Error
    console.error('[Discover] Search error:', error.message)
    res.status(500).json({ error: 'Error al buscar fuentes' })
  }
})

router.post('/download', adminMiddleware, async (req: Request, res: Response) => {
  const { movieId, title, magnet, isPage, isHash, year } = req.body as {
    movieId: string
    title: string
    magnet: string
    isPage?: boolean
    isHash?: boolean
    year?: string
  }

  if (!movieId || !title || !magnet) {
    res.status(400).json({ error: 'Datos insuficientes' })
    return
  }

  try {
    let tmdbDetails: Record<string, unknown> | null = null
    const isNumericId = !isNaN(parseInt(movieId)) && /^\d+$/.test(String(movieId))

    if (isNumericId) {
      try {
        tmdbDetails = (await fetchTMDB(`/movie/${movieId}`)) as Record<string, unknown>
      } catch (tmdbErr) {
        const error = tmdbErr as Error
        console.warn(
          `[Discover] Failed to fetch TMDB details for ID ${movieId}:`,
          error.message
        )
      }
    }

    if (!tmdbDetails) {
      const { clean_title, year: parsedYear } = normalizeFilename(title)
      console.log(
        `[Discover] Pre-match normalization: "${title}" -> "${clean_title}" (${parsedYear || 'N/A'})`
      )
      try {
        const searchResults = (await fetchTMDB('/search/movie', {
          query: clean_title,
          year: parsedYear ? String(parsedYear) : (year || ''),
        })) as { results?: { id: number }[] }
        if (searchResults.results && searchResults.results.length > 0) {
          tmdbDetails = (await fetchTMDB(
            `/movie/${searchResults.results[0].id}`
          )) as Record<string, unknown>
          console.log(
            `[Discover] Encontrado match oficial en TMDB: "${(tmdbDetails as { title?: string }).title}"`
          )
        }
      } catch (searchErr) {
        const error = searchErr as Error
        console.warn(
          `[Discover] Falló búsqueda agresiva para "${clean_title}":`,
          error.message
        )
      }
    }

    const { clean_title, year: parsedYear, language, quality } = normalizeFilename(title)
    let finalOfficialTitle =
      (tmdbDetails as { title?: string; original_title?: string })?.title ||
      (tmdbDetails as { original_title?: string })?.original_title ||
      title ||
      ''

    const tag =
      language === 'Español'
        ? 'Español'
        : language === 'Dual Audio'
          ? 'Dual Audio'
          : 'English'
    finalOfficialTitle = `${finalOfficialTitle} [${tag}]`

    let omdbDetails: Record<string, unknown> = {}
    try {
      const { getOMDbDetails } = require('./tmdb')
      const ratings = await getOMDbDetails(
        finalOfficialTitle,
        year ||
          ((tmdbDetails as { release_date?: string })?.release_date?.substring(0, 4) as string) ||
          null,
        (tmdbDetails as { original_title?: string })?.original_title || null
      )
      if (ratings) omdbDetails = ratings
    } catch (omdbErr) {
      const error = omdbErr as Error
      console.warn('[Discover] OMDb fetch failed:', error.message)
    }

    let movie = await db.addMovie({
      official_title: finalOfficialTitle,
      detected_title: title || '',
      detected_year: (year ||
        (tmdbDetails as { release_date?: string })?.release_date?.substring(0, 4) ||
        String(new Date().getFullYear())) as string,
      file_name: title || 'unknown_movie',
      file_path: `remote://cloud-ingestion/${title || 'unknown'}`,
      file_size: 0,
      extension: '.mp4',
      drive_file_id: 'pending_cloud',
      poster_url:
        (tmdbDetails as { poster_url?: string })?.poster_url ||
        ((tmdbDetails as { poster_path?: string })?.poster_path
          ? `https://image.tmdb.org/t/p/w500${(tmdbDetails as { poster_path: string }).poster_path}`
          : ''),
      backdrop_url: (tmdbDetails as { backdrop_url?: string })?.backdrop_url || '',
      overview: (tmdbDetails as { overview?: string })?.overview || '',
      genres: Array.isArray((tmdbDetails as { genres?: { name: string }[] })?.genres)
        ? (tmdbDetails as { genres: { name: string }[] }).genres.map((g) => g.name).join(', ')
        : ((tmdbDetails as { genres?: string })?.genres || ''),
      director: (tmdbDetails as { director?: string })?.director || '',
      cast: (tmdbDetails as { cast?: string })?.cast || '',
      rating: (tmdbDetails as { rating?: number })?.rating || 0,
      runtime: (tmdbDetails as { runtime?: number })?.runtime || 0,
      ...omdbDetails,
    })

    if (!movie || !movie.id) {
      console.log('[Discover] Movie creation failed, searching as last resort:', title)
      const search = await db.findMovies({ official_title: title })
      movie = search.length > 0 ? search[0] : null
    }

    if (!movie || !movie.id) {
      throw new Error(
        'No se pudo crear ni encontrar el registro de la película en la base de datos'
      )
    }

    uploadManager.enqueue(movie.id, title, 'pending', 'video/mp4', {
      status: 'converting' as const,
    })

    const finalTitle = (movie as { title?: string }).title || title

    let finalMagnet = magnet
    if (isHash) {
      finalMagnet = `magnet:?xt=urn:btih:${magnet}&dn=${encodeURIComponent(title)}`
    } else if (isPage) {
      console.log('[Discover] Resolviendo magnet desde página...')
      const pageResp = await axios.get(magnet)
      const $ = cheerio.load(pageResp.data as string)
      finalMagnet = $('a[href^="magnet:"]').first().attr('href') || ''
    }

    if (!finalMagnet) throw new Error('No se pudo resolver el enlace magnet')

    ;(async () => {
      try {
        const debridResult = await debridManager.processMagnet(
          finalMagnet,
          (progress, status) => {
            uploadManager.updateJob(movie!.id, {
              progress,
              status: `converting (${status})`,
            })
          }
        )

        console.log(`[Discover] Enlace listo: ${debridResult.downloadUrl}`)

        await db.updateMovie(movie!.id, { cloud_source_url: debridResult.downloadUrl })

        uploadManager.updateJob(movie!.id, {
          status: 'pending' as const,
          filePath: debridResult.downloadUrl,
          isUrl: true,
          options: { deleteAfter: true, optimize: false },
        })
      } catch (err) {
        const error = err as Error
        console.error('[Discover] Debrid process failed:', error.message)
        uploadManager.updateJob(movie!.id, { status: 'error' as const, error: error.message })
      }
    })()

    res.json({ message: 'Proceso iniciado vía Real-Debrid', movieId: movie.id })
  } catch (err) {
    const error = err as Error
    console.error('[Discover] Download error:', error)
    res
      .status(500)
      .json({ error: 'Error al iniciar proceso Cloud: ' + error.message })
  }
})

router.get('/download-status/:movieId', (req: Request, res: Response) => {
  const job = uploadManager.getJobStatus(req.params.movieId as string)
  if (!job) {
    res.status(404).json({ error: 'Descarga no activa o terminada' })
    return
  }
  res.json({
    progress: job.progress,
    status: job.status,
    error: job.error,
  })
})

router.get('/deep-search', async (req: Request, res: Response) => {
  const query = req.query.query
  if (typeof query !== 'string' || !query) {
    res.status(400).json({ error: 'Query requerida' })
    return
  }

  try {
    const results = await searchGlobal(query)
    res.json(results)
  } catch (err) {
    const error = err as Error
    res.status(500).json({ error: 'Error en búsqueda profunda' })
  }
})

export default router
