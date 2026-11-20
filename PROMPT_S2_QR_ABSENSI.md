# Codex — GENSA MVP Sesi 2: QR + Absensi

Lanjutan Sesi 1 (backend fondasi + auth + API generus SUDAH jalan,
smoke test 11/11 lulus). Kamu tetap TIDAK bisa membaca/menulis file —
OUTPUT isi file lengkap dalam blok kode berlabel nama file. Saya yang
menulis file-nya dan menjalankan migrasi + tesnya. Jangan tanya hal
yang sudah diputuskan di bawah.

## Keputusan yang sudah ditetapkan (pakai ini, jangan tanya lagi)

- Stack: Node.js 24 stdlib `http` + `pg` + `bcryptjs` + `qrcode`
  (SUDAH terpasang, versi ^1.5.4 — pakai `require('qrcode')` untuk
  membuat SVG QR). Tanpa Express, tanpa ORM.
- `qr_token` (32 hex) dan `kode_manual` (6 karakter, alfabet
  A–Z + 2–9 tanpa 0/O/1/I) SUDAH ada di tabel `generus` sejak Sesi 1,
  diisi saat admin approve. QR TIDAK berubah; kalau hilang, cetak
  ulang yang sama dari aplikasi.
- QR mengkodekan `qr_token` (string saja, bukan URL).
- Scan kamera HP (getUserMedia/jsQR) TIDAK dibuat di sesi ini.
  Endpoint absen menerima kode yang diketik/ditempel: `kode_manual`
  (6 karakter) ATAU `qr_token` (32 hex). Itu yang dimaksud "scan"
  di MVP ini — pembaca QR menempelkan token ke input yang sama.
- JANGAN bangun: link izin, absen offline, login Google, jadwal
  (Sesi 3), laporan Word (Sesi 4), materi/penilaian.
- Pertemuan (satu pengajian) dibuat manual 1 per 1, tanpa jadwal
  berulang (sesuai PRD). Sesi 3 nanti menambahkan penjadwalan di
  atas tabel yang sama.
- `updated_at` tidak ada trigger — SET manual di tiap UPDATE.
- Semua query pakai parameter. Cek peran + kepemilikan scope di
  server untuk SETIAP aksi. Jangan kembalikan password_hash.
  Error jangan bocorkan detail database. Ikuti skill keamanan:
  validasi server, tanpa innerHTML dengan data pengguna
  (pakai textContent), tanpa rahasia di kode/repo.

## Skema yang sudah ada (Sesi 1, migrasi 001_init.sql)

- `daerah(id, nama)`, `desa(id, daerah_id, nama)`,
  `kelompok(id, desa_id, nama)`.
- `users(id, email, password_hash, role, desa_id, kelompok_id,
  must_change_password, active)`; role enum admin/daerah/desa/
  kelompok; CHECK role↔scope (admin/daerah tanpa scope,
  desa→desa_id saja, kelompok→kelompok_id saja).
- `generus(id, kelompok_id, nama, tanggal_lahir, kelas_sekolah,
  tingkat, jenjang GENERATED dari tingkat, ortu_nama, ortu_hubungan,
  ortu_hp, status, alasan_penolakan, alasan_penghapusan,
  requested_by, decided_by, decided_at, qr_token UNIQUE,
  kode_manual UNIQUE, created_at, updated_at)`;
  status enum pending/approved/rejected/delete_pending;
  approved/delete_pending wajib punya qr_token + kode_manual.
- `sessions(token, user_id, expires_at, revoked, created_at)`.
- Helper di `server/index.js` (sudah ada, pakai lagi): `db.query`,
  `db.getClient`, `fail(status, msg)`, `sendJson`,
  `requiredString`, `normalizedEmail`, `positiveId`, `optionalId`,
  `validDate`, `readJson` (JSON max 100KB), `randomString`,
  `authenticate(req)` (cookie sesi → user + token),
  `requireRole(user, role)`, `publicUser(user)`.
  Auth: cookie HttpOnly SameSite=Lax. Akun `must_change_password`
  hanya bisa /api/me, logout, ganti password (sudah dicek di
  handle() sebelum route lain).

## OUTPUT yang saya minta

### 1. `server/migrations/002_pertemuan_absensi.sql` (file baru, lengkap)

- Enum baru `status_absensi` ('hadir', 'izin', 'sakit', 'alfa'),
  dibuat dengan blok DO $$ ... EXCEPTION WHEN duplicate_object
  seperti migrasi 001 (supaya bisa dijalankan ulang).
- Tabel `pertemuan`:
  `id SERIAL PRIMARY KEY`,
  `tingkat TEXT NOT NULL CHECK (tingkat IN ('kelompok','desa','daerah'))`,
  `kelompok_id INTEGER REFERENCES kelompok(id)`,
  `desa_id INTEGER REFERENCES desa(id)`,
  `jenjang_target jenjang_generus[] NOT NULL CHECK (cardinality(jenjang_target) >= 1)`,
  `tanggal DATE NOT NULL`,
  `dibuat_oleh INTEGER NOT NULL REFERENCES users(id)`,
  `selesai_pada TIMESTAMPTZ`,
  `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
  `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
  CHECK scope sesuai tingkat: kelompok→kelompok_id terisi dan
  desa_id NULL; desa→desa_id terisi dan kelompok_id NULL;
  daerah→keduanya NULL.
- Tabel `absensi`:
  `id SERIAL PRIMARY KEY`,
  `pertemuan_id INTEGER NOT NULL REFERENCES pertemuan(id)`,
  `generus_id INTEGER NOT NULL REFERENCES generus(id)`,
  `status status_absensi NOT NULL`,
  `dicatat_oleh INTEGER NOT NULL REFERENCES users(id)`,
  `koreksi_count INTEGER NOT NULL DEFAULT 0 CHECK (koreksi_count >= 0)`,
  `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
  `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
  `UNIQUE (pertemuan_id, generus_id)` (cegah double: 1 generus
  1 kali per pertemuan).
- Indeks: `absensi(pertemuan_id)`, `absensi(generus_id)`,
  `pertemuan(tanggal)`.

### 2. Patch untuk `server/index.js` (UNIFIED DIFF, jangan output seluruh file)

Tambahkan ke file yang SUDAH ADA. Pakai potongan kode di bawah ini
sebagai jangkar (disalin persis dari file saat ini) — diff harus
cocok dengan jangkar ini:

Jangkar A (baris require di atas file):
```
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
```
Tambahkan di bawahnya: `const QRCode = require('qrcode');`

Jangkar B (blok konstanta):
```
const ROLES = new Set(['admin', 'daerah', 'desa', 'kelompok']);
const TINGKAT = new Set(['paud', 'sd', 'smp', 'sma', 'kuliah', 'kerja']);
const STATUSES = new Set(['pending', 'approved', 'rejected', 'delete_pending']);
```
Tambahkan di bawahnya:
```
const JENJANG = new Set(['caberawit', 'pra_remaja', 'remaja', 'usia_nikah']);
const STATUS_ABSENSI = new Set(['hadir', 'izin', 'sakit', 'alfa']);
const TINGKAT_PERTEMUAN = new Set(['kelompok', 'desa', 'daerah']);
```

Jangkar C (akhir fungsi rejectDelete, sebelum serveStatic):
```
  if (result.rowCount !== 1) {
    fail(409, 'Pengajuan penghapusan tidak ditemukan.');
  }
  sendJson(res, 200, { generus: result.rows[0] });
}

async function serveStatic(req, res, pathname) {
```
Sisipkan fungsi-fungsi baru DI ANTARA `}` penutup rejectDelete dan
`async function serveStatic` (fungsi lengkap, gaya sama seperti
fungsi generus yang sudah ada):

- `pertemuanScopeWhere(auth)` — kembalikan {where, params} untuk
  filter pertemuan sesuai peran: admin→semua; daerah→tingkat
  'daerah' saja; desa→tingkat 'desa' + desa_id miliknya, ATAU
  tingkat 'kelompok' dari kelompok di desanya? TIDAK — desa hanya
  melihat pertemuan tingkat desa miliknya dan pertemuan tingkat
  kelompok di desanya (untuk rekap). kelompok→pertemuan tingkat
  kelompok miliknya + pertemuan tingkat desa di desanya + pertemuan
  tingkat daerah. Sederhanakan: pertemuan terlihat oleh pengurus
  bila lingkup pertemuan berada di dalam wilayahnya:
  admin semua; daerah semua pertemuan (satu daerah saja);
  desa: pertemuan desa_id = desanya ATAU pertemuan kelompok yang
  desanya = desanya; kelompok: pertemuan kelompok_id = kelompoknya
  ATAU pertemuan desa_id = desa dari kelompoknya ATAU pertemuan
  tingkat daerah. Tulis sebagai satu kondisi SQL dengan parameter.
- `canManagePertemuan(auth, pertemuan)` — boleh mencatat absen /
  menutup pertemuan bila: admin (semua), ATAU peran user sama
  dengan pertemuan.tingkat DAN scopenya cocok (kelompok→
  kelompok_id sama; desa→desa_id sama; daerah→tingkat 'daerah').
  Kalau tidak, fail 403.
- `generusInScope(pertemuan, generusId)` — cek generus: status
  'approved', jenjang generus ada di pertemuan.jenjang_target,
  DAN kelompok generus masuk lingkup pertemuan (kelompok→
  kelompok_id sama; desa→kelompok.desa_id sama; daerah→semua).
  Kembalikan baris generus atau null. Pakai satu query JOIN
  kelompok.
- `createPertemuan(req, res, auth)` — POST, login. Body:
  {tingkat, kelompok_id?, desa_id?, jenjang[], tanggal}.
  Validasi: tingkat salah satu dari 3; jenjang array tidak kosong,
  tiap elemen ada di JENJANG; tanggal format YYYY-MM-DD valid
  (boleh tanggal lalu — untuk mencatat pertemuan yang sudah
  lewat dari kertas). Scope yang dibuat harus sesuai peran:
  kelompok→tingkat 'kelompok' + kelompok_id miliknya;
  desa→tingkat 'desa' + desa_id miliknya;
  daerah→tingkat 'daerah' (tanpa id);
  admin→bebas (tingkat apa saja, dengan id yang sesuai).
  INSERT, response 201 + data pertemuan.
- `listPertemuan(res, auth, url)` — GET, ikut scope
  (pertemuanScopeWhere). Filter opsional ?tingkat=, ?tanggal=.
  Urut tanggal DESC, id DESC.
- `getPertemuan(res, auth, id)` — GET satu pertemuan (scope).
  Response pertemuan + jumlah tiap status absensi
  (hadir/izin/sakit/alfa) sebagai ringkasan.
- `listAbsensi(res, auth, id, url)` — GET daftar absensi satu
  pertemuan: JOIN generus (nama, kelas_sekolah, jenjang),
  urut nama. Scope pertemuan dulu.
- `recordAbsen(req, res, auth, id)` — POST absen dengan kode.
  Body {kode} (string, di-trim). Tentukan jenis kode: 32 karakter
  hex → cari generus by qr_token; 6 karakter dari MANUAL_ALPHABET
  → cari by kode_manual; selain itu 404 'Kode tidak ditemukan.'
  Validasi: pertemuan ada + canManagePertemuan; generus
  approved + generusInScope (kalau tidak, 404 yang sama supaya
  tidak bocor info); status yang dicatat 'hadir'.
  Kalau belum ada baris absensi → INSERT status 'hadir'.
  Kalau sudah ada DAN pertemuan belum selesai (selesai_pada NULL)
  → UPDATE status jadi 'hadir' (scan ulang memperbaiki).
  Kalau sudah ada DAN pertemuan sudah selesai → 409 'Gunakan
  koreksi.' Response 200 + data absensi.
- `recordAbsenManual(req, res, auth, id)` — POST absen manual
  (dari kertas). Body {generus_id, status} — status hanya
  'hadir'/'izin'/'sakit' (TIDAK boleh 'alfa' dari sini).
  Validasi sama seperti recordAbsen (pertemuan, canManage,
  generusInScope). Kalau belum ada baris → INSERT. Kalau sudah
  ada DAN belum selesai → UPDATE status. Kalau sudah selesai →
  409. Response 200 + data absensi.
- `selesaiPertemuan(res, auth, id)` — POST menutup pertemuan.
  canManagePertemuan. 409 bila sudah selesai. Dalam SATU
  transaksi: UPDATE pertemuan SET selesai_pada = now();
  INSERT INTO absensi (pertemuan_id, generus_id, status,
  dicatat_oleh) SELECT id pertemuan, g.id, 'alfa', user
  FROM generus g JOIN kelompok k ... WHERE g.status='approved'
  AND g.jenjang = ANY(pertemuan.jenjang_target)
  AND kelompok g masuk lingkup pertemuan
  AND NOT EXISTS (SELECT 1 FROM absensi a WHERE
  a.pertemuan_id = pertemuan.id AND a.generus_id = g.id).
  Response 200 + data pertemuan + jumlah alfa yang ditandai.
- `koreksiAbsensi(req, res, auth, pertemuanId, absensiId)` —
  POST koreksi. Body {status} (salah satu dari 4 status).
  Validasi: pertemuan ada + canManage; absensi ada dan milik
  pertemuan itu; koreksi_count = 0; pertemuan.selesai_pada
  TIDAK NULL; sekarang <= selesai_pada + 24 jam (cek di SQL:
  `now() <= selesai_pada + interval '24 hours'`).
  Kalau salah satu tidak terpenuhi → 409 dengan pesan yang
  jelas ('Sudah pernah dikoreksi' / 'Di luar batas 24 jam' /
  'Pertemuan belum selesai'). UPDATE status + koreksi_count=1
  + updated_at=now(). Response 200 + data absensi.
- `qrSvg(req, res, auth, id)` — GET QR generus sebagai SVG.
  Generus harus approved + punya qr_token. Scope: pengurus hanya
  boleh untuk generus di wilayahnya (kelompok→kelompoknya,
  desa→kelompok di desanya, daerah/admin→semua); kalau di luar
  scope → 404 (jangan bocorkan). Buat SVG dengan
  `QRCode.toString(qr_token, { type: 'svg', margin: 1 })`.
  Response: Content-Type `image/svg+xml`, Cache-Control no-store,
  X-Content-Type-Options nosniff.

Jangkar D (routing generus di handle(), sebelum `fail(404, ...)`):
```
  const match = pathname.match(
    /^\/api\/generus\/([1-9]\d*)\/(approve|reject|delete-request|delete-approve|delete-reject)$/
  );

  if (req.method === 'POST' && match) {
    const id = positiveId(match[1]);

    if (match[2] === 'approve') await approveGenerus(res, auth, id);
    if (match[2] === 'reject') await rejectGenerus(req, res, auth, id);
    if (match[2] === 'delete-request') await requestDelete(req, res, auth, id);
    if (match[2] === 'delete-approve') await approveDelete(res, auth, id);
    if (match[2] === 'delete-reject') await rejectDelete(req, res, auth, id);
    return;
  }

  fail(404, 'Rute tidak ditemukan.');
}
```
Sisipkan SEBELUM `fail(404, 'Rute tidak ditemukan.');`:
```
  if (pathname === '/api/pertemuan' && req.method === 'POST') {
    await createPertemuan(req, res, auth);
    return;
  }

  if (pathname === '/api/pertemuan' && req.method === 'GET') {
    await listPertemuan(res, auth, url);
    return;
  }

  const pertemuanMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)$/);
  if (req.method === 'GET' && pertemuanMatch) {
    await getPertemuan(res, auth, positiveId(pertemuanMatch[1]));
    return;
  }

  const absensiMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)\/absensi$/);
  if (req.method === 'GET' && absensiMatch) {
    await listAbsensi(res, auth, positiveId(absensiMatch[1]), url);
    return;
  }

  const absenMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)\/absen$/);
  if (req.method === 'POST' && absenMatch) {
    await recordAbsen(req, res, auth, positiveId(absenMatch[1]));
    return;
  }

  const manualMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)\/absen-manual$/);
  if (req.method === 'POST' && manualMatch) {
    await recordAbsenManual(req, res, auth, positiveId(manualMatch[1]));
    return;
  }

  const selesaiMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)\/selesai$/);
  if (req.method === 'POST' && selesaiMatch) {
    await selesaiPertemuan(res, auth, positiveId(selesaiMatch[1]));
    return;
  }

  const koreksiMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)\/absensi\/([1-9]\d*)\/koreksi$/);
  if (req.method === 'POST' && koreksiMatch) {
    await koreksiAbsensi(req, res, auth, positiveId(koreksiMatch[1]), positiveId(koreksiMatch[2]));
    return;
  }

  const qrMatch = pathname.match(/^\/api\/generus\/([1-9]\d*)\/qr\.svg$/);
  if (req.method === 'GET' && qrMatch) {
    await qrSvg(req, res, auth, positiveId(qrMatch[1]));
    return;
  }
```
CATATAN: route GET /api/generus/:id/qr.svg harus dicek SETELAH
route POST /api/generus/:id/... di atas (tidak bentrok karena
metode berbeda). Pastikan tidak ada rute yang tertelan regex lain.

### 3. `server/public/cetak-qr.html` (file baru, lengkap)

Halaman cetak QR untuk pengurus kelompok (palet GENSA: latar
#F6F1E9, tombol #8A5A33, aksen #5F7A57; tanpa gradasi, tanpa
latar gelap; mobile-first; bahasa Indonesia natural):
- Cek /api/me saat buka: kalau belum login → arahkan ke
  /login.html. Kalau peran bukan 'kelompok' → tampilkan pesan
  "Halaman ini untuk pengurus kelompok." dan berhenti.
- Ambil daftar generus kelompoknya: GET /api/generus?status=approved.
  Kalau kosong → pesan ramah "Belum ada generus yang disetujui.
  Minta persetujuan Admin dulu."
- Tiap generus jadi satu kartu: gambar QR dari
  `/api/generus/:id/qr.svg`, nama (besar), kelas + jenjang,
  kode manual (besar, monospace). Tanpa innerHTML dengan data
  pengguna (pakai textContent; untuk <img> set atribut src saja).
- Tombol "Cetak semua" di atas → window.print().
- Tiap kartu punya tombol "Cetak kartu ini" → beri class khusus
  pada kartu itu lalu window.print() (CSS @media print hanya
  menampilkan kartu yang dipilih; setelah print, hapus classnya
  lewat afterprint).
- CSS print: kartu rapi di kertas, satu kartu per area, tanpa
  tombol saat dicetak.
- Tanpa library luar.

### 4. `server/smoke-test-s2.js` (file baru, lengkap)

Script Node terpisah (jangan ubah smoke-test.js Sesi 1): pakai
fetch bawaan + `node:assert/strict`. Anggap server SUDAH jalan di
http://127.0.0.1:PORT (PORT dari env, default 3101). Admin login
pakai env ADMIN_EMAIL + ADMIN_PASSWORD. Cetak PASS/FAIL per cek,
exit 1 bila ada FAIL. Buat data tes dengan domain
`@tes.gensa.local` (biarkan, jangan hapus). Urutan cek:
1. Admin buat akun kelompok (email acak @tes.gensa.local) → 201.
   Login akun itu → 200, ganti password → 200.
2. Akun kelompok ajukan generus A (tingkat sd) + generus B
   (tingkat sd) + generus C (tingkat smp) → 201, status pending.
3. Admin approve ketiganya → 200, qr_token + kode_manual terisi.
4. Akun kelompok buat pertemuan: {tingkat:'kelompok',
   jenjang:['caberawit'], tanggal: hari ini} → 201.
   (Kelompok contoh dari seed Sesi 1; kelompok_id diambil dari
   akun kelompok yang dibuat di cek 1 — akun itu dibuat dengan
   kelompok_id kelompok contoh.)
5. Akun kelompok absen generus A dengan kode_manual → 200,
   status 'hadir'. GET absensi pertemuan → 1 baris.
6. Absen generus A lagi dengan qr_token → 200, tetap 1 baris
   (tidak double).
7. Absen generus C (jenjang pra_remaja, di luar target
   caberawit) → 404.
8. Absen dengan kode salah → 404.
9. Akun kelompok absen manual generus B status 'izin' → 200.
10. Akun desa (dibuat admin, desa dari kelompok contoh) coba
    absen di pertemuan kelompok itu → 403 (bukan tingkatnya).
11. Akun kelompok tutup pertemuan (POST selesai) → 200;
    generus C tetap tidak ada barisnya (di luar target),
    dan tidak ada generus lain yang tertandai alfa
    (A hadir, B izin — tidak ada yang alfa). Lalu buat pertemuan
    kedua (jenjang ['caberawit','pra_remaja']), absen A saja,
    tutup → B dan C tertandai 'alfa' (cek lewat GET absensi).
12. Koreksi absensi B (pertemuan kedua) dari 'alfa' ke 'hadir'
    → 200; koreksi yang sama lagi → 409.
13. GET /api/generus/:id/qr.svg (generus A) → 200,
    content-type mengandung image/svg+xml, isi mengandung '<svg'.
14. GET /cetak-qr.html → 200, content-type text/html.
15. Akun kelompok GET /api/pertemuan → hanya melihat pertemuan
    di wilayahnya (minimal pertemuan yang ia buat ada di daftar).

CATATAN untuk cek 11: pertemuan kedua dibuat SETELAH pertemuan
pertama selesai. Generus A, B, C semuanya approved dan masuk
target pertemuan kedua (caberawit + pra_remaja mencakup sd dan
smp). Setelah tutup pertemuan kedua: A hadir (sudah absen),
B alfa, C alfa — total 3 baris.

## Format jawaban

- Untuk migrasi 002, cetak-qr.html, dan smoke-test-s2.js: satu
  blok kode berlabel path file, isi file LENGKAP tanpa potongan.
- Untuk index.js: SATU blok diff unified (--- a/server/index.js
  +++ b/server/index.js) berisi SEMUA perubahan (require qrcode,
  konstanta baru, fungsi-fungsi baru, routing baru). Jangan
  output seluruh isi index.js.
- Jangan tambah file lain. Akhiri dengan ringkasan 8 baris:
  keputusan desain + cara menjalankan migrasi + cara menjalankan
  smoke test S2 + yang belum diputuskan. Bahasa jawaban: Indonesia.
