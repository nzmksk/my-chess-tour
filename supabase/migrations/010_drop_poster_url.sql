-- Remove poster_url column from tournaments table.
-- The posters Supabase bucket has already been deleted.
ALTER TABLE tournaments DROP COLUMN IF EXISTS poster_url;
