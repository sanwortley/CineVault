-- Add video metadata columns to movies table
ALTER TABLE movies ADD COLUMN IF NOT EXISTS video_width INTEGER;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS video_height INTEGER;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS video_codec TEXT;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS audio_codec TEXT;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS video_bitrate INTEGER;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS original_resolution TEXT; -- e.g., "1080p", "720p"

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_movies_resolution ON movies(original_resolution);
CREATE INDEX IF NOT EXISTS idx_movies_codec ON movies(video_codec);
