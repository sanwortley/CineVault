interface NormalizedResult {
  clean_title: string
  year: number | null
  language: string
  quality: string
}

function normalizeFilename(fileName: string): NormalizedResult {
  let name = fileName.replace(/\.[^/.]+$/, "")

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
  }
}

export { normalizeFilename }
