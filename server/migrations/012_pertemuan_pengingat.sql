-- server/migrations/012_pertemuan_pengingat.sql
ALTER TABLE pertemuan
ADD COLUMN IF NOT EXISTS pengingat_jam INTEGER
CHECK (pengingat_jam BETWEEN 1 AND 720);
