const db = require('../db');
const driveApi = require('../drive');
const path = require('path');

async function cleanupDuplicates() {
    console.log('--- Iniciando Limpieza de Duplicados ---');
    
    try {
        const movies = await db.getMovies();
        console.log(`Leídas ${movies.length} películas de la base de datos.`);
        
        // Agrupar por título + año
        const groups = {};
        movies.forEach(movie => {
            const title = (movie.official_title || movie.detected_title || movie.file_name).toLowerCase().trim();
            const year = movie.detected_year || 'unknown';
            const key = `${title} (${year})`;
            
            if (!groups[key]) groups[key] = [];
            groups[key].push(movie);
        });
        
        let totalDeleted = 0;
        let driveFilesTrashed = 0;

        for (const [key, group] of Object.entries(groups)) {
            if (group.length > 1) {
                console.log(`\nDetectado duplicado: "${key}" (${group.length} versiones)`);
                
                // Criterio de selección para el "superviviente":
                // 1. Prioridad: Tiene drive_file_id
                // 2. Prioridad: Mayor tamaño de archivo
                // 3. Prioridad: Id más bajo (el primero que se agregó)
                
                const survivor = group.sort((a, b) => {
                    // Drive priority
                    if (a.drive_file_id && !b.drive_file_id) return -1;
                    if (!a.drive_file_id && b.drive_file_id) return 1;
                    
                    // Size priority
                    const sizeA = parseInt(a.file_size || 0);
                    const sizeB = parseInt(b.file_size || 0);
                    if (sizeA !== sizeB) return sizeB - sizeA; // Descending
                    
                    // ID priority
                    return a.id - b.id;
                })[0];
                
                console.log(`  > Manteniendo: [ID ${survivor.id}] ${survivor.file_name} (${survivor.drive_file_id ? 'EN DRIVE' : 'LOCAL'})`);
                
                const toDelete = group.filter(m => m.id !== survivor.id);
                
                for (const movie of toDelete) {
                    console.log(`  > Eliminando: [ID ${movie.id}] ${movie.file_name}`);
                    
                    // 1. Eliminar de Google Drive si existe
                    if (movie.drive_file_id) {
                        try {
                            if (driveApi.isAuthenticated()) {
                                await driveApi.deleteFile(movie.drive_file_id);
                                console.log(`    - Archivo de Drive movido a papelera (${movie.drive_file_id})`);
                                driveFilesTrashed++;
                            } else {
                                console.warn(`    - [ADVERTENCIA] No se pudo borrar de Drive: No autenticado.`);
                            }
                        } catch (err) {
                            console.error(`    - [ERROR] Falló borrado de Drive: ${err.message}`);
                        }
                    }
                    
                    // 2. Eliminar de la Database (Supabase)
                    try {
                        await db.deleteMovie(movie.id);
                        totalDeleted++;
                        console.log(`    - Registro eliminado de la base de datos.`);
                    } catch (err) {
                        console.error(`    - [ERROR] Falló borrado de DB: ${err.message}`);
                    }
                }
            }
        }
        
        console.log('\n--- Limpieza Finalizada ---');
        console.log(`Registros eliminados de la DB: ${totalDeleted}`);
        console.log(`Archivos movidos a papelera en Drive: ${driveFilesTrashed}`);
        
    } catch (err) {
        console.error('Error fatal durante la limpieza:', err);
    }
}

cleanupDuplicates();
