import type { Movie, VersionInfo, MovieGroup } from '../types'

export const detectVersionInfo = (movie: Movie): VersionInfo => {
  if (!movie) return { label: 'Unknown', isHD: false, is4K: false, lang: '?' }

  const text = (movie.file_name || movie.detected_title || '').toUpperCase()
  const info: VersionInfo = {
    label: '',
    isHD:
      text.includes('1080P') ||
      text.includes('FHD') ||
      text.includes('720P') ||
      text.includes('BRRIP') ||
      text.includes('WEBRIP'),
    is4K: text.includes('4K') || text.includes('UHD') || text.includes('2160P'),
    lang: 'EN',
  }

  if (text.includes('LATINO') || text.includes(' LAT ') || text.includes('.LAT.'))
    info.lang = 'LAT'
  else if (
    text.includes('CASTELLANO') ||
    text.includes(' SPA ') ||
    text.includes('.SPA.')
  )
    info.lang = 'ESP'
  else if (text.includes('DUAL')) info.lang = 'DUAL'

  let label =
    info.lang === 'LAT'
      ? 'Español Latino'
      : info.lang === 'ESP'
        ? 'Español'
        : info.lang === 'DUAL'
          ? 'Dual (Lat/Eng)'
          : 'English'

  if (info.is4K) label += ' (4K)'
  else if (info.isHD) label += ' (HD)'

  return { ...info, label }
}

export const groupMoviesByTitle = (moviesList: Movie[]): MovieGroup[] => {
  if (!moviesList || !Array.isArray(moviesList)) return []

  const groups: Record<string, MovieGroup> = {}

  moviesList.forEach((movie) => {
    if (!movie) return

    const isEp = movie.media_type === 'episode'
    const titleKey = isEp ? (movie.series_title || 'Unknown Series') : (movie.official_title || movie.detected_title || 'Unknown')
    const key = isEp ? `${titleKey.trim().toLowerCase()}|series` : `${titleKey.trim().toLowerCase()}|${movie.detected_year || '0'}`

    if (!groups[key]) {
      groups[key] = {
        ...movie,
        official_title: isEp ? titleKey : movie.official_title,
        versions: [movie],
      } as MovieGroup
    } else {
      if (!groups[key].versions.some((v) => v.file_path === movie.file_path)) {
        groups[key].versions.push(movie)
      }

      if (movie.drive_file_id && !groups[key].drive_file_id) {
        const versions = groups[key].versions
        Object.assign(groups[key], movie)
        groups[key].versions = versions
        if (isEp) {
          groups[key].official_title = titleKey
        }
      }
    }
  })

  return Object.values(groups).map((group) => {
    if (group.media_type === 'episode' || group.versions.some((v) => v.media_type === 'episode')) {
      group.versions.sort((a, b) => {
        const sA = a.season_number || 1
        const sB = b.season_number || 1
        if (sA !== sB) return sA - sB
        return (a.episode_number || 1) - (b.episode_number || 1)
      })
    }
    return group
  })
}
