# Sesi 8 — Login Google (GENSA, PRD §2 & §9, jawaban Codex no. 9)

## Konteks

Repo: `~/workspace/gensa-repo`. Server Node.js (stdlib http + `pg`,
Node 24 — `fetch` global tersedia), port 3101, file
`server/index.js` (2.502 baris). Halaman statis di `server/public/`.

Sesi 1–7 selesai dan lolos smoke test (akun/peran, QR + absensi,
jadwal, laporan Word, scan HP kamera, materi & penilaian, PWA +
reset password).

**Aturan dari PRD (jangan dilanggar):** login Google adalah TAMBAHAN,
bukan pengganti login email/password. HANYA email yang sudah
didaftarkan Admin yang boleh masuk via Google. Kalau email Google
belum terdaftar di sistem, tolak. Generus tidak punya akun.

**Kredensial Google BELUM ADA.** Client ID dan client secret didapat
pemilik dari Google Cloud Console nanti. Kode HARUS membaca dari
environment variable; JANGAN tulis nilai asli apa pun ke kode atau
`.env.example` (cukup placeholder kosong + komentar).

Aturan: perubahan terkecil yang lengkap. Jangan masukkan rahasia ke
kode. Bahasa Indonesia yang natural. Palet GENSA: krem `#F6F1E9`,
coklat `#8A5A33`, sage `#5F7A57/#7C9A6E`. Halaman HTML: pakai
`textContent`/`createElement` saja, jangan `innerHTML` dengan data
dari server. Validasi di server, jangan percaya input klien. Semua
query pakai parameter (`$1`, `$2`), jangan tempel string.

## Tugas 1 — Migrasi `server/migrations/004_google_login.sql` (file baru)

Satu perubahan saja (ikuti gaya `002_pertemuan_absensi.sql` —
`CREATE TYPE` dibungkus `DO $$ ... EXCEPTION WHEN duplicate_object`):

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT UNIQUE;
```

Tidak ada perubahan lain. Jangan sentuh tabel lain.

## Tugas 2 — Konfigurasi di `server/index.js`

Di dekat konstanta lain (`SESSION_SECRET`, `PORT`):

```js
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ||
  `http://127.0.0.1:${PORT}/api/auth/google/callback`;
```

Tambah ke `.env.example` (placeholder kosong, jangan nilai asli):

```
# Login Google (opsional — isi dari Google Cloud Console, OAuth client web).
# Tanpa ini, tombol login Google menampilkan "belum dikonfigurasi".
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://127.0.0.1:3101/api/auth/google/callback
```

## Tugas 3 — Helper state + sesi Google di `server/index.js`

Letakkan di dekat `resetSignature` / `passwordFingerprint`
(sekitar baris 479–492). Pakai ulang `resetSignature(payload)`
(HMAC-SHA256 dengan `SESSION_SECRET`, sudah ada) untuk
menandatangani state — JANGAN buat helper HMAC baru.

- `buatStateGoogle()`: payload = base64url dari JSON
  `{ nonce: crypto.randomBytes(16).toString('hex'), exp:
  Math.floor(Date.now() / 1000) + 600 }` (berlaku 10 menit);
  kembalikan string `${payload}.${resetSignature(payload).toString('base64url')}`.
- `periksaStateGoogle(value)`: pakai `requiredString(value, 'State', 2048)`;
  pecah jadi 2 bagian base64url; verifikasi tanda tangan dengan
  `crypto.timingSafeEqual` terhadap `resetSignature(payload)`;
  parse JSON payload; tolak (fail 403, 'Tautan login sudah tidak
  berlaku.') bila tanda tangan salah, `exp` lewat, atau `nonce`
  kosong. Kembalikan payload yang sudah diperiksa.

## Tugas 4 — Dua handler baru di `server/index.js`

### `async function mulaiLoginGoogle(req, res)`

- Bila `GOOGLE_CLIENT_ID` atau `GOOGLE_CLIENT_SECRET` kosong:
  `fail(503, 'Login Google belum dikonfigurasi. Minta Admin mengaturnya.')`.
- Buat state via `buatStateGoogle()`, lalu redirect 302 ke
  `https://accounts.google.com/o/oauth2/v2/auth` dengan query:
  `client_id`, `redirect_uri` (= `GOOGLE_REDIRECT_URI`),
  `response_type=code`, `scope=openid email profile`,
  `state`, `prompt=select_account`. Bangun URL dengan `new URL`
  + `searchParams` (jangan tempel string manual).

### `async function callbackLoginGoogle(req, res, url)`

Alur, berurutan, gagal di langkah mana pun → redirect 302 ke
`/login.html?google=<kode>` (bukan halaman error mentah). Kode:
`tautan-kadaluarsa` (state tidak valid), `gagal` (tukar kode /
verifikasi token gagal, termasuk error jaringan), `belum-terdaftar`
(email tidak ada / tidak aktif / sudah terikat akun Google lain).

1. Ambil `code` dan `state` dari `url.searchParams`. Bila kosong →
   redirect `?google=tautan-kadaluarsa`.
2. `periksaStateGoogle(state)` — bila melempar HttpError, tangkap
   dan redirect `?google=tautan-kadaluarsa` (jangan teruskan
   sebagai 403 JSON; ini rute browser).
3. Tukar kode: `fetch('https://oauth2.googleapis.com/token', {
   method: 'POST', headers: { 'Content-Type':
   'application/x-www-form-urlencoded' }, body: new URLSearchParams({
   code, client_id: GOOGLE_CLIENT_ID, client_secret:
   GOOGLE_CLIENT_SECRET, redirect_uri: GOOGLE_REDIRECT_URI,
   grant_type: 'authorization_code' }) })`. Bila respons tidak OK
   atau tidak ada `id_token` → redirect `?google=gagal`.
   Bungkus `fetch` dalam try/catch — error jaringan juga
   `?google=gagal`.
4. Verifikasi ID token: `fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken))`.
   Bila tidak OK → `?google=gagal`. Dari JSON-nya, cek:
   `aud` HARUS sama dengan `GOOGLE_CLIENT_ID`,
   `email_verified` HARUS `'true'`, `exp` (detik) HARUS lebih besar
   dari `Date.now() / 1000`, `iss` HARUS salah satu dari
   `https://accounts.google.com` atau `accounts.google.com`.
   Ambil `email` dan `sub`. Bila ada yang tidak lolos →
   `?google=gagal`.
5. Cari pengguna: `SELECT id, email, password_hash, role, desa_id,
   kelompok_id, must_change_password, active, google_sub FROM users
   WHERE lower(email) = $1` dengan email dari token (pakai
   `normalizedEmail` — sudah ada). Bila tidak ada baris atau
   `active` false → redirect `?google=belum-terdaftar`.
6. Ikat `google_sub`: bila `google_sub` NULL → `UPDATE users SET
   google_sub = $1 WHERE id = $2`. Bila sudah terisi dan TIDAK
   sama dengan `sub` dari token → redirect
   `?google=belum-terdaftar` (akun ini sudah terikat akun Google
   lain — jangan bocorkan detailnya).
7. Buat sesi persis seperti `login` (sekitar baris 350–372):
   `token = crypto.randomBytes(32).toString('hex')`, lalu
   `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1,
   $2, now() + ($3 * interval '1 second'))` dengan `SESSION_SECONDS`.
   Set cookie dengan `sessionCookie(token, Boolean(req.socket.encrypted))`
   (sudah ada). Redirect 302 ke `/jadwal.html`.
   (Catatan: gerbang `must_change_password` di `handle()` tetap
   berlaku sesudahnya — pengguna yang wajib ganti password tetap
   harus ganti dulu, sama seperti login biasa.)

## Tugas 5 — Routing di `handle()` (`server/index.js`)

Tambahkan SEBELUM baris `const auth = await authenticate(req);`
(seperti `/api/login` dan `/api/reset-password` — rute ini publik):

```js
if (req.method === 'GET' && pathname === '/api/auth/google') {
  await mulaiLoginGoogle(req, res);
  return;
}

if (req.method === 'GET' && pathname === '/api/auth/google/callback') {
  await callbackLoginGoogle(req, res, url);
  return;
}
```

Jangan ubah routing lain.

## Tugas 6 — Tombol di `server/public/login.html`

Baca dulu file `login.html` dan ikuti gaya + strukturnya.

- Di bawah tombol masuk (di dalam/di bawah form login), tambahkan
  tautan/tombol "Masuk dengan Google" yang mengarah ke
  `/api/auth/google`.
- Baca query `google` dari `location.search`; bila ada, tampilkan
  pesan lewat `textContent` pada elemen `role="status"`:
  - `tautan-kadaluarsa` → "Tautan login sudah tidak berlaku. Coba lagi."
  - `gagal` → "Login Google gagal. Coba lagi atau masuk dengan email dan password."
  - `belum-terdaftar` → "Email Google ini belum terdaftar. Minta Admin mendaftarkan email Anda."
- Jangan ubah logika login email/password yang sudah ada.

## Yang TIDAK dikerjakan di sesi ini

- Jangan buat smoke test — ditulis Muse setelah ini.
- Jangan sentuh absen offline atau link izin.
- Jangan ubah endpoint login, reset password, atau logika sesi
  yang sudah ada.
- Jangan tambah dependensi baru (pakai `fetch` bawaan Node 24
  dan `crypto` yang sudah ada).

## Kutipan kode yang sudah ada

`login` — pembuatan sesi (sekitar baris 350–372):

```js
const token = crypto.randomBytes(32).toString('hex');
await db.query(
  `INSERT INTO sessions (token, user_id, expires_at)
   VALUES ($1, $2, now() + ($3 * interval '1 second'))`,
  [token, user.id, SESSION_SECONDS]
);
```

`resetSignature` (sekitar baris 479–492):

```js
function resetSignature(payload) {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest();
}
```

## Format keluaran

Jawab HANYA dengan blok kode, satu blok per file/penyisipan,
dengan judul file dan penanda sisip yang persis:

**`server/migrations/004_google_login.sql`** (file lengkap)

```sql
...file...
```

**`server/index.js` — konstanta Google (di dekat SESSION_SECRET)**

```js
...baris...
```

**`server/index.js` — helper state Google (di dekat resetSignature)**

```js
...fungsi...
```

**`server/index.js` — handler mulaiLoginGoogle + callbackLoginGoogle (sebelum handle)**

```js
...fungsi...
```

**`server/index.js` — routing di handle(), sebelum `const auth = await authenticate(req);`**

```js
...baris...
```

**`.env.example` — tiga baris Google**

```
...baris...
```

**`server/public/login.html` — tombol Google + pesan error (sebut penanda sisipnya)**

```html
...tambahan...
```

Jangan sertakan penjelasan panjang di luar blok kode. Jangan
menjalankan tes atau mengakses file — Muse yang menulis file
dan menjalankan tes.
