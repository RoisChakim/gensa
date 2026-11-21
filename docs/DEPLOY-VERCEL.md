# Deploy GENSA ke Vercel (uji coba)

> Status: kode sudah siap deploy. Yang belum: akun Neon (database) dan
> akses Vercel — keduanya perlu dibuat pengguna (lihat Langkah 1–2).
> Jangan pernah commit `.env` atau menaruh kredensial asli di repo.

## Yang sudah disiapkan di repo

- `server/api/index.js` — entri serverless Vercel, meneruskan `(req, res)`
  ke handler yang sama dengan server lokal.
- `server/vercel.json` — rewrite `/api/*` dan `/` ke `/api/index`.
  Halaman statis (`login.html`, `jadwal.html`, …) dilayani langsung dari
  `server/public/` oleh Vercel.
- `server/index.js` — perubahan kecil khusus deploy (semua sudah dites,
  smoke test S1/S3–S10 lulus, tidak ada regresi):
  - `server.listen()` hanya jalan bila berkas dijalankan langsung
    (`node server/index.js`); bila di-require, modul mengekspor handler.
  - `TRUST_PROXY=1`: protokol dibaca dari `x-forwarded-proto` untuk cek
    Origin dan flag `Secure` pada cookie. Tanpa ini, semua POST dari
    browser di Vercel ditolak 403 (TLS berakhir di edge Vercel).
  - `APP_URL`: basis URL publik untuk tautan reset password. Bila kosong,
    tetap pakai alamat lokal seperti dulu.
  - Sesi tetap di database (bukan memori), jadi aman dipakai serverless.
  - Halaman memakai fetch relatif (`/api/...`), jadi jalan di domain apa
    pun.

## Langkah 1 — Database Neon (gratis, tanpa kartu)

1. Buka https://neon.tech, daftar (gratis, tidak perlu kartu kredit).
2. Buat project baru, region **Singapore (ap-southeast-1)** — paling dekat.
3. Di dashboard Neon, salin **connection string (pooled)** — yang ada
   tulisan `-pooler` di host-nya. Bentuknya:
   `postgres://<user>:<password>@<host>-pooler.../<db>?sslmode=require`
   (pakai yang pooled, bukan yang direct — serverless butuh pooler).
4. Simpan connection string itu — nanti dimasukkan ke Vercel sebagai
   `DATABASE_URL`. Jangan ditempel di chat atau di repo.

Batas paket gratis Neon (per Nov 2026): 1 GB storage, 100 CU-hours/bulan,
compute tidur setelah 5 menit tidak dipakai (query pertama membangunkan,
butuh beberapa detik), 5 GB egress/bulan. Cukup untuk uji coba.

## Langkah 2 — Project Vercel

Pilih salah satu:

**A. Lewat konektor Vercel di Muse** (kalau sudah terhubung): buat project
baru dari repo `RoisChakim/gensa`.

**B. Lewat dashboard Vercel** (seperti deploy portfolio dulu):
1. Buka https://vercel.com/dashboard, Add New → Project.
2. Import repo `RoisChakim/gensa`, branch `main`.
3. **Root Directory: `server`** (penting — kode ada di folder `server/`).
4. Framework Preset: **Other** (bukan Next.js).
5. Tambah Environment Variables (Production):
   - `DATABASE_URL` = connection string Neon (pooled, dari Langkah 1)
   - `SESSION_SECRET` = string acak baru minimal 32 karakter (buat baru,
     JANGAN pakai yang di `.env` lokal)
   - `TRUST_PROXY` = `1`
   - `APP_URL` = `https://<nama-project>.vercel.app` (isi setelah tahu
     domainnya; boleh ditambah setelah deploy pertama, lalu redeploy)
   - Login Google **jangan diisi dulu** untuk uji coba (butuh setting
     redirect URI di Google Cloud Console — menyusul).
6. Deploy.

## Langkah 3 — Migrasi + seed ke database Neon

Dari VM (atau laptop), dengan `DATABASE_URL` Neon:

```bash
cd ~/workspace/gensa-repo
DATABASE_URL='<neon-pooled-url>' node server/migrate.js
DATABASE_URL='<neon-pooled-url>' ADMIN_EMAIL=admin@gensa.local \
  ADMIN_PASSWORD='<password-admin-baru>' node server/seed.js
```

`ADMIN_PASSWORD` diisi password baru (acak, min. 8 karakter) khusus uji
coba — jangan pakai password `.env` lokal. Catat password ini dan berikan
ke pengguna lewat jalur aman (bukan di repo).

Seed membuat: Daerah Contoh, 3 desa + 3 kelompok contoh, akun admin, dan
2 akun tes `@tes.gensa.local`.

## Langkah 4 — Verifikasi

1. Buka `https://<nama-project>.vercel.app` → harus redirect ke
   `/login.html`.
2. Login sebagai `admin@gensa.local` dengan password dari Langkah 3.
   Saat login pertama, ganti password (flag `must_change_password`).
3. Coba dari HP: buka jadwal, scan QR (butuh HTTPS — Vercel sudah HTTPS,
   jadi kamera bisa dipakai).

## Batasan uji coba ini

- **Login Google tidak aktif** (butuh kredensial OAuth + redirect URI
  `https://<domain>/api/auth/google/callback` di Google Cloud Console).
- **Reset password belum kirim email** (M4 dari review): tautan reset hanya
  muncul di log runtime Vercel (dashboard → project → Logs). Admin bisa
  ambil dari sana bila diperlukan.
- **Bug R8 (belum diperbaiki):** hapus generus yang punya riwayat absensi/
  nilai gagal (error database). Jangan hapus generus yang sudah ada
  riwayatnya selama uji coba.
- **Rate limit login per-instans:** perlindungan brute-force disimpan di
  memori tiap function — di serverless, tiap instans punya hitungannya
  sendiri. Untuk uji coba tidak masalah; untuk produksi perlu
  dipindah ke database.
- **Ikon PWA** (`icon-192.png`, `icon-512.png`) belum ada di GitHub
  (konektor tidak bisa push file biner) — upload lewat web GitHub dulu,
  kalau tidak manifest akan 404 untuk ikon (tidak fatal).
- **Cold start Neon:** setelah 5 menit tidak dipakai, query pertama
  butuh beberapa detik untuk membangunkan database.
- **Biaya:** $0 — Vercel Hobby + Neon Free. Tidak ada kartu yang
  didaftarkan di mana pun.
