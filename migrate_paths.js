const db = require('./backend/db');

async function migrate() {
    console.log('=== FORCE POSIX PATH MIGRATION ===');
    
    // 1. Fix Folders
    console.log('Checking Folders...');
    const folders = await db.getFolders();
    console.log(`Found ${folders.length} folders.`);
    for (const folder of folders) {
        // We ALWAYS replace just in case, or if it contains backslashes
        const newPath = folder.folder_path.replace(/\\/g, '/');
        if (newPath !== folder.folder_path) {
            console.log(`[FOLDERS] Migrating: "${folder.folder_path}" -> "${newPath}"`);
            await db.supabaseFetch(`folders?id=eq.${folder.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ folder_path: newPath })
            });
        } else {
            console.log(`[FOLDERS] Already POSIX: ${folder.folder_path}`);
        }
    }

    // 2. Fix Movies
    console.log('\nChecking Movies...');
    const movies = await db.getMovies();
    console.log(`Found ${movies.length} movies.`);
    for (const movie of movies) {
        const newPath = movie.file_path.replace(/\\/g, '/');
        if (newPath !== movie.file_path) {
            console.log(`[MOVIES] Migrating: "${movie.file_path}" -> "${newPath}"`);
            await db.updateMovie(movie.id, { file_path: newPath });
        }
    }

    console.log('\n=== MIGRATION FINISHED ===');
    process.exit(0);
}

migrate().catch(err => {
    console.error('FATAL ERROR during migration:', err);
    process.exit(1);
});
