-- server/migrations/008_kelas.sql
-- Disusun dari konteks yang diberikan; belum dijalankan atau diuji di repo.

CREATE TABLE IF NOT EXISTS kelas (
  id SERIAL PRIMARY KEY,
  jenjang jenjang_generus NOT NULL,
  nama TEXT NOT NULL CHECK (btrim(nama) <> ''),
  urutan INTEGER NOT NULL DEFAULT 0,
  aktif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (jenjang, nama)
);

INSERT INTO kelas (jenjang, nama, urutan)
VALUES
  ('caberawit', 'AUD', 1),
  ('caberawit', 'A', 2),
  ('caberawit', 'B', 3),
  ('caberawit', 'C', 4),
  ('caberawit', 'D', 5),
  ('caberawit', 'E', 6),
  ('caberawit', 'F', 7),
  ('pra_remaja', 'A', 1),
  ('pra_remaja', 'B', 2),
  ('pra_remaja', 'C', 3),
  ('remaja', 'A', 1),
  ('remaja', 'B', 2),
  ('remaja', 'C', 3),
  ('usia_nikah', 'A', 1),
  ('usia_nikah', 'B', 2)
ON CONFLICT (jenjang, nama) DO NOTHING;

CREATE TABLE IF NOT EXISTS riwayat_kelas (
  id SERIAL PRIMARY KEY,
  generus_id INTEGER NOT NULL REFERENCES generus(id) ON DELETE CASCADE,
  kelas_lama TEXT,
  kelas_baru TEXT NOT NULL,
  diubah_oleh INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE generus
  ADD COLUMN IF NOT EXISTS kelas_id INTEGER REFERENCES kelas(id);

ALTER TABLE tugas
  ADD COLUMN IF NOT EXISTS kelas_id INTEGER REFERENCES kelas(id);

ALTER TABLE tugas
  ADD COLUMN IF NOT EXISTS tahun_ajaran INTEGER
    CHECK (tahun_ajaran BETWEEN 2000 AND 2100);

CREATE INDEX IF NOT EXISTS kelas_jenjang_idx
  ON kelas (jenjang, urutan);

CREATE INDEX IF NOT EXISTS riwayat_kelas_generus_idx
  ON riwayat_kelas (generus_id, created_at DESC);
