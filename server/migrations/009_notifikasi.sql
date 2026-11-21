-- server/migrations/009_notifikasi.sql
CREATE TABLE IF NOT EXISTS notifikasi (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  jenis TEXT NOT NULL CHECK (
    jenis IN (
      'generus_disetujui',
      'generus_ditolak',
      'hapus_disetujui',
      'hapus_ditolak'
    )
  ),
  generus_id INTEGER,
  generus_nama TEXT NOT NULL CHECK (btrim(generus_nama) <> ''),
  judul TEXT NOT NULL CHECK (btrim(judul) <> ''),
  pesan TEXT NOT NULL,
  dibaca BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE generus
  ADD COLUMN IF NOT EXISTS catatan_tolak_hapus TEXT;

CREATE INDEX IF NOT EXISTS notifikasi_user_idx
  ON notifikasi (user_id, dibaca, created_at DESC);
