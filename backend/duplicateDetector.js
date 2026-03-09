const db = require('./db');

/**
 * Checks if a movie file or identified film already exists in the database.
 * @param {object} fileInfo 
 * @param {object} movieData 
 * @returns {object|null} existing record or null
 */
async function findDuplicate(filePath, fileName, fileSize, officialTitle, year) {
    // 1. Check by exact path
    let duplicate = await db.prepare('SELECT * FROM movies WHERE file_path = ?').get(filePath);
    if (duplicate) return duplicate;

    // 2. Check by filename and size (probably moved file)
    duplicate = await db.prepare('SELECT * FROM movies WHERE file_name = ? AND file_size = ?').get(fileName, fileSize);
    if (duplicate) return duplicate;

    // 3. Check by official title and year (same movie, different file version)
    if (officialTitle && year) {
        duplicate = await db.prepare('SELECT * FROM movies WHERE official_title = ? AND detected_year = ?').get(officialTitle, year);
        if (duplicate) return duplicate;
    }

    return null;
}

module.exports = { findDuplicate };
