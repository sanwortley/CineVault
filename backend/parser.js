/**
 * Normalizes movie filenames by removing common release noise.
 * @param {string} fileName 
 * @returns {object} { clean_title: string, year: number|null }
 */
function normalizeFilename(fileName) {
    // Remove extension
    let name = fileName.replace(/\.[^/.]+$/, "");

    // Replace dots, underscores, dashes with spaces
    name = name.replace(/[._\-]/g, " ");

    // Common noise patterns
    const patterns = [
        /\d{3,4}p/gi, // 1080p, 720p
        /BluRay/gi,
        /BRRip/gi,
        /WEB-DL/gi,
        /DVDRip/gi,
        /x264|x265|HEVC/gi,
        /YIFY|AAC|E-AC3/gi,
        /\[.*?\]/g,     // Text in brackets
        /\(.*?\)/g      // Text in parentheses (temporarily remove to find year better)
    ];

    // Detect year (usually 4 digits starting with 19 or 20)
    const yearMatch = name.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? parseInt(yearMatch[0]) : null;

    // Cleanup based on year or first noise pattern
    let cleanName = name;

    if (yearMatch) {
        cleanName = name.split(yearMatch[0])[0];
    }

    // Final cleanup: remove trailing noise and extra spaces
    patterns.forEach(p => {
        cleanName = cleanName.replace(p, "");
    });

    return {
        clean_title: cleanName.trim(),
        year: year
    };
}

module.exports = { normalizeFilename };
