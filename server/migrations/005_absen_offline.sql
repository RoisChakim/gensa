CREATE TABLE IF NOT EXISTS sync_items (
  id SERIAL PRIMARY KEY,
  pertemuan_id INTEGER NOT NULL REFERENCES pertemuan(id),
  generus_id INTEGER NOT NULL REFERENCES generus(id),
  client_id TEXT NOT NULL CHECK (btrim(client_id) <> ''),
  status status_absensi NOT NULL,
  dicatat_pada TIMESTAMPTZ,
  dicatat_oleh INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pertemuan_id, client_id)
);

CREATE INDEX IF NOT EXISTS sync_items_pertemuan_id_idx
  ON sync_items (pertemuan_id);

ALTER TABLE absensi ADD COLUMN IF NOT EXISTS dicatat_pada TIMESTAMPTZ;
