# Codex — GENSA MVP Sesi 1, Langkah A: skema database + seed

Kamu membangun backend GENSA (sistem manajemen generus / anggota
pengajian). PENTING: kamu TIDAK bisa membaca/menulis file di VM ini
(shell tidak tersedia). Jadi tugasmu: OUTPUT isi file lengkap dalam
blok kode berlabel nama file. Saya yang akan menulis file-nya.
Jangan tanya, jangan minta baca file — semua konteks ada di prompt ini.

## Konteks produk (ringkas, dari jawaban pemilik)

- Hierarki: 1 Daerah → 3 Desa → tiap desa 5–6 Kelompok.
- Peran (1 akun = 1 peran): Admin Utama (akses penuh, buat semua akun),
  Daerah (lihat semua di wilayahnya, TIDAK bisa tambah generus),
  Desa (wilayah desanya), Kelompok (hanya kelompoknya).
- Generus: ditambah HANYA oleh Kelompok lewat pengajuan → status
  `pending` → Admin Utama approve/reject (reject wajib catatan).
  Sebelum disetujui belum bisa absen. Hapus generus juga diajukan
  Kelompok dengan alasan, disetujui Admin; bila disetujui, data +
  riwayat ikut hilang. Pindah kelompok = daftar ulang ke kelompok
  baru seperti awal.
- Data generus: nama, tanggal lahir, kelas sekolah, tingkat
  pendidikan (paud/sd/smp/sma/kuliah/kerja), jenjang OTOMATIS dari
  tingkat (PAUD–SD=caberawit, SMP=pra remaja, SMA=remaja,
  Kuliah/Kerja=usia nikah). Orang tua: nama, hubungan, no HP.
- QR: satu QR per generus, tidak berubah, dicetak dari aplikasi.
  QR berisi ID acak yang tidak bisa ditebak (bukan data pribadi).
  Ada juga kode manual pendek yang unik.
- Akun: dibuat Admin saja; email wajib; password awal dari Admin,
  wajib diganti saat login pertama (1 kali ganti paksa). Reset
  password via email (SMTP belum ada — tahap berikutnya).
- Data awal: KOSONG, pemilik input sendiri. Seed hanya struktur
  organisasi + akun Admin.
- Palet UI: krem hangat #F6F1E9, coklat #8A5A33, sage #5F7A57.
  Bahasa Indonesia natural, mobile-first.

## Aturan keamanan (WAJIB, jangan dipotong)

- Semua query pakai parameter/prepared statement, tanpa tempel string.
- Password di-hash (bcrypt/argon2) + salt, jangan pernah polos.
- Jangan tulis rahasia apa pun (password, token, API key) di kode.
  Kredensial hanya dari environment variable.
- Pesan error jangan bocorkan struktur database.

## Gaya kerja

- Perubahan terkecil yang menyelesaikan tugas (Ponytail): tanpa fitur
  tambahan, tanpa abstraksi yang tidak diminta.
- Stack sesi ini: Node.js 24 + PostgreSQL 16 + driver `pg` +
  `bcryptjs`. Tanpa framework web, tanpa ORM.

## Database

PostgreSQL 16, host 127.0.0.1 port 5432, database + user `gensa`.
Koneksi dari ENV `DATABASE_URL` (format
postgres://gensa:PASSWORD@127.0.0.1:5432/gensa). Jangan tulis
password di file mana pun.

## OUTPUT yang saya minta (3 file, lengkap, siap tulis)

### 1. `server/migrations/001_init.sql`
Skema lengkap, idempotent sebisa mungkin (CREATE TABLE IF NOT EXISTS):
- `daerah` (id serial PK, nama, created_at).
- `desa` (id, daerah_id FK, nama, created_at).
- `kelompok` (id, desa_id FK, nama, created_at).
- `users` (id, email unik, password_hash, role enum
  admin/daerah/desa/kelompok, desa_id nullable FK, kelompok_id
  nullable FK, must_change_password boolean default true,
  active boolean default true, created_at).
- `generus` (id, kelompok_id FK, nama, tanggal_lahir date,
  kelas_sekolah, tingkat enum paud/sd/smp/sma/kuliah/kerja,
  jenjang enum caberawit/pra_remaja/remaja/usia_nikah,
  ortu_nama, ortu_hubungan, ortu_hp, status enum
  pending/approved/rejected/delete_pending, alasan_penolakan,
  requested_by FK users, decided_by FK users nullable,
  decided_at nullable, qr_token unik nullable (diisi saat approve),
  kode_manual unik nullable (pendek, diisi saat approve),
  created_at, updated_at).
- `sessions` (token PK text acak, user_id FK, expires_at, revoked
  boolean default false, created_at).
- Index yang perlu (email, kelompok_id, status, qr_token,
  kode_manual). Komentar SQL singkat berbahasa Indonesia.

### 2. `server/seed.js`
Script Node (pakai `pg`, baca `DATABASE_URL` dari env, baca password
admin dari env `ADMIN_PASSWORD` — wajib, error bila kosong):
- Buat 1 daerah "Daerah Contoh", 3 desa ("Desa Contoh 1..3"),
  1 kelompok per desa ("Kelompok Contoh A/B/C").
- Buat 1 akun Admin Utama (email dari env `ADMIN_EMAIL`,
  default admin@gensa.local). Hash password dengan bcryptjs.
- Idempotent: jalankan 2x tidak dobel (ON CONFLICT DO NOTHING).
- Generus KOSONG. Cetak ringkasan singkat hasil seed. Tanpa
  menulis rahasia ke log (jangan cetak password).

### 3. `.env.example`
Contoh variabel (tanpa nilai asli): DATABASE_URL, PORT (3101),
SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD.

## Format jawaban

Untuk tiap file: satu blok kode dengan label path file di atasnya,
isi file LENGKAP tanpa potongan ("..."). Jangan tambah file lain.
Akhiri dengan ringkasan 5 baris: keputusan desain + yang belum
diputuskan. Bahasa jawaban: Indonesia.
