-- Migración para añadir soporte de Series de TV y Episodios en la tabla 'movies'
ALTER TABLE movies ADD COLUMN IF NOT EXISTS media_type TEXT DEFAULT 'movie';
ALTER TABLE movies ADD COLUMN IF NOT EXISTS series_title TEXT;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS season_number INTEGER;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS episode_number INTEGER;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS episode_title TEXT;

-- Índices para optimizar las consultas de series
CREATE INDEX IF NOT EXISTS idx_movies_media_type ON movies(media_type);
CREATE INDEX IF NOT EXISTS idx_movies_series_title ON movies(series_title);
