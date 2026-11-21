DO $$
BEGIN
  CREATE TYPE jenis_kelamin AS ENUM ('laki-laki', 'perempuan');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Kolom nullable supaya baris lama (data tes) tetap valid;
-- pengajuan baru wajib mengisinya (divalidasi di server).
ALTER TABLE generus
  ADD COLUMN IF NOT EXISTS jenis_kelamin jenis_kelamin;
