import db from './db'

async function findDuplicate(
  filePath: string,
  fileName: string,
  fileSize: number,
  officialTitle: string | null,
  year: string | null
): Promise<Record<string, unknown> | null> {
  let duplicates = await db.findMovies({ file_path: filePath })
  if (duplicates.length > 0) return duplicates[0]

  duplicates = await db.findMovies({ file_name: fileName, file_size: fileSize })
  if (duplicates.length > 0) return duplicates[0]

  if (officialTitle && year) {
    duplicates = await db.findMovies({ official_title: officialTitle, detected_year: year })
    if (duplicates.length > 0) return duplicates[0]
  }

  return null
}

export { findDuplicate }
