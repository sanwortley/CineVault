const db = require('./db');

/**
 * Checks if a movie file or identified film already exists in the database.
 * @param {object} fileInfo 
 * @param {object} movieData 
 * @returns {object|null} existing record or null
 */
async function findDuplicate(filePath, fileName, fileSize, officialTitle, year) {
    // 1. Check by exact path
    let duplicates = await db.findMovies({ file_path: filePath });
    if (duplicates.length > 0) return duplicates[0];

    // 2. Check by filename and size (probably moved file)
    duplicates = await db.findMovies({ file_name: fileName, file_size: fileSize });
    if (duplicates.length > 0) return duplicates[0];

    // 3. Check by official title and year (same movie, different file version)
    if (officialTitle && year) {
        duplicates = await db.findMovies({ official_title: officialTitle, detected_year: year });
        if (duplicates.length > 0) return duplicates[0];
    }

    return null;
}

module.exports = { findDuplicate };
