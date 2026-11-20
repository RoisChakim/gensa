DO $$
BEGIN
  CREATE TYPE kategori_tugas AS ENUM (
    'doa_surat',
    'makna_pegon',
    'praktik_solat'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE nilai_penilaian AS ENUM (
    'hafal',
    'belum',
    'bisa',
    'tidak'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS tugas (
  id SERIAL PRIMARY KEY,
  judul TEXT NOT NULL CHECK (btrim(judul) <> ''),
  kategori kategori_tugas NOT NULL,
  kelompok_id INTEGER REFERENCES kelompok(id),
  dibuat_oleh INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS penilaian (
  id SERIAL PRIMARY KEY,
  generus_id INTEGER NOT NULL REFERENCES generus(id),
  tugas_id INTEGER NOT NULL REFERENCES tugas(id),
  nilai nilai_penilaian NOT NULL,
  diubah_count INTEGER NOT NULL DEFAULT 0,
  dicatat_oleh INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (generus_id, tugas_id)
);
