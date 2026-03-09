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
    const list = fs.readdirSync(dirPath);

    for (let file of list) {
        file = path.resolve(dirPath, file);
        const stat = fs.statSync(file);

        if (stat && stat.isDirectory()) {
            results = results.concat(await scanDirectory(file));
        } else {
            const ext = path.extname(file).toLowerCase();
            if (VIDEO_EXTENSIONS.includes(ext)) {
                results.push({
                    file_name: path.basename(file),
                    file_path: file,
                    file_size: stat.size,
                    extension: ext,
                    created_at: stat.birthtime,
                    modified_at: stat.mtime
                });
            }
        }
    }
    return results;
}

module.exports = { scanDirectory };
