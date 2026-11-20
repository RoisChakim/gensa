#!/bin/sh
# Backup database GENSA (PostgreSQL di container gensa-postgres).
# Dijalankan berkala (cron) supaya data selamat walau container dihapus.
# Password dibaca dari ~/.gensa-db-password (mode 600), bukan dari file ini.
set -e
BACKUP_DIR="$HOME/workspace/gensa-repo/backups"
mkdir -p "$BACKUP_DIR"
export PGPASSWORD="$(cat "$HOME/.gensa-db-password")"
pg_dump -h 127.0.0.1 -U gensa -d gensa -F c -f "$BACKUP_DIR/gensa-$(date +%Y%m%d-%H%M).dump"
unset PGPASSWORD
# Simpan hanya 7 backup terbaru
ls -t "$BACKUP_DIR"/gensa-*.dump 2>/dev/null | tail -n +8 | xargs -r rm -f
echo "Backup selesai: $BACKUP_DIR"
