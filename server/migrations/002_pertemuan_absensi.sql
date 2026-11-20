DO $$
BEGIN
  CREATE TYPE status_absensi AS ENUM ('hadir', 'izin', 'sakit', 'alfa');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS pertemuan (
  id SERIAL PRIMARY KEY,
  tingkat TEXT NOT NULL
    CHECK (tingkat IN ('kelompok', 'desa', 'daerah')),
  kelompok_id INTEGER REFERENCES kelompok(id),
  desa_id INTEGER REFERENCES desa(id),
  jenjang_target jenjang_generus[] NOT NULL
    CHECK (cardinality(jenjang_target) >= 1),
  tanggal DATE NOT NULL,
  dibuat_oleh INTEGER NOT NULL REFERENCES users(id),
  selesai_pada TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (tingkat = 'kelompok' AND kelompok_id IS NOT NULL AND desa_id IS NULL)
    OR (tingkat = 'desa' AND desa_id IS NOT NULL AND kelompok_id IS NULL)
    OR (tingkat = 'daerah' AND kelompok_id IS NULL AND desa_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS absensi (
  id SERIAL PRIMARY KEY,
  pertemuan_id INTEGER NOT NULL REFERENCES pertemuan(id),
  generus_id INTEGER NOT NULL REFERENCES generus(id),
  status status_absensi NOT NULL,
  dicatat_oleh INTEGER NOT NULL REFERENCES users(id),
  koreksi_count INTEGER NOT NULL DEFAULT 0 CHECK (koreksi_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pertemuan_id, generus_id)
);

CREATE INDEX IF NOT EXISTS absensi_pertemuan_id_idx
  ON absensi (pertemuan_id);

CREATE INDEX IF NOT EXISTS absensi_generus_id_idx
  ON absensi (generus_id);

CREATE INDEX IF NOT EXISTS pertemuan_tanggal_idx
  ON pertemuan (tanggal);
