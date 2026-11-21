# GENSA — Sistem Manajemen Generus

GENSA adalah aplikasi web untuk mengelola data generus (anak didik pengajian)
berjenjang kelompok – desa – daerah, lengkap dengan absensi QR code, jadwal
mengaji, penilaian materi, dan laporan kehadiran.

Aplikasi ini terdiri dari backend Node.js + database PostgreSQL. Bukan lagi
demo statis — semua data tersimpan di database, tersinkron antar pengurus
dan perangkat, dengan akun per kelompok/desa/daerah.

## Fitur

- **Akun & peran** — Admin, Daerah, Desa, Kelompok. Akun dibuat Admin;
  1 akun = 1 peran. Login pakai email + password (atau login Google),
  role ikut akun — tidak ada pilihan peran di layar login.
- **Generus** — Kelompok mengajukan generus baru, Admin menyetujui.
  Data: nama, umur, kelas, tanggal lahir, jenis kelamin, data orang tua.
  Jenjang otomatis dari kelas (PAUD–SD caberawit, SMP pra remaja,
  SMA remaja, Kuliah/Kerja usia nikah).
- **QR & absensi** — 1 QR per generus (tidak pernah berubah, bisa dicetak
  ulang). Absen lewat scan kamera HP, kode manual 6 karakter, atau token QR.
  Status hadir/izin/sakit/alfa. Cegah absen ganda, koreksi 1x dalam 24 jam.
  Absen offline: dicatat di HP, sync saat online (aturan "hadir yang menang").
- **Jadwal** — dibuat per tingkat (kelompok/desa/daerah), target jenjang
  bisa dicentang. Bisa diubah/dihapus selama belum selesai.
- **Link izin** — tautan publik per jadwal; orang tua/wali pilih nama,
  verifikasi pakai scan barcode atau kode, isi alasan (izin wajib tulis
  alasan). Pengurus kelompok menyetujui dulu, baru masuk absensi.
- **Materi & penilaian** — matriks per anak (Doa & Surat: Hafal/Belum;
  Makna Pegon & Praktik Solat: Bisa/Tidak). Nilai bisa diubah maks 2x.
- **Laporan Word** — rekap + rincian per generus, persentase kehadiran
  (hadir/wajib), periode mingguan/bulanan, unduh .docx asli.
- **PWA** — bisa di-install di HP; reset password lewat email.

## Cara Menjalankan (lokal)

Butuh Node.js 20+ dan PostgreSQL 16.

```bash
# 1. Masuk folder server
cd server

# 2. Install dependensi
npm install

# 3. Salin .env.example ke .env, lalu isi:
#    DATABASE_URL, PORT, SESSION_SECRET
cp ../.env.example .env

# 4. Jalankan migrasi + seed (akun admin awal)
node migrate.js
node seed.js

# 5. Jalankan server
node server/index.js
```

Buka `http://127.0.0.1:3101/login.html`, masuk dengan akun admin awal
(`admin@gensa.local`, password awal ada di `STATE.md` — wajib diganti
saat login pertama).

## Deploy (Vercel, uji coba)

Panduan lengkap ada di `docs/DEPLOY-VERCEL.md`. Ringkasnya: butuh database
PostgreSQL hosted (Neon gratis) dan project Vercel (Root Directory: `server`).
Login Google dilewati dulu saat uji coba.

## Peran dan Lingkup

| Peran | Lingkup | Akses |
| --- | --- | --- |
| Admin | Semua desa dan kelompok | Penuh |
| Daerah | Semua desa dan kelompok | Lihat semua (rekap sendiri, tanpa nama) + rincian per jenjang |
| Desa | Desanya sendiri + kelompok di dalamnya | Kelola desanya dan kelompok di bawahnya |
| Kelompok | Kelompoknya sendiri | CRUD hanya di kelompoknya sendiri; satu-satunya yang bisa mengajukan generus baru |

Generus tidak bisa login — mereka hanya menunjukkan QR code saat hadir.

## Teknologi

- Backend: Node.js (tanpa framework berat), PostgreSQL 16.
- Dependensi: `pg`, `bcryptjs`, `qrcode`, `docx`, `jsqr`.
- Front-end: halaman statis di `server/public/` (tanpa build step).
- Palet: krem hangat (#F6F1E9), tombol coklat (#8A5A33) tanpa gradasi,
  aksen sage (#5F7A57 / #7C9A6E). Bahasa antarmuka: Bahasa Indonesia.

## Struktur Berkas

```
server/
  index.js                  Backend (API + halaman statis)
  db.js                     Koneksi database
  migrate.js                Jalankan migrasi
  seed.js                   Data awal (daerah/desa/kelompok + admin)
  migrations/               001–006 (skema + fitur)
  public/                   Halaman: login, jadwal, scan, laporan,
                            materi, cetak-qr, izin, reset-password
  smoke-test*.js            Tes otomatis per sesi
  api/index.js              Entri serverless (Vercel)
  vercel.json               Konfigurasi Vercel
docs/
  PRD_GENSA.md              PRD v1.0 (final)
  PRD_JAWABAN.md            Jawaban lengkap atas pertanyaan PRD
  DEPLOY-VERCEL.md          Panduan deploy uji coba
  database.md               Skema database
  backup-db.sh              Script backup database
  skills/                   Skill wajib Codex (web-security, ponytail, uiux)
STATE.md                    Status pembangunan per sesi (handoff Codex)
AGENTS.md                   Aturan kerja Codex di repo ini
```

## Catatan Penting

- **Hapus generus ber-riwayat masih bermasalah** — hapus generus yang
  sudah punya absensi/nilai akan gagal (foreign key). Jangan hapus
  generus ber-riwayat sampai diperbaiki.
- **Link izin publik belum ada rate limit** — kode 6 karakter bisa
  ditebak berulang. Jangan sebarkan link izin ke luar pengurus.
- Login Google butuh kredensial OAuth asli dari Google Cloud Console.
- Reset password belum kirim email — tautan hanya terlihat di log server.
- Detail kolom laporan Word dan struktur kelas lengkap masih menyusul.

## Lisensi

Dibuat untuk dipakai pengurus generus. Silakan dipakai dan diubah untuk
kebutuhan internal.
