-- Tabla de perfiles multiusuario (Netflix-style)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  is_kid BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Permitir que cada usuario tenga hasta 5 perfiles
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);

-- Agregar columnas faltantes a movies para filtro kids
ALTER TABLE movies ADD COLUMN IF NOT EXISTS certification TEXT;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS adult BOOLEAN DEFAULT false;

-- Agregar profile_id a tablas de datos de usuario (nullable para retrocompatibilidad)
ALTER TABLE user_movie_progress ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE user_mylist ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE user_movie_ratings ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE;

-- Índices para consultas por profile_id
CREATE INDEX IF NOT EXISTS idx_user_movie_progress_profile_id ON user_movie_progress(profile_id);
CREATE INDEX IF NOT EXISTS idx_user_mylist_profile_id ON user_mylist(profile_id);
CREATE INDEX IF NOT EXISTS idx_user_movie_ratings_profile_id ON user_movie_ratings(profile_id);

-- Modificar unique constraints para incluir profile_id
-- Nota: En Supabase esto se maneja a nivel de aplicación via on_conflict
