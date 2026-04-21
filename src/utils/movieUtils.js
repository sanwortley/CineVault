/**
 * CineVault Movie Utilities
 * Provies logic for grouping duplicates and detecting version metadata (Language, Quality)
 */

export const detectVersionInfo = (movie) => {
    if (!movie) return { label: 'Unknown', isHD: false, lang: '?' };
    
    const text = (movie.file_name || movie.detected_title || '').toUpperCase();
    const info = {
        label: '',
        isHD: text.includes('1080P') || text.includes('FHD') || text.includes('720P') || text.includes('BRRIP') || text.includes('WEBRIP'),
        is4K: text.includes('4K') || text.includes('UHD') || text.includes('2160P'),
        lang: 'EN' // Default
    };

    // Language detection
    if (text.includes('LATINO') || text.includes(' LAT ') || text.includes('.LAT.')) info.lang = 'LAT';
    else if (text.includes('CASTELLANO') || text.includes(' SPA ') || text.includes('.SPA.')) info.lang = 'ESP';
    else if (text.includes('DUAL')) info.lang = 'DUAL';

    // Build label
    let label = info.lang === 'LAT' ? 'Español Latino' : 
                info.lang === 'ESP' ? 'Español' : 
                info.lang === 'DUAL' ? 'Dual (Lat/Eng)' : 'English';

    if (info.is4K) label += ' (4K)';
    else if (info.isHD) label += ' (HD)';

    return { ...info, label };
};

export const groupMoviesByTitle = (moviesList) => {
    if (!moviesList || !Array.isArray(moviesList)) return [];

    const groups = {};
    
    moviesList.forEach(movie => {
        if (!movie) return;
        const key = `${(movie.official_title || movie.detected_title || 'Unknown').trim().toLowerCase()}|${movie.detected_year || '0'}`;
        
        if (!groups[key]) {
            groups[key] = {
                ...movie,
                versions: [movie] // First version
            };
        } else {
            // Check if this file path is already in the versions (to avoid actual dupes in DB showing twice)
            if (!groups[key].versions.some(v => v.file_path === movie.file_path)) {
                groups[key].versions.push(movie);
            }
            
            // Heuristic for primary: choose the one with a DriveID if others don't have it
            if (movie.drive_file_id && !groups[key].drive_file_id) {
                 const versions = groups[key].versions;
                 Object.assign(groups[key], movie);
                 groups[key].versions = versions;
            }
        }
    });

    return Object.values(groups);
};
