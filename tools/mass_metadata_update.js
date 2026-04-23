const db = require('../backend/db');
const tmdb = require('../backend/tmdb');

async function massUpdate() {
    console.log('🚀 Iniciando actualización masiva de metadata en segundo plano...');
    try {
        const movies = await db.getMovies();
        console.log(`📦 Procesando ${movies.length} películas...`);
        
        let updated = 0;
        let failed = 0;

        for (const movie of movies) {
            try {
                // Si ya tiene nota de RT, podemos saltarla o forzar (vamos a forzar por si acaso)
                const localTitle = movie.official_title || movie.detected_title;
                const year = movie.detected_year;
                
                console.log(`🔍 [${updated + failed + 1}/${movies.length}] Buscando: "${localTitle}"...`);
                
                // 1. Siempre buscar en TMDb para asegurar que tenemos el título original (inglés)
                let originalTitle = movie.original_title;
                if (!originalTitle) {
                    const tmdbMatch = await tmdb.searchMovie(localTitle, year);
                    if (tmdbMatch) {
                        originalTitle = tmdbMatch.original_title;
                    }
                }

                // 2. Buscar en OMDb usando ambos títulos
                const omdbDetails = await tmdb.getOMDbDetails(localTitle, year, originalTitle);
                
                if (omdbDetails) {
                    // 3. Actualizar la DB con todo lo que encontremos
                    await db.updateMovie(movie.id, {
                        ...omdbDetails,
                        original_title: originalTitle || movie.original_title
                    });
                    updated++;
                    console.log(`✅ [OK] "${localTitle}" actualizado. RT: ${omdbDetails.rt_rating || 'N/A'}`);
                } else {
                    failed++;
                    console.log(`❌ [FAIL] "${localTitle}" no se encontró en OMDb.`);
                }

                // Pequeño delay para no saturar APIs
                await new Promise(r => setTimeout(r, 500));

            } catch (movieErr) {
                console.error(`⚠️ Error procesando película ${movie.id}:`, movieErr.message);
                failed++;
            }
        }

        console.log('────────────────────────────────────────────────');
        console.log(`🏁 Proceso finalizado. Actualizadas: ${updated}, Fallidas: ${failed}`);
        console.log('────────────────────────────────────────────────');
        process.exit(0);

    } catch (err) {
        console.error('❌ ERROR CRÍTICO en el proceso masivo:', err.message);
        process.exit(1);
    }
}

massUpdate();
