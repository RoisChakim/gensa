-- server/migrations/013_generus_foto.sql
ALTER TABLE generus
ADD COLUMN IF NOT EXISTS foto_url TEXT;
