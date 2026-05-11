import axios from 'axios'
import * as cheerio from 'cheerio'

const COMMON_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
}

interface TorrentResult {
  title: string
  size?: string
  seeds: number
  link: string
  isHash: boolean
  provider: string
}

interface YTSMovie {
  title_long: string
  torrents: { quality: string; size: string; seeds: string; hash: string }[]
}

interface YTSResponse {
  data?: {
    movies?: YTSMovie[]
  }
}

interface TPBItem {
  id: string
  name: string
  size: string
  seeders: string
  info_hash: string
}

interface TPBResponse extends Array<TPBItem> {}

interface SolidResult {
  title: string
  size: number
  swarm: { seeders: number }
  magnet: string
}

interface SolidResponse {
  results?: SolidResult[]
}

interface SubtitleFallbackResult {
  id: string | undefined
  language: string
  release: string
  provider: string
  type: string
  link: string
}

async function searchYTS(query: string): Promise<TorrentResult[]> {
  const mirrors = [
    'https://yts.mx/api/v2',
    'https://yts.pm/api/v2',
    'https://yts.lt/api/v2',
    'https://yts.rs/api/v2',
    'https://yify-backend.onrender.com/api/v2',
  ]

  for (const mirror of mirrors) {
    try {
      console.log(`[Searcher] Trying YTS Mirror: ${mirror}`)
      const response = await axios.get<YTSResponse>(`${mirror}/list_movies.json`, {
        params: { query_term: query, limit: 10, sort_by: 'seeds' },
        headers: COMMON_HEADERS,
        timeout: 5000,
      })

      if (response.data?.data?.movies) {
        return response.data.data.movies.map((m) => {
          const best = m.torrents.reduce((prev, curr) => {
            const pSeeds = parseInt(prev.seeds) || 0
            const cSeeds = parseInt(curr.seeds) || 0
            return pSeeds >= cSeeds ? prev : curr
          })
          return {
            title: `${m.title_long} [${best.quality}]`,
            size: best.size,
            seeds: parseInt(best.seeds),
            link: best.hash,
            isHash: true,
            provider: 'YTS',
          }
        })
      }
    } catch (err: unknown) {
      const error = err as Error
      console.warn(`[Searcher] YTS Mirror ${mirror} failed:`, error.message)
    }
  }
  return []
}

async function searchTPB(query: string): Promise<TorrentResult[]> {
  const mirrors = [
    'https://apibay.org',
    'https://thepiratebay0.org',
    'https://piratebay.party',
    'https://tpblist.info',
  ]

  for (const mirror of mirrors) {
    try {
      console.log(`[Searcher] Trying TPB mirror: ${mirror}`)
      const isApi = mirror.includes('apibay')
      const url = isApi
        ? `${mirror}/q.php?q=${encodeURIComponent(query)}`
        : `${mirror}/search/${encodeURIComponent(query)}/1/99/0`

      const response = await axios.get(url, {
        headers: COMMON_HEADERS,
        timeout: 5000,
      })

      if (isApi) {
        const data = response.data as TPBResponse
        if (Array.isArray(data) && data.length > 0 && data[0].id !== '0') {
          return data
            .filter(
              (item) =>
                item.id !== '0' &&
                item.info_hash !== '0000000000000000000000000000000000000000'
            )
            .map((item) => ({
              title: item.name,
              size:
                (parseInt(item.size) / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
              seeds: parseInt(item.seeders) || 0,
              link: item.info_hash,
              isHash: true,
              provider: 'PirateBay',
            }))
        }
      } else {
        const $ = cheerio.load(response.data as string)
        const results: TorrentResult[] = []
        $('#searchResult tr').each((_i, el) => {
          const title = $(el).find('.detName').text().trim()
          const magnet = $(el).find('a[href^="magnet:"]').attr('href')
          const seeders =
            parseInt($(el).find('td[align="right"]').first().text()) || 0
          if (title && magnet) {
            results.push({
              title,
              link: magnet,
              seeds: seeders,
              isHash: false,
              provider: 'PirateBay',
            })
          }
        })
        if (results.length > 0) return results
      }
    } catch (err: unknown) {
      const error = err as Error
      console.warn(`[Searcher] TPB Mirror ${mirror} failed:`, error.message)
    }
  }
  return []
}

async function searchSolid(query: string): Promise<TorrentResult[]> {
  const mirrors = [
    'https://solidtorrents.to/api/v1',
    'https://solidtorrents.net/api/v1',
    'https://solidtorrents.ch/api/v1',
  ]

  for (const mirror of mirrors) {
    try {
      console.log(`[Searcher] Trying Solid Mirror: ${mirror}`)
      const response = await axios.get<SolidResponse>(`${mirror}/search`, {
        params: { q: query, category: 'Video', sort: 'seeders' },
        headers: COMMON_HEADERS,
        timeout: 5000,
      })

      if (response.data?.results) {
        return response.data.results.map((item) => ({
          title: item.title,
          size: (item.size / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
          seeds: item.swarm.seeders || 0,
          link: item.magnet,
          isHash: false,
          provider: 'Solid',
        }))
      }
    } catch (err: unknown) {
      const error = err as Error
      console.error(`[Searcher] Solid Mirror ${mirror} failed:`, error.message)
    }
  }
  return []
}

async function searchGlobal(query: string): Promise<TorrentResult[]> {
  const results = await Promise.allSettled([
    searchSolid(query),
    searchYTS(query),
    searchTPB(query),
  ])

  let combined: TorrentResult[] = []
  results.forEach((res) => {
    if (res.status === 'fulfilled') {
      combined = [...combined, ...res.value]
    }
  })

  return combined.sort((a, b) => {
    const aLow = a.title.toLowerCase()
    const bLow = b.title.toLowerCase()
    const aIsMp4 = aLow.includes('.mp4') || aLow.includes('mp4')
    const bIsMp4 = bLow.includes('.mp4') || bLow.includes('mp4')

    if (aIsMp4 && !bIsMp4) return -1
    if (!aIsMp4 && bIsMp4) return 1

    return b.seeds - a.seeds
  })
}

async function searchAll(query: string): Promise<TorrentResult[]> {
  const results = await Promise.allSettled([searchYTS(query), searchSolid(query)])

  let combined: TorrentResult[] = []
  results.forEach((res) => {
    if (res.status === 'fulfilled') {
      combined = [...combined, ...res.value]
    }
  })

  return combined.sort((a, b) => {
    const aIsMp4 = a.title.toLowerCase().includes('mp4')
    const bIsMp4 = b.title.toLowerCase().includes('mp4')

    if (aIsMp4 && !bIsMp4) return -1
    if (!aIsMp4 && bIsMp4) return 1

    return b.seeds - a.seeds
  })
}

async function searchSubtitlesFallback(
  imdbId: string,
  title: string
): Promise<SubtitleFallbackResult[]> {
  try {
    console.log(`[Searcher] Fallback subtitle search (YIFY) for: ${title}`)
    const searchUrl = `https://yifysubtitles.org/movie-imdb/${imdbId}`
    const response = await axios.get(searchUrl, {
      headers: COMMON_HEADERS,
      timeout: 8000,
    })

    const $ = cheerio.load(response.data as string)
    const results: SubtitleFallbackResult[] = []

    $('.other-subs tr').each((_i, el) => {
      const lang =
        $(el).find('.flag').attr('class')?.replace('flag ', '') || ''
      const language = lang === 'es' ? 'es' : lang === 'en' ? 'en' : ''

      if (language) {
        const subLink = $(el).find('a').attr('href')
        const release = $(el).find('.sub-download').prev().text().trim()

        if (subLink) {
          results.push({
            id: subLink.split('/').pop(),
            language,
            release: release || title,
            provider: 'YIFY (Fallback)',
            type: 'cloud',
            link: `https://yifysubtitles.org${subLink}`,
          })
        }
      }
    })

    return results
  } catch (err: unknown) {
    const error = err as Error
    console.warn('[Searcher] Fallback subtitles search failed:', error.message)
    return []
  }
}

export { searchAll, searchGlobal, searchSubtitlesFallback }
export type { TorrentResult }
