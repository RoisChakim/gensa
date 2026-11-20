# Database GENSA — PostgreSQL 16

> BUKAN SQLite. Wajib PostgreSQL (keputusan pengguna 2026-11-20).

## Koneksi

- Host: `127.0.0.1`, Port: `5432`
- Database: `gensa`
- User: `gensa`
- Password: baca dari `~/.gensa-db-password` (mode 600) — JANGAN tulis
  password di kode, di repo, atau di chat.
- Container Docker: `gensa-postgres` (image `postgres:16-alpine`),
  `--network none` (bind langsung ke port host, sesuai aturan VM ini).
- Data tersimpan di layer container Docker (data dir
  `~/workspace/docker-hosting/data/` persisten). Backup berkala ada di
  `backups/` (lihat `docs/backup-db.sh`).

Contoh koneksi (dari shell VM):

```sh
PGPASSWORD="$(cat ~/.gensa-db-password)" \
  psql -h 127.0.0.1 -U gensa -d gensa
```

## Catatan

- `docker exec` TIDAK bisa dipakai di VM ini — pakai `psql` dari host
  untuk akses database.
- Jangan ganti ke SQLite. Kalau container bermasalah, cek
  `docker logs gensa-postgres` lalu `docker restart gensa-postgres`.
- Schema/tabel dibuat oleh Codex saat membangun aplikasi (ikuti
  `docs/skills/web-security.md`: pakai parameter, bukan tempel string).
