# Sesi 10 — Link Izin (GENSA, PRD §9) — PROMPT LENGKAP

## CARA KERJA (PENTING — baca dulu, jangan dilewati)

- Kamu TIDAK PERLU membaca file repo — semua konteks yang
  dibutuhkan sudah ada di prompt ini. Kerjakan HANYA dari
  konteks di sini.
- Kamu TIDAK BISA menulis file langsung (lingkungan ini hanya
  baca). Itu NORMAL dan BUKAN halangan — mengeluarkan kode di
  jawaban ADALAH hasil kerja sesi ini.
- Untuk file baru: keluarkan SELURUH isi file dalam satu blok
  kode, dengan nama file di atasnya.
- Untuk edit file lama (`server/index.js`, `jadwal.html`):
  keluarkan blok kode LENGKAP untuk fungsi/bagian yang
  ditambah atau diubah, plus penanda persis di mana
  menyisipkannya (sebut fungsi/baris sebelum dan sesudahnya).
  Muse yang akan menyisipkan kode itu ke repo dan menjalankan
  tes.
- JANGAN minta akses tulis, JANGAN minta dibuka sesi dengan
  akses file, dan JANGAN berhenti karena tidak bisa menulis
  file. Sesi-sesi sebelumnya (S1–S9) semuanya berjalan dengan
  pola yang sama: kode dikeluarkan di jawaban, Muse yang
  menulis dan menguji.
- JANGAN memakai alat akses file apa pun. Jawaban berupa teks
  + blok kode sudah cukup.

Semua konteks yang dibutuhkan ada di file ini. Kerjakan Tugas
1–8 di bawah (tulis kode lengkapnya di jawaban, JANGAN hanya
rencana).

## Konteks

Repo: `~/workspace/gensa-repo`. Server Node.js (stdlib http + `pg`),
port 3101, file `server/index.js` (~2.987 baris). Halaman statis di
`server/public/` (dilayani `serveStatic`, hanya ekstensi .html/.css/
.js/.json/.png). Migrasi di `server/migrations/` (dijalankan berurutan
oleh `node server/migrate.js` dari folder `server/`).

Sesi 1–9 selesai dan lolos smoke test: akun/peran, QR + absensi,
jadwal, laporan Word, scan HP kamera, materi & penilaian, PWA +
reset password, login Google, absen offline.

**Aturan umum (jangan dilanggar):**
- Perubahan terkecil yang lengkap (Ponytail). Jangan tambah fitur di
  luar tugas. Jangan ubah perilaku endpoint lama.
- Jangan masukkan rahasia ke kode/repo.
- Bahasa Indonesia yang natural. Palet GENSA: krem `#F6F1E9`,
  coklat `#8A5A33`, sage `#5F7A57/#7C9A6E`. Tanpa latar gelap, tanpa
  neon. Mobile-first.
- Halaman HTML: pakai `textContent`/`createElement` saja, jangan
  `innerHTML` dengan data dari server.
- Validasi di server, jangan percaya input klien. Semua query pakai
  parameter (`$1`, `$2`), jangan tempel string.
- Semua handler menerima `(req, res, auth)` atau `(res, auth, ...)`
  dengan `auth = { user, token }` — user di `auth.user`, BUKAN
  `auth.role`/`auth.id`. Query DB lewat `db.query` /
  `db.getClient()` — TIDAK ADA variabel `pool`. Error lewat
  `fail(status, 'pesan')` (melempar HttpError) — JANGAN buat fungsi
  `invalid()` sendiri.
- Semua halaman .html memuat `<link rel="manifest"
  href="/manifest.json">` + registrasi service worker seperti halaman
  lain (lihat akhir jadwal.html).

**Aturan dari PRD §9 + jawaban pengguna (jangan dilanggar):**
- Link izin dibuat per kelompok, lalu di-share. Siapa saja yang
  punya link boleh membuka (TANPA login).
- Setelah klik nama, verifikasi dengan scan barcode / isi kode
  (kode manual 6 karakter atau qr_token 32 hex — pola yang sama
  seperti absen di `recordAbsen`).
- Alur pilihan berjenjang: kalau kelompok yang share → nama-nama
  anggota kelompoknya; kalau desa → pilih kelompok dulu, baru pilih
  nama; kalau pengajian daerah → pilih desa, lalu kelompok, baru
  nama.
- Setelah pilih nama: kolom alasan — sakit, atau izin (kalau izin
  HARUS ada alasannya, ditulis).
- Link izin hanya untuk 1 kegiatan yang akan dilaksanakan; tidak
  bisa pilih tanggal / jadwal.
- Izin yang masuk HARUS disetujui pengurus kelompok dulu, baru masuk
  ke absen. Izin+sakit digabung jadi 1 kategori "izin" di laporan %
  (sudah jalan sejak S4 — nilai status di tabel absensi tetap
  'izin' atau 'sakit' apa adanya).

**Desain yang sudah diputuskan (ikuti persis):**
- Setiap pertemuan punya `izin_token` (32 hex acak, UNIQUE,
  nullable untuk pertemuan lama). Token dibuat malas (lazy) saat
  pengurus pertama kali meminta link-nya — JANGAN generate di
  migrasi (tidak ada pgcrypto).
- Link publik: `/izin.html?t=<izin_token>`.
- Tabel baru `izin` menyimpan pengajuan; status menunggu → disetujui
  (masuk absensi) atau ditolak. Alasan 'sakit'/'izin' sama persis
  dengan nilai enum `status_absensi`, jadi saat disetujui langsung
  dipakai sebagai status baris absensi.

## Kontrak helper yang SUDAH ADA di server/index.js (pakai persis, jangan karang yang baru)

- `fail(status, message)` — melempar HttpError.
- `sendJson(res, status, data)` — kirim JSON.
- `readJson(req)` — baca body JSON (gagal → 400).
- `requiredString(value, label, max = 255)` — string wajib tidak kosong.
- `positiveId(value, label = 'ID')` — integer > 0.
- `validPertemuanDate(value)` — tanggal YYYY-MM-DD valid.
- `randomString(alphabet, length)` + `MANUAL_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'` + `crypto.randomBytes(16)
  .toString('hex')` (dipakai di `approveGenerus` untuk qr_token).
- `STATUS_ABSENSI` — Set berisi 'hadir','izin','sakit','alfa'.
- `normalisasiPertemuan(pertemuan)` — ubah `jenjang_target` string
  `'{caberawit}'` dari pg menjadi array. WAJIB dipakai di semua
  respons yang memuat pertemuan.
- `pertemuanScopeWhere(auth)` — WHERE untuk daftar pertemuan ikut
  wilayah (dipakai `listPertemuan`).
- `canManagePertemuan(auth, pertemuan)` — melempar 403 bila user
  bukan pengurus tingkat penyelenggara pertemuan (admin lolos).
  Dipakai SETIAP handler yang mengelola pertemuan.
- `generusInScope(pertemuan, generusId, client = db)` — kembalikan
  baris generus bila approved + jenjang ∈ jenjang_target + dalam
  wilayah pertemuan, else null. SQL-nya (jangan ubah logikanya):
  `g.status = 'approved' AND g.jenjang = ANY($2::jenjang_generus[])
  AND ((tingkat='kelompok' AND g.kelompok_id = $4)
  OR (tingkat='desa' AND k.desa_id = $5) OR tingkat='daerah')`.
- `authenticate(req)` — kembalikan `{ user, token }` atau melempar
  401. `requireRole(user, role)` — melempar 403 bila peran beda.
- Pola tulis absensi (lihat `recordAbsen`/`recordAbsenManual`):
  muat pertemuan (404 bila tidak ada) → `canManagePertemuan` →
  `client = await db.getClient()` → `BEGIN` → `SELECT * FROM
  pertemuan WHERE id = $1 FOR UPDATE` → cek `selesai_pada !== null`
  → `fail(409, 'Pertemuan sudah selesai. Gunakan koreksi.')` →
  kerja → `COMMIT` (catch → `ROLLBACK`, finally →
  `client.release()`).
- Pola verifikasi kode (lihat `recordAbsen`): kode 32 hex
  `[a-fA-F0-9]{32}` → qr_token (lowercase); kode 6 karakter yang
  semuanya ada di MANUAL_ALPHABET → kode_manual; selain itu
  `fail(404, 'Kode tidak ditemukan.')`. Cari generus approved
  dengan `qr_token = $1 OR kode_manual = $2`, lalu
  `generusInScope`. Bila tidak ketemu → 404 'Kode tidak ditemukan.'
  (sengaja 404, jangan bocorkan alasan).
- `checkOrigin(req)` sudah dipanggil `handle()` untuk semua
  non-GET. Routing publik (tanpa login) HARUS ditaruh SEBELUM
  `const auth = await authenticate(req);` di `handle()`. Routing
  ber-auth HARUS setelah gate `must_change_password`.

## Tugas 1 — Migrasi `server/migrations/006_link_izin.sql` (file baru)

```sql
DO $$
BEGIN
  CREATE TYPE status_izin AS ENUM ('menunggu', 'disetujui', 'ditolak');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS izin (
  id SERIAL PRIMARY KEY,
  pertemuan_id INTEGER NOT NULL REFERENCES pertemuan(id),
  generus_id INTEGER NOT NULL REFERENCES generus(id),
  alasan TEXT NOT NULL CHECK (alasan IN ('sakit', 'izin')),
  keterangan TEXT,
  status status_izin NOT NULL DEFAULT 'menunggu',
  diputuskan_oleh INTEGER REFERENCES users(id),
  diputuskan_pada TIMESTAMPTZ,
  catatan_penolakan TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (alasan <> 'izin' OR NULLIF(btrim(keterangan), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS izin_pertemuan_id_idx
  ON izin (pertemuan_id);

CREATE INDEX IF NOT EXISTS izin_generus_id_idx
  ON izin (generus_id);

ALTER TABLE pertemuan
  ADD COLUMN IF NOT EXISTS izin_token TEXT UNIQUE;
```

## Tugas 2 — Endpoint publik GET `/api/izin` (tanpa login)

Fungsi baru `muatIzinPublik(req, res, url)` — letakkan tepat
sebelum `mulaiLoginGoogle`. Routing publik di `handle()`, sebelum
`authenticate` (di samping rute Google):

```js
if (req.method === 'GET' && pathname === '/api/izin') {
  await muatIzinPublik(req, res, url);
  return;
}
```

Perilaku:
1. `t = url.searchParams.get('t')` — harus string 32 hex
   (regex `/^[a-fA-F0-9]{32}$/`), kalau tidak → `fail(404,
   'Tautan izin tidak ditemukan.')`.
2. Cari pertemuan dengan `izin_token = t` (lowercase). Tidak ada →
   404 yang sama. (Jangan bedakan "token salah" vs "pertemuan
   tidak ada".)
3. Respons: `{ pertemuan: { id, tanggal, tingkat },
   desa: [...], kelompok: [...], generus: [...] }` — hanya SATU
   dari tiga daftar yang terisi sesuai langkah berjenjang; dua
   lainnya array kosong. Semua daftar diurut nama (lalu id).
   - `desa`: `[{ id, nama }]` — SEMUA desa (hanya bila tingkat
     daerah dan `desa_id` belum dipilih).
   - `kelompok`: `[{ id, nama }]` — kelompok di desa yang dipilih
     (tingkat desa: desa pertemuan; tingkat daerah: `desa_id`
     dari query, harus ada dan valid).
   - `generus`: `[{ id, nama, kelas_sekolah }]` — generus
     approved yang masuk lingkup + jenjang pertemuan (logika
     SAMA seperti `generusInScope` tanpa filter id; pakai query
     sendiri, JANGAN panggil `generusInScope` per generus).
     **JANGAN sertakan `kode_manual`/`qr_token` di respons ini.**
4. Query `desa_id`/`kelompok_id` (bila ada) harus integer > 0,
   kalau tidak → 400. Bila `desa_id` tidak cocok dengan lingkup
   pertemuan (desa pertemuan / desa tidak ada) → 404. Bila
   `kelompok_id` tidak ada di desa yang benar → 404.
5. Aturan berjenjang:
   - tingkat 'kelompok' → langsung `generus` (abaikan
     desa_id/kelompok_id bila dikirim).
   - tingkat 'desa' → tanpa `kelompok_id`: `kelompok` di desa
     pertemuan. Dengan `kelompok_id`: `generus` kelompok itu.
   - tingkat 'daerah' → tanpa `desa_id`: `desa`. Dengan
     `desa_id` tanpa `kelompok_id`: `kelompok` di desa itu.
     Dengan keduanya: `generus` kelompok itu.

## Tugas 3 — Endpoint publik POST `/api/izin` (tanpa login)

Fungsi baru `kirimIzin(req, res, url)` — letakkan tepat setelah
`muatIzinPublik`. Routing publik di `handle()` (samping GET):

```js
if (req.method === 'POST' && pathname === '/api/izin') {
  await kirimIzin(req, res, url);
  return;
}
```

Perilaku:
1. Token `t` dari query — validasi SAMA seperti Tugas 2 (32 hex,
   pertemuan ada, else 404 'Tautan izin tidak ditemukan.').
2. Bila `pertemuan.selesai_pada !== null` → `fail(409, 'Kegiatan
   sudah selesai.')`.
3. Baca body: `{ generus_id, kode, alasan, keterangan }`.
   - `generus_id` = `positiveId(body.generus_id, 'Generus')`.
   - `alasan` harus 'sakit' atau 'izin', else 400 'Alasan harus
     sakit atau izin.'
   - `keterangan`: bila alasan 'izin' → wajib
     `requiredString(body.keterangan, 'Alasan izin', 500)`;
     bila 'sakit' → boleh kosong/null (simpan null bila kosong).
   - `kode` harus string; pola verifikasi SAMA seperti
     `recordAbsen` (32 hex → qr_token, 6 karakter alfabet
     manual → kode_manual, else 404 'Kode tidak ditemukan.').
4. Cari generus approved dari kode, lalu `generusInScope
   (pertemuan, generus.id)` — tidak ketemu → 404 'Kode tidak
   ditemukan.'
5. Cek duplikat: bila sudah ada baris `izin` untuk
   (pertemuan_id, generus_id) dengan status 'menunggu' ATAU
   'disetujui' → `fail(409, 'Izin sudah diajukan untuk kegiatan
   ini.')`. Yang 'ditolak' boleh ajukan ulang.
6. INSERT izin (status 'menunggu'), kembalikan 201
   `{ izin: { id, pertemuan_id, generus_id, alasan, keterangan,
   status, created_at } }`.

## Tugas 4 — Endpoint kelola izin (butuh login + canManagePertemuan)

Tiga fungsi baru — letakkan setelah `selesaiPertemuan` (sebelum
`koreksiAbsensi`):

### 4a. `linkIzin(res, auth, id)` — GET `/api/pertemuan/:id/link-izin`

- Muat pertemuan (404 bila tidak ada), `canManagePertemuan`.
- Bila `pertemuan.izin_token` null: buat token baru
  `crypto.randomBytes(16).toString('hex')`, UPDATE (coba sampai
  10x bila kena 23505, pola yang sama seperti `approveGenerus`).
- Kembalikan `{ url: '/izin.html?t=' + token }` (path relatif;
  halaman yang melengkapinya dengan `location.origin`).

### 4b. `listIzin(res, auth, id)` — GET `/api/pertemuan/:id/izin`

- Muat pertemuan (404 bila tidak ada), `canManagePertemuan`.
- Kembalikan `{ izin: [...] }` — JOIN generus untuk `nama` dan
  `kelas_sekolah`, urut `created_at`, `id`. Kolom: id,
  pertemuan_id, generus_id, nama, kelas_sekolah, alasan,
  keterangan, status, catatan_penolakan, created_at,
  diputuskan_pada.

### 4c. `setujuiIzin(req, res, auth, pertemuanId, izinId)` — POST `/api/pertemuan/:id/izin/:izinId/setujui`

### 4d. `tolakIzin(req, res, auth, pertemuanId, izinId)` — POST `/api/pertemuan/:id/izin/:izinId/tolak`

Keduanya pakai pola transaksi + FOR UPDATE pertemuan (lihat
Kontrak di atas). Perilaku:
- Muat pertemuan (404), `canManagePertemuan`, bila
  `selesai_pada !== null` → 409 'Pertemuan sudah selesai.
  Gunakan koreksi.'
- Muat izin (404 bila tidak ada / bukan milik pertemuan ini);
  bila `izin.status !== 'menunggu'` → 409 'Izin sudah diputuskan.'
- Setujui: INSERT absensi (pertemuan_id, generus_id,
  status = izin.alasan, dicatat_oleh = auth.user.id) `ON
  CONFLICT (pertemuan_id, generus_id) DO UPDATE SET status =
  EXCLUDED.status, dicatat_oleh = EXCLUDED.dicatat_oleh,
  updated_at = now()`; lalu UPDATE izin SET status =
  'disetujui', diputuskan_oleh, diputuskan_pada = now().
  Kembalikan `{ izin, absensi }`.
- Tolak: body `{ catatan }` — opsional; bila ada harus string
  maks 500 (simpan null bila kosong). UPDATE izin SET status =
  'ditolak', catatan_penolakan, diputuskan_oleh, diputuskan_pada
  = now(). Kembalikan `{ izin }`.
- `updated_at` di-SET manual (`updated_at = now()`) di tiap
  UPDATE — tidak ada trigger (lihat catatan Sesi 1).

Routing (di `handle()`, setelah rute koreksi, sebelum rute
qrMatch):

```js
const linkIzinMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)\/link-izin$/);
if (req.method === 'GET' && linkIzinMatch) {
  await linkIzin(res, auth, positiveId(linkIzinMatch[1]));
  return;
}

const listIzinMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)\/izin$/);
if (req.method === 'GET' && listIzinMatch) {
  await listIzin(res, auth, positiveId(listIzinMatch[1]));
  return;
}

const putusIzinMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)\/izin\/([1-9]\d*)\/(setujui|tolak)$/);
if (req.method === 'POST' && putusIzinMatch) {
  const pid = positiveId(putusIzinMatch[1]);
  const zid = positiveId(putusIzinMatch[2]);
  if (putusIzinMatch[3] === 'setujui') await setujuiIzin(req, res, auth, pid, zid);
  else await tolakIzin(req, res, auth, pid, zid);
  return;
}
```

## Tugas 5 — Halaman publik `server/public/izin.html` (file baru)

Satu layar, satu tugas: kirim izin untuk 1 kegiatan. Tanpa login.
Ikuti gaya jadwal.html (CSS sama: `:root` krem/coklat/sage,
`main` max-width 850px, tombol coklat/sage, `min-height: 44px`,
`textContent` saja, pesan di satu tempat).

Alur (langkah bertahap, satu form):
1. Baca `?t=` dari URL. Bila tidak ada → tampilkan pesan
   'Tautan izin tidak valid.' dan berhenti.
2. `GET /api/izin?t=...` → tampilkan info kegiatan: tanggal
   (format Indonesia, contoh: 'Sabtu, 21 November 2026') dan
   tingkat ('Kelompok'/'Desa'/'Daerah'). Bila 404 → 'Tautan izin
   tidak ditemukan atau kegiatan sudah selesai.'
3. Pilih berjenjang (select, satu muncul setelah yang
   sebelumnya dipilih):
   - tingkat daerah: select Desa → select Kelompok → select
     Nama generus.
   - tingkat desa: select Kelompok → select Nama generus.
   - tingkat kelompok: langsung select Nama generus.
   Setiap select memuat nama saja (id tersembunyi di value).
   Muat ulang daftar lewat GET /api/izin dengan query yang
   sesuai (`desa_id`, `kelompok_id`).
4. Setelah nama dipilih: radio alasan Sakit / Izin. Bila Izin,
   tampilkan textarea keterangan (wajib diisi). Bila Sakit,
   keterangan opsional.
5. Input kode: text input 'Kode manual / kode QR' + tombol
   'Scan barcode' (opsional tapi diminta PRD): buka kamera
   belakang dengan getUserMedia (pola yang sama seperti
   scan.html — `facingMode: 'environment'`, canvas + `jsQR`
   dari `/jsQR.js`, hentikan kamera setelah kode terbaca),
   isi input kode otomatis. Bila kamera tidak tersedia/bukan
   konteks aman → sembunyikan tombol scan, input manual tetap
   jalan (beri pesan singkat).
6. Tombol 'Kirim izin' → POST /api/izin?t=... dengan
   `{ generus_id, kode, alasan, keterangan }`. Sukses → ganti
   form dengan pesan 'Izin terkirim. Menunggu persetujuan
   pengurus kelompok.' Gagal → tampilkan pesan error server
   (dari respons JSON) di tempat yang sama.
7. Muat manifest + registrasi service worker seperti halaman
   lain. JANGAN pakai `innerHTML` dengan data server.
   JANGAN tampilkan kode_manual/qr_token di halaman ini
   (daftar nama saja).

## Tugas 6 — Halaman kelola + tombol di jadwal.html

### 6a. `server/public/izin-kelola.html` (file baru, butuh login)

- Baca `?pertemuan=<id>` dari URL (bila tidak ada → pesan
  'Buka halaman ini dari jadwal.').
- `GET /api/me` (bila 401 → arahkan ke /login.html).
- Muat `GET /api/pertemuan/:id/link-izin` → tampilkan link
  lengkap (`location.origin + url`) di input readonly + tombol
  'Salin link' (navigator.clipboard, fallback select+copy).
- Muat `GET /api/pertemuan/:id/izin` → daftar pengajuan:
  nama generus, kelas, alasan (Sakit/Izin), keterangan,
  status (Menunggu/Disetujui/Ditolak), tanggal kirim. Yang
  menunggu: tombol 'Setujui' dan 'Tolak' (tolak minta catatan
  lewat `prompt()` — boleh kosong). Setelah putusan, muat
  ulang daftar. Pesan sukses/gagal jelas di satu tempat.
- Bila kosong: 'Belum ada pengajuan izin untuk kegiatan ini.'
- Gaya dan pola sama seperti jadwal.html (textContent saja,
  manifest + SW).

### 6b. Tombol di `server/public/jadwal.html` (ubah, jangan tulis ulang)

Di `tampilkanDaftar()`, di dalam `if (bolehKelola(item))`,
setelah tombol Ubah/Hapus, tambahkan (hanya bila
`item.selesai_pada === null`):
- Tombol 'Salin link izin' (class secondary): klik →
  `GET /api/pertemuan/${item.id}/link-izin` → salin
  `location.origin + data.url` ke clipboard → pesan 'Link
  izin disalin.'
- Tombol 'Kelola izin' (class secondary): klik → pindah ke
  `/izin-kelola.html?pertemuan=${item.id}`.
- Pakai helper yang sudah ada di file itu (`buatElemen`,
  `api`, `beriPesan`). Jangan ubah logika lain di file ini.

## Tugas 7 — Smoke test `server/smoke-test-s10.js` (file baru)

Ikuti POLA smoke-test-s9.js persis (jangan karang harness
baru): `loadEnv()` dari `.env`, `PORT` dari env (default
3101), `BASE = http://127.0.0.1:PORT`, helper `request()`
(fetch, `redirect: 'manual'`, kembalikan `{ status, data,
text, cookie }`), `assert`, `crypto.randomBytes(8)
.toString('hex')` sebagai suffix isolasi. Server dijalankan
MANUAL oleh Muse (`node server/index.js` di background,
lalu `node server/smoke-test-s10.js`), bukan dari dalam tes.

Setup (di dalam tes, isolasi penuh — JANGAN pakai data tes
sesi lain):
- Login admin (email/password dari env: ADMIN_EMAIL,
  ADMIN_PASSWORD — JANGAN hardcode nilai).
- Buat akun kelompok baru "Kelompok S10 <suffix>" (via
  POST /api/users sebagai admin — lihat pola s9/s2) +
  akun desa "Desa S10" bila perlu untuk uji berjenjang desa.
- Buat 3 generus (A, B, C) lewat pengajuan kelompok +
  approve admin (ambil `kode_manual` + `qr_token` dari
  respons approve — jangan ditebak).
- Buat pertemuan kelompok (tanggal besok, jenjang
  caberawit — sesuaikan dengan tingkat generus tes; generus
  tes pakai `tingkat: 'sd'` supaya jenjang caberawit) +
  pertemuan desa (jenjang caberawit) untuk uji berjenjang.
- Ambil token izin pertemuan kelompok via
  GET /api/pertemuan/:id/link-izin sebagai pengurus kelompok.
  (Bila endpoint ini belum ada, tes gagal — itu benar.)

Pemeriksaan (minimal 12, semua harus lulus):
1. GET /api/izin tanpa `t` → 404.
2. GET /api/izin?t=token-salah (32 hex acak) → 404.
3. GET /api/izin?t=token-benar (pertemuan kelompok) →
   200, `pertemuan.tanggal` benar, `generus` berisi 3 nama,
   dan TIDAK ADA `kode_manual`/`qr_token` di respons
   (cek `JSON.stringify(data)` tidak mengandung kode A).
4. GET /api/izin?t=token-desa (pertemuan desa) → 200,
   `kelompok` terisi (bukan generus); lalu dengan
   `&kelompok_id=<id>` → `generus` terisi.
5. POST /api/izin (token benar, generus A, kode salah) → 404.
6. POST /api/izin (generus A, kode benar, alasan 'sakit')
   → 201, status 'menunggu'.
7. POST /api/izin lagi (generus A) → 409 (duplikat).
8. POST /api/izin (generus B, alasan 'izin', keterangan
   kosong) → 400. Lalu dengan keterangan 'Ada keperluan
   keluarga' → 201.
9. GET /api/pertemuan/:id/izin sebagai pengurus kelompok →
   200, 2 pengajuan menunggu.
10. POST .../izin/:id/setujui (izin A) → 200; lalu
    GET /api/pertemuan/:id/absensi → ada baris generus A
    status 'sakit'.
11. POST .../izin/:id/tolak (izin B, catatan 'Bukti tidak
    jelas') → 200, status 'ditolak'.
12. POST setujui lagi pada izin yang sudah diputuskan → 409.
13. Selesaikan pertemuan (POST .../selesai), lalu POST
    /api/izin baru (generus C) → 409.
14. Halaman `izin.html` memuat (GET /izin.html → 200,
    berisi 'Kirim izin' dan 'Scan barcode'); `jadwal.html`
    berisi 'Salin link izin'; `izin-kelola.html` memuat
    (GET → 200).
15. GET /api/pertemuan/:id/link-izin sebagai kelompok LAIN
    → 403/404 (tidak boleh ambil link pertemuan orang lain).

Setelah tes S10 lulus, JALANKAN JUGA smoke-test.js (S1),
smoke-test-s3.js, smoke-test-s4.js, smoke-test-s5.js,
smoke-test-s6.js, smoke-test-s7.js, smoke-test-s8.js,
smoke-test-s9.js — semuanya harus tetap lulus (tidak ada
regresi). CATATAN: smoke-test-s2.js SUDAH DIKETAHUI gagal 2
pemeriksaan pada putaran ulang karena data tes lama di
Kelompok B (didokumentasi sejak S2) — itu BUKAN regresi;
jangan perbaiki S2 di sesi ini.

Setelah semua tes lulus, kembalikan flag
`must_change_password` akun admin ke `true` (UPDATE users
SET must_change_password = true WHERE email =
'admin@gensa.local') — seperti sesi-sesi sebelumnya.

## Larangan

- Jangan ubah endpoint lama (login, generus, pertemuan,
  absensi, sync, laporan, materi, Google) kecuali menambah
  rute baru di `handle()` dan kolom baru di migrasi.
- Jangan simpan token izin di localStorage/cookie klien —
  token hanya ada di URL link yang dibagikan pengurus.
- Jangan tampilkan `kode_manual`/`qr_token` ke publik
  (endpoint /api/izin maupun izin.html).
- Jangan buat dependensi baru. `jsQR.js` sudah ada di
  `server/public/jsQR.js` — pakai itu untuk scan barcode.
- Jangan tulis password/kunci apa pun di kode, tes, atau
  STATE.md. Kredensial tes dibaca dari `.env` / environment.
