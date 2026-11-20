# Prompt Codex — GENSA MVP Sesi 1: Akun & Peran + Tambah Generus + Persetujuan

> Jalankan 2026-11-20 ~23:57 WIB, setelah limit Codex kembali.
> Model: gpt-6.1-terra, reasoning medium.
> Satu perubahan kecil per sesi (ikuti AGENTS.md). Sesi ini HANYA
> fondasi: server + skema DB + auth + akun + tambah generus +
> persetujuan. QR/absensi/jadwal/laporan Word = sesi berikutnya.

## PENTING — cara baca/tulis file di VM ini

File tools Codex RUSAK di VM ini (`codex-code-mode-host` tidak ada).
Baca file dengan shell: `cat <file>`. Tulis/ubah file dengan shell:
`cat > <file> <<'EOF' ... EOF` atau `python3` / `node` script.
JANGAN mengandalkan file tools — semua baca/tulis lewat shell.
Verifikasi setiap tulis dengan `cat` / `ls` sesudahnya.

## Baca dulu (lewat `cat`)

1. `STATE.md` — progres terakhir (jangan baca ulang semua file).
2. `AGENTS.md` — aturan kerja.
3. `docs/skills/web-security.md`, `docs/skills/ponytail.md`,
   `docs/skills/uiux.md` — WAJIB sebelum menulis kode.
4. `docs/PRD_JAWABAN.md` — jawaban pemilik (24 + 28 + 19 jawaban).
   JANGAN tanya lagi hal yang sudah dijawab di sini.
5. `docs/database.md` — PostgreSQL 16, host 127.0.0.1:5432, DB+user
   `gensa`, password di `~/.gensa-db-password` (mode 600).
   JANGAN tulis password di kode/repo/chat.
6. `docs/SPESIFIKASI.md` — ringkas, untuk konteks hierarki & jenjang.

## Tugas sesi 1 (fondasi MVP saja)

Bangun backend GENSA (Node.js 24, PostgreSQL 16). Pilih dependensi
paling sedikit yang bisa jalan (stdlib dulu; kalau tambah dep,
satu baris alasan di STATE.md). Server listen di 127.0.0.1 port 3101
(kalau terpakai, pilih port bebas lain dan catat di STATE.md).
Jangan ubah `index.html` (demo v1) — sesi ini backend + API saja,
plus SATU halaman login minimal dengan palet GENSA
(krem #F6F1E9, coklat #8A5A33, sage #5F7A57).

### 1. Skema database (migrasi SQL di `server/migrations/`)

- `daerah` (1 baris), `desa`, `kelompok` (desa_id FK).
- `users`: email unik, password hash (bcrypt/argon2 — JANGAN polos),
  role enum `admin|daerah|desa|kelompok`, scope (desa_id/kelompok_id
  nullable), `must_change_password` boolean, `active` boolean,
  created_at. 1 akun = 1 peran. Akun dibuat Admin saja.
- `generus`: nama, tanggal_lahir, kelas_sekolah, jenjang otomatis
  (PAUD–SD=caberawit, SMP=pra remaja, SMA=remaja,
  Kuliah/Kerja=usia nikah), kelompok_id FK, status
  `pending|approved|rejected`, alasan penolakan (nullable),
  requested_by, decided_by, decided_at, `qr_token` (acak, tidak bisa
  ditebak — diisi saat disetujui), `kode_manual` (pendek, unik).
  Data orang tua: nama, hubungan, no_hp.
- `sessions`: token acak, user_id, expires_at, revoked.
- Semua query pakai parameter/prepared statement. Tanpa tempel string.

### 2. Auth & akun (API JSON)

- `POST /api/login` (email + password), rate limit percobaan gagal
  (kunci sementara), set cookie sesi HttpOnly + SameSite (Secure
  hanya bila HTTPS). `POST /api/logout` (hapus sesi di server).
- `POST /api/users` — HANYA Admin Utama: buat akun (nama, email,
  role, scope). Password awal dibuat server (acak), wajib diganti
  saat login pertama (`must_change_password`, hanya 1 kali ganti
  paksa — setelah itu ganti biasa lewat profil).
- `POST /api/change-password` — cek password lama, hash baru.
- `POST /api/reset-password` — buat token reset (1 jam); karena
  belum ada SMTP, simpan token + tampilkan link reset HANYA di log
  server (jangan di response), dan catat di STATE.md bahwa kirim
  email asli butuh akun SMTP (tahap berikutnya).
- `GET /api/me` — user login + role + scope.
- Cek role + kepemilikan scope di SERVER untuk SETIAP aksi
  (menyembunyikan tombol bukan pengaman). Daerah = lihat semua di
  wilayahnya, TAPI tidak bisa tambah generus. Desa/Kelompok hanya
  wilayahnya sendiri.

### 3. Tambah generus + persetujuan (API JSON)

- `POST /api/generus` — HANYA Kelompok: ajukan generus baru
  (status `pending`, belum bisa absen). Validasi server: nama,
  tanggal_lahir, kelas wajib; orang tua nama+hubungan+no_hp.
- `GET /api/generus` — ikut scope pemohon (kelompok→kelompoknya,
  desa→desanya, daerah/admin→semua). Tampilkan status pengajuan
  ("dalam proses pengajuan" untuk pending).
- `POST /api/generus/:id/approve` dan `/reject` — HANYA Admin Utama,
  dengan catatan (wajib diisi saat reject). Saat approve: isi
  `qr_token` acak + `kode_manual` pendek unik. Pemohon diberi tahu
  lewat field status + catatan (notifikasi email menyusul).
- `POST /api/generus/:id/delete-request` — Kelompok ajukan hapus
  dengan alasan (persetujuan Admin; data + riwayat ikut hilang bila
  disetujui — sesuai PRD). Implementasi minimal: status
  `delete_pending` + approve/reject hapus oleh Admin.
- Pindah kelompok = daftar ulang ke kelompok baru (persetujuan
  seperti awal) — TIDAK perlu endpoint pindah khusus sesi ini.

### 4. Seed & jalan

- Script seed (`server/seed.js` atau sejenis): buat 1 Daerah,
  3 Desa, 1 Kelompok per desa (nama jelas CONTOH), dan 1 akun Admin
  Utama. Password admin dari ENV VAR (bukan di repo); script cetak
  sekali lalu selesai. Data generus KOSONG (pemilik input sendiri).
- `.env.example` diperbarui (DATABASE_URL, PORT, SESSION_SECRET —
  tanpa nilai asli). `.env` tetap di .gitignore.

### 5. Tes (wajib lolos sebelum selesai)

- Script smoke test (node, tanpa dep baru bila bisa): jalankan
  server, lalu cek: login salah → 401; login admin → 200 + cookie;
  kelompok buat akun → 403; admin buat akun kelompok → 201; login
  akun baru → wajib ganti password; kelompok ajukan generus → 201
  pending; admin approve → 200 + qr_token terisi; generus pending
  tidak muncul sebagai anggota aktif; daerah coba tambah generus
  → 403. Tulis hasilnya (PASS/FAIL per cek) di STATE.md.
- `node --check` untuk semua file JS baru.

## Yang TIDAK dikerjakan sesi ini (jangan ditambah)

Login Google, absen offline, link izin, scan QR/absensi, jadwal,
laporan Word, materi/penilaian, kirim WA, PWA. Kalau terpikir
menambahkannya, tulis di STATE.md sebagai "berikutnya", jangan
dibangun sekarang.

## Selesai → tulis STATE.md

Tulis ulang bagian "Status sekarang" + "Yang sudah selesai" di
`STATE.md` (lewat shell): apa yang berubah (file + endpoint),
hasil tes, apa yang belum, langkah berikut. Tanpa rahasia.
Akhiri jawabanmu dengan ringkasan singkat: file berubah, hasil tes,
langkah berikut.
