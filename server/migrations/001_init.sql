-- Tipe enum dibuat sekali agar migrasi dapat dijalankan ulang.
DO $$
BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'daerah', 'desa', 'kelompok');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE tingkat_pendidikan AS ENUM (
    'paud', 'sd', 'smp', 'sma', 'kuliah', 'kerja'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE jenjang_generus AS ENUM (
    'caberawit', 'pra_remaja', 'remaja', 'usia_nikah'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE status_generus AS ENUM (
    'pending', 'approved', 'rejected', 'delete_pending'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS daerah (
  id SERIAL PRIMARY KEY,
  nama TEXT NOT NULL UNIQUE CHECK (btrim(nama) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS desa (
  id SERIAL PRIMARY KEY,
  daerah_id INTEGER NOT NULL REFERENCES daerah(id),
  nama TEXT NOT NULL CHECK (btrim(nama) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (daerah_id, nama)
);

CREATE TABLE IF NOT EXISTS kelompok (
  id SERIAL PRIMARY KEY,
  desa_id INTEGER NOT NULL REFERENCES desa(id),
  nama TEXT NOT NULL CHECK (btrim(nama) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (desa_id, nama)
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL CHECK (btrim(email) <> ''),
  password_hash TEXT NOT NULL CHECK (btrim(password_hash) <> ''),
  role user_role NOT NULL,
  desa_id INTEGER REFERENCES desa(id),
  kelompok_id INTEGER REFERENCES kelompok(id),
  must_change_password BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Setiap peran hanya memiliki lingkup yang sesuai.
  CHECK (
    (role IN ('admin', 'daerah') AND desa_id IS NULL AND kelompok_id IS NULL)
    OR (role = 'desa' AND desa_id IS NOT NULL AND kelompok_id IS NULL)
    OR (role = 'kelompok' AND desa_id IS NULL AND kelompok_id IS NOT NULL)
  )
);

-- Email unik tanpa membedakan huruf besar dan kecil.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx
  ON users (lower(email));

CREATE TABLE IF NOT EXISTS generus (
  id SERIAL PRIMARY KEY,
  kelompok_id INTEGER NOT NULL REFERENCES kelompok(id),
  nama TEXT NOT NULL CHECK (btrim(nama) <> ''),
  tanggal_lahir DATE NOT NULL,
  kelas_sekolah TEXT NOT NULL,
  tingkat tingkat_pendidikan NOT NULL,
  -- Jenjang selalu mengikuti tingkat pendidikan.
  jenjang jenjang_generus GENERATED ALWAYS AS (
    CASE
      WHEN tingkat IN ('paud', 'sd') THEN 'caberawit'::jenjang_generus
      WHEN tingkat = 'smp' THEN 'pra_remaja'::jenjang_generus
      WHEN tingkat = 'sma' THEN 'remaja'::jenjang_generus
      WHEN tingkat IN ('kuliah', 'kerja') THEN 'usia_nikah'::jenjang_generus
    END
  ) STORED,
  ortu_nama TEXT NOT NULL CHECK (btrim(ortu_nama) <> ''),
  ortu_hubungan TEXT NOT NULL CHECK (btrim(ortu_hubungan) <> ''),
  ortu_hp TEXT NOT NULL CHECK (btrim(ortu_hp) <> ''),
  status status_generus NOT NULL DEFAULT 'pending',
  alasan_penolakan TEXT,
  alasan_penghapusan TEXT,
  requested_by INTEGER NOT NULL REFERENCES users(id),
  decided_by INTEGER REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  qr_token TEXT UNIQUE,
  kode_manual TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'rejected' OR NULLIF(btrim(alasan_penolakan), '') IS NOT NULL),
  CHECK (status <> 'delete_pending' OR NULLIF(btrim(alasan_penghapusan), '') IS NOT NULL),
  CHECK (
    (status IN ('approved', 'delete_pending') AND qr_token IS NOT NULL AND kode_manual IS NOT NULL)
    OR (status IN ('pending', 'rejected') AND qr_token IS NULL AND kode_manual IS NULL)
  ),
  CHECK (qr_token IS NULL OR btrim(qr_token) <> ''),
  CHECK (kode_manual IS NULL OR btrim(kode_manual) <> '')
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY CHECK (btrim(token) <> ''),
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS generus_kelompok_id_idx ON generus (kelompok_id);
CREATE INDEX IF NOT EXISTS generus_status_idx ON generus (status);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
-- UNIQUE pada qr_token dan kode_manual sudah membuat indeks masing-masing.
