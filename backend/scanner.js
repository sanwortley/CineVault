const fs = require('fs');
const path = require('path');

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm'];

/**
 * Recursively scans directory for video files.
 * @param {string} dirPath 
 * @returns {Promise<Array>}
 */
async function scanDirectory(dirPath) {
    let results = [];
    let list = [];
    try {
        list = fs.readdirSync(dirPath);
    } catch (e) {
        console.warn(`[Scanner] Skipped restricted/invalid directory: ${dirPath} - ${e.code}`);
        return results;
    }

    for (let file of list) {
        try {
            file = path.resolve(dirPath, file);
            const stat = fs.statSync(file);

            if (stat && stat.isDirectory()) {
                results = results.concat(await scanDirectory(file));
            } else {
                const ext = path.extname(file).toLowerCase();
                if (VIDEO_EXTENSIONS.includes(ext)) {
                    results.push({
                        file_name: path.basename(file),
                        file_path: file.replace(/\\/g, '/'),
                        file_size: stat.size,
                        extension: ext,
                        created_at: stat.birthtime,
                        modified_at: stat.mtime
                    });
                }
            }
        } catch (e) {
            // Silently skip locked files or protected system items within the loop
        }
    }
    return results;
}

module.exports = { scanDirectory };
