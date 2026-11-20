# Codex — GENSA MVP Sesi 1, Langkah B: server + auth + API generus

Lanjutan sesi sebelumnya (skema 001_init.sql + seed.js SUDAH ditulis
dan migrasi SUDAH jalan di database asli: 1 daerah, 3 desa,
3 kelompok, 1 admin). Kamu tetap TIDAK bisa membaca/menulis file —
OUTPUT isi file lengkap dalam blok kode berlabel nama file. Saya yang
menulis file-nya dan menjalankan tesnya.

## Keputusan yang sudah ditetapkan (pakai ini, jangan tanya lagi)

- `kode_manual`: 6 karakter, huruf A–Z + angka 2–9 (tanpa 0/O/1/I),
  unik (coba ulang bila bentrok).
- `qr_token`: `crypto.randomBytes(16).toString('hex')` (32 hex).
- Sesi: 12 jam. Token reset password: 1 jam.
- Stack: Node.js 24 stdlib `http` + `pg` + `bcryptjs` saja.
  Tanpa Express, tanpa ORM, tanpa dotenv (baca file `.env` dengan
  parser kecil buatan sendiri, ~10 baris).
- Server: 127.0.0.1, PORT dari env (default 3101).
- `jenjang` adalah kolom GENERATED di database — jangan di-INSERT.
- `updated_at` tidak ada trigger — SET manual di tiap UPDATE generus.
- Login rate limit: maksimal 5 gagal per email per 15 menit
  (in-memory, cukup untuk MVP).
- Cookie sesi: HttpOnly, SameSite=Lax, Path=/, Max-Age 12 jam.
  `Secure` HANYA bila request lewat HTTPS (di dev HTTP jangan
  pakai Secure, nanti cookie tidak tersimpan).

## OUTPUT yang saya minta (4 file, lengkap, siap tulis)

### 1. `server/db.js`
Pool `pg` dari `DATABASE_URL` env. Export `query(text, params)`
dan `getClient()`. Tanpa log kredensial.

### 2. `server/index.js`
Server HTTP + semua route JSON di bawah (satu file, rapikan dengan
fungsi-fungsi kecil; validasi server yang ketat; SEMUA query pakai
parameter; JANGAN pernah kembalikan password_hash ke client;
error jangan bocorkan detail database):

- `GET /` → redirect ke `/login.html`.
- `GET /login.html` + file statis dari `server/public/` (hanya
  file .html/.css/.js, tolak path traversal).
- `POST /api/login` {email, password} → cek user aktif, bandingkan
  bcrypt, rate limit; buat token sesi acak di tabel `sessions`;
  set cookie. Response: {user:{id,email,role, must_change_password}}.
  Bila must_change_password true, client wajib ke ganti password.
- `POST /api/logout` → revoke sesi, hapus cookie.
- `GET /api/me` → user login + role + scope (desa_id/kelompok_id).
- `POST /api/users` (HANYA admin): {email, nama? (tidak ada kolom
  nama — abaikan), role, desa_id, kelompok_id} → password awal acak
  12 karakter (huruf+angka, tanpa karakter ambigu), hash, simpan
  dengan must_change_password=true. Response SEKALI berisi
  password awal itu (admin yang meneruskan ke pengurus lewat email).
  Validasi role↔scope sesuai CHECK di database (desa→desa_id saja,
  kelompok→kelompok_id saja, admin/daerah→tanpa scope). Tolak bila
  email sudah ada (409).
- `POST /api/change-password` (login): {old_password, new_password}
  (minimal 8 karakter) → cek lama, hash baru, set
  must_change_password=false.
- `POST /api/reset-password` {email}: SELALU response sukses sama
  (jangan bocorkan ada/tidak emailnya). Bila email ada: buat token
  acak, simpan di tabel baru? TIDAK ada tabel reset — simpan token
  di `sessions`? Jangan. Buat tabel TIDAK — pakai cara paling
  kecil: simpan token reset + expiry di kolom baru? TIDAK BOLEH
  ubah skema di langkah ini. Solusi: token reset = JWT-like HMAC
  dengan SESSION_SECRET (payload email+expiry, tanpa simpan di DB),
  dan link reset HANYA ditulis ke console server (bukan ke response),
  karena SMTP belum ada. Catat cara ini di ringkasan.
  `POST /api/reset-password/confirm` {token, new_password} →
  verifikasi HMAC + expiry, ganti hash.
- `POST /api/generus` (HANYA kelompok): ajukan generus baru
  {nama, tanggal_lahir, kelas_sekolah, tingkat, ortu_nama,
  ortu_hubungan, ortu_hp} → status `pending`, requested_by = user
  login, kelompok_id = kelompok user. Validasi: semua wajib,
  tanggal_lahir valid dan tidak di masa depan, tingkat salah satu
  dari 6 nilai. Response 201 + data generus (tanpa qr/kode).
- `GET /api/generus` (login): ikut scope — kelompok→kelompoknya,
  desa→semua kelompok di desanya, daerah/admin→semua. Filter
  opsional ?status=. Urut terbaru dulu.
- `POST /api/generus/:id/approve` (HANYA admin): set status
  approved + qr_token + kode_manual + decided_by/at. Tolak bila
  bukan pending (409).
- `POST /api/generus/:id/reject` (HANYA admin): {catatan} wajib
  diisi → status rejected + alasan_penolakan + decided_by/at.
- `POST /api/generus/:id/delete-request` (HANYA kelompok pemilik):
  {alasan} wajib → status delete_pending + alasan_penghapusan.
  `POST /api/generus/:id/delete-approve` (HANYA admin): hapus baris
  generus dari database (data + riwayat ikut hilang, sesuai PRD).
  `POST /api/generus/:id/delete-reject` (HANYA admin): {catatan} →
  kembali ke approved, kosongkan alasan_penghapusan.
- Semua route selain login/reset: wajib cookie sesi valid + user
  aktif, kalau tidak 401. Cek peran + kepemilikan scope di server
  untuk SETIAP aksi (bukan cuma di tampilan).
- JSON body maksimal 100KB, tolak bila lebih. Semua input string
  di-trim; tolak string kosong untuk field wajib.

### 3. `server/public/login.html`
Satu halaman login minimal (palet GENSA: latar #F6F1E9, tombol
#8A5A33, aksen #5F7A57; tanpa gradasi, tanpa latar gelap):
form email + password, kirim fetch ke /api/login, tampilkan pesan
salah yang ramah ("Email atau password salah"), bila
must_change_password → form ganti password (password lama + baru).
Tanpa library luar, tanpa innerHTML dengan data pengguna
(pakai textContent).

### 4. `server/smoke-test.js`
Script Node (pakai fetch bawaan, `node:assert/strict`): menganggap
server SUDAH jalan di http://127.0.0.1:PORT (PORT dari env, default
3101). Admin login pakai env ADMIN_EMAIL + ADMIN_PASSWORD.
Cek berurutan, cetak PASS/FAIL per cek, exit 1 bila ada FAIL:
1. login password salah → 401.
2. login admin benar → 200 + cookie + must_change_password true.
3. tanpa login GET /api/me → 401.
4. admin buat akun kelompok (email unik acak) → 201 + password awal.
5. akun baru login → 200, must_change_password true; ganti password
   → 200; login lagi password baru → 200, must_change_password false.
6. akun kelompok ajukan generus → 201 status pending, tanpa qr_token.
7. kelompok GET /api/generus → hanya lihat kelompoknya.
8. admin approve generus → 200 + qr_token + kode_manual terisi.
9. akun daerah (dibuat admin) coba POST /api/generus → 403.
10. login 5x salah beruntun → kena rate limit (429 atau 401 tetap
    tapi setelah 5x harus 429 — putuskan di kode, tulis di ringkasan).
Isi data generus contoh yang valid (nama, tanggal lahir, kelas,
tingkat sd, ortu). Bersihkan data tes di akhir? TIDAK — biarkan,
tandai email tes dengan domain `@tes.gensa.local` supaya gampang
dihapus manual; tulis itu di ringkasan.

## Format jawaban

Untuk tiap file: satu blok kode dengan label path file di atasnya,
isi file LENGKAP tanpa potongan. Jangan tambah file lain. Akhiri
dengan ringkasan 8 baris: keputusan desain + cara menjalankan
server + cara menjalankan smoke test + yang belum diputuskan.
Bahasa jawaban: Indonesia.
