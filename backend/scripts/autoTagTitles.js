const db = require('../db');
const { normalizeFilename } = require('../parser');

async function run() {
    try {
        console.log('[AutoTag] Corrigiendo etiquetas a inglés por defecto...');
        const movies = await db.getMovies();
        
        let updatedCount = 0;
        
        for (const movie of movies) {
            const title = movie.official_title;
            if (!title) continue;

            // Si ya tiene [Español] o [Dual Audio], lo dejamos como está
            if (title.includes('[Español]') || title.includes('[Dual Audio]')) continue;

            // Detectar el idioma desde el archivo original
            const sourceText = movie.detected_title || movie.file_name || '';
            const { language } = normalizeFilename(sourceText);

            let newTitle = null;

            if (title.includes('[') && title.includes(']')) {
                // Ya tiene etiqueta (ej: [1080P], [English]) → reemplazar por [English]
                newTitle = title.replace(/\[.*?\]/, '[English]').trim();
            } else {
                // No tiene etiqueta → añadir [English] por defecto
                // Solo añadir [Español] si fue detectado claramente
                if (language === 'Español') {
                    newTitle = `${title} [Español]`;
                } else {
                    newTitle = `${title} [English]`;
                }
            }

            if (newTitle && newTitle !== title) {
                console.log(`[AutoTag] ID ${movie.id}: "${title}" -> "${newTitle}"`);
                await db.updateMovie(movie.id, { official_title: newTitle });
                updatedCount++;
            }
        }

        console.log(`[AutoTag] ¡Listo! Se actualizaron ${updatedCount} títulos.`);
        process.exit(0);
    } catch (err) {
        console.error('[AutoTag] Error:', err.message);
        process.exit(1);
    }
}

run();
