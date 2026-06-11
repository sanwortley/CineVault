interface NormalizedResult {
  clean_title: string
  year: number | null
  language: string
  quality: string
  season: number | null
  episode: number | null
}

function normalizeFilename(fileName: string): NormalizedResult {
  let name = fileName.replace(/\.[^/.]+$/, "")

  let season: number | null = null
  let episode: number | null = null

  const sxsPattern = /(?:s|t|season|temporada|temp\s*)(\d{1,2})(?:\s*e|\s*c|\s*ep|\s*episode|\s*capitulo|\s*capítulo|\s*cap|\s*x\s*)(\d{1,2})\b/i
  const xPattern = /\b(\d{1,2})x(\d{1,2})\b/i

  let match = name.match(sxsPattern)
  if (match) {
    season = parseInt(match[1])
    episode = parseInt(match[2])
    // Cut the title at the episode pattern to avoid leftover trailing text
    const idx = name.indexOf(match[0])
    if (idx !== -1) {
      name = name.substring(0, idx)
    } else {
      name = name.replace(match[0], "")
    }
  } else {
    match = name.match(xPattern)
    if (match) {
      const s = parseInt(match[1])
      const e = parseInt(match[2])
      if (s < 30 && e < 100) {
        season = s
        episode = e
        const idx = name.indexOf(match[0])
        if (idx !== -1) {
          name = name.substring(0, idx)
        } else {
          name = name.replace(match[0], "")
        }
      }
    } else {
      // Check for season-only pattern (e.g. T3, Temp 3, Season 3, S02)
      const sOnlyMatch = name.match(/\b(?:season|temporada|temp|[st])\.?\s*(\d{1,2})\b/i)
      if (sOnlyMatch) {
        const s = parseInt(sOnlyMatch[1])
        if (s >= 1 && s <= 50) {
          // Verify we aren't matching resolution/codec (e.g. h264, x264, 1080p, 720p)
          const matchIndex = sOnlyMatch.index || 0
          const context = name.substring(Math.max(0, matchIndex - 5), Math.min(name.length, matchIndex + 10)).toLowerCase()
          if (!/\b(?:264|265|720|1080|2160|4k)\b/.test(context)) {
            season = s
            const idx = name.indexOf(sOnlyMatch[0])
            if (idx !== -1) {
              name = name.substring(0, idx)
            } else {
              name = name.replace(sOnlyMatch[0], "")
            }
          }
        }
      }
    }
  }

  const patterns = [
    /\d{3,4}p/gi,
    /BluRay|Blue-Ray/gi,
    /BRRip|BDRip/gi,
    /WEB-DL|WEBRip/gi,
    /DVDRip/gi,
    /x264|x265|HEVC|H264|H265/gi,
    /YIFY|RARBG|PSA|AMZN|NF/gi,
    /AAC|E-AC3|DTS|DDP5\.1|5\.1/gi,
    /3D/gi,
  ]

  const yearMatch = name.match(/\b(19|20)\d{2}\b/)
  const year = yearMatch ? parseInt(yearMatch[0]) : null

  let cleanName = name

  if (yearMatch) {
    cleanName = name.split(yearMatch[0])[0]
  }

  patterns.forEach((p) => {
    cleanName = cleanName.replace(p, "")
  })

  cleanName = cleanName.replace(/[._\-()[\]]/g, " ")
  cleanName = cleanName.replace(/\s+/g, " ").trim()

  let language = ""
  const lowName = fileName.toLowerCase()
  if (lowName.match(/\blatino|spanish|español|castellano|esp|spa|cas|lat\b/i))
    language = "Español"
  else if (lowName.match(/\benglish|eng|en\b/i)) language = "English"
  if (lowName.match(/\bdual|multi\b/i)) language = "Dual Audio"

  let quality = ""
  const qualityMatch = fileName.match(/\b(2160p|1080p|720p|480p|4k|8k)\b/i)
  if (qualityMatch) quality = qualityMatch[0].toUpperCase()

  return {
    clean_title: cleanName,
    year,
    language,
    quality,
    season,
    episode,
  }
}

export { normalizeFilename }
