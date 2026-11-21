-- server/migrations/010_izin_kelompok.sql
ALTER TABLE kelompok ADD COLUMN IF NOT EXISTS izin_token TEXT UNIQUE;
