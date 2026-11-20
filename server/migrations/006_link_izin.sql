DO $$
BEGIN
  CREATE TYPE status_izin AS ENUM ('menunggu', 'disetujui', 'ditolak');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS izin (
  id SERIAL PRIMARY KEY,
  pertemuan_id INTEGER NOT NULL REFERENCES pertemuan(id),
  generus_id INTEGER NOT NULL REFERENCES generus(id),
  alasan TEXT NOT NULL CHECK (alasan IN ('sakit', 'izin')),
  keterangan TEXT,
  status status_izin NOT NULL DEFAULT 'menunggu',
  diputuskan_oleh INTEGER REFERENCES users(id),
  diputuskan_pada TIMESTAMPTZ,
  catatan_penolakan TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (alasan <> 'izin' OR NULLIF(btrim(keterangan), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS izin_pertemuan_id_idx
  ON izin (pertemuan_id);

CREATE INDEX IF NOT EXISTS izin_generus_id_idx
  ON izin (generus_id);

ALTER TABLE pertemuan
  ADD COLUMN IF NOT EXISTS izin_token TEXT UNIQUE;
