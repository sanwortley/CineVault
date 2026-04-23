/**
 * Normalizes movie filenames by removing common release noise.
 * @param {string} fileName 
 * @returns {object} { clean_title: string, year: number|null, language: string }
 */
function normalizeFilename(fileName) {
    // Remove extension
    let name = fileName.replace(/\.[^/.]+$/, "");

    // Common noise patterns
    const patterns = [
        /\d{3,4}p/gi, // 1080p, 720p
        /BluRay|Blue-Ray/gi,
        /BRRip|BDRip/gi,
        /WEB-DL|WEBRip/gi,
        /DVDRip/gi,
        /x264|x265|HEVC|H264|H265/gi,
        /YIFY|RARBG|PSA|AMZN|NF/gi,
        /AAC|E-AC3|DTS|DDP5\.1|5\.1/gi,
        /3D/gi
    ];

    // Detect year (usually 4 digits starting with 19 or 20)
    const yearMatch = name.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? parseInt(yearMatch[0]) : null;

    // Cleanup based on year or first noise pattern
    let cleanName = name;

    if (yearMatch) {
        cleanName = name.split(yearMatch[0])[0];
    }

    // Remove noise patterns
    patterns.forEach(p => {
        cleanName = cleanName.replace(p, "");
    });

    // Remove special characters and clean up symbols
    // This removes .( ) [ ] _ - and handles the "Up (" case
    cleanName = cleanName.replace(/[._\-()[\]]/g, " ");
    
    // Remove extra spaces
    cleanName = cleanName.replace(/\s+/g, " ").trim();

    // Detect language
    let language = "";
    if (fileName.toLowerCase().match(/latino|spanish|español|castellano|esp/i)) language = "Español";
    else if (fileName.toLowerCase().match(/english|eng|en/i)) language = "English";
    if (fileName.toLowerCase().match(/dual/i)) language = "Dual Audio";

    return {
        clean_title: cleanName,
        year: year,
        language: language
    };
}

module.exports = { normalizeFilename };
