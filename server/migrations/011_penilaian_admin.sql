-- server/migrations/011_penilaian_admin.sql
ALTER TABLE penilaian
ADD COLUMN IF NOT EXISTS diubah_oleh_admin BOOLEAN NOT NULL DEFAULT false;
