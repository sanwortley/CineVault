import fs from 'fs'
import path from 'path'

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm']

interface ScannedFile {
  file_name: string
  file_path: string
  file_size: number
  extension: string
  created_at: Date
  modified_at: Date
}

async function scanDirectory(dirPath: string): Promise<ScannedFile[]> {
  let results: ScannedFile[] = []
  let list: string[] = []
  try {
    list = fs.readdirSync(dirPath)
  } catch (e: unknown) {
    const err = e as { code?: string }
    console.warn(`[Scanner] Skipped restricted/invalid directory: ${dirPath} - ${err.code}`)
    return results
  }

  for (let file of list) {
    try {
      file = path.resolve(dirPath, file)
      const stat = fs.statSync(file)

      if (stat && stat.isDirectory()) {
        results = results.concat(await scanDirectory(file))
      } else {
        const ext = path.extname(file).toLowerCase()
        if (VIDEO_EXTENSIONS.includes(ext)) {
          results.push({
            file_name: path.basename(file),
            file_path: file.replace(/\\/g, '/'),
            file_size: stat.size,
            extension: ext,
            created_at: stat.birthtime,
            modified_at: stat.mtime,
          })
        }
      }
    } catch (_e) {
      // silently skip locked files
    }
  }
  return results
}

export { scanDirectory }
