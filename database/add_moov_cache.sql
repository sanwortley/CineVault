-- Persiste el resultado de la deteccion del atomo moov (inyeccion MP4 para streaming
-- de archivos no-faststart) para que sobreviva a redeploys de Railway. Antes solo
-- vivia en memoria del proceso, asi que cada redeploy forzaba a recalcularlo
-- (2 fetches a Drive: 100KB + 10MB) en la primera reproduccion de cada pelicula.
ALTER TABLE movies ADD COLUMN IF NOT EXISTS moov_ftyp_size INTEGER;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS moov_box_size INTEGER;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS moov_header_b64 TEXT;
