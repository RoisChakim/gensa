# Codex — GENSA MVP Sesi 2: Backend QR + Absensi (SESI BARU, model Astra High)

Kamu adalah Codex. Kerjakan SATU tugas ini sampai selesai: lengkapi
backend Sesi 2 (QR + absensi) untuk aplikasi GENSA. Kamu TIDAK bisa
membaca/menulis file — OUTPUT isi file lengkap dalam blok kode
berlabel nama file. Saya yang menulis file-nya dan menjalankan
migrasi + tesnya. Jangan tanya apa pun; semua keputusan sudah
ditetapkan di bawah.

## Yang sudah selesai (jangan dibuat ulang)

- Migrasi `server/migrations/002_pertemuan_absensi.sql` SUDAH ditulis
  dan SUDAH ada di repo (tabel pertemuan + absensi, enum
  status_absensi). Jangan buat lagi.
- `server/public/cetak-qr.html` SUDAH ditulis dan ada di repo.
- `server/smoke-test-s2.js` SUDAH ditulis dan ada di repo (tesnya
  memanggil endpoint di bawah — API HARUS cocok dengan tes ini).
- Dependensi `qrcode` (^1.5.4) SUDAH terpasang di server/package.json.
  Pakai `require('qrcode')` untuk membuat SVG QR.

## Stack dan aturan (wajib)

- Node.js 24 stdlib `http` + `pg` + `bcryptjs` + `qrcode`. Tanpa
  Express, tanpa ORM.
- Semua query pakai parameter. Cek peran + kepemilikan scope di
  server untuk SETIAP aksi. Jangan kembalikan password_hash.
  Error jangan bocorkan detail database.
- Validasi server yang ketat. Tanpa innerHTML dengan data pengguna.
  Tanpa rahasia di kode/repo.
- `updated_at` tidak ada trigger — SET manual di tiap UPDATE.
- JANGAN bangun: link izin, absen offline, login Google, jadwal,
  laporan Word, materi/penilaian. Scan kamera (getUserMedia/jsQR)
  TIDAK dibuat — absen menerima kode yang diketik/ditempel.

## Skema yang sudah ada

- `daerah`, `desa`, `kelompok`, `users` (role admin/daerah/desa/
  kelompok, CHECK role↔scope), `generus` (status pending/approved/
  rejected/delete_pending; approved wajib punya `qr_token` 32 hex
  + `kode_manual` 6 karakter alfabet A–Z + 2–9 tanpa 0/O/1/I;
  jenjang GENERATED dari tingkat), `sessions`.
- Migrasi 002 (sudah ada, isinya disertakan di bawah): tabel
  `pertemuan` (id, tingkat 'kelompok'/'desa'/'daerah', kelompok_id,
  desa_id, jenjang_target jenjang_generus[], tanggal, dibuat_oleh,
  selesai_pada, created_at, updated_at; CHECK scope sesuai tingkat)
  dan `absensi` (id, pertemuan_id, generus_id, status
  status_absensi 'hadir'/'izin'/'sakit'/'alfa', dicatat_oleh,
  koreksi_count DEFAULT 0, created_at, updated_at,
  UNIQUE(pertemuan_id, generus_id)).

## Tugas: lengkapi `server/index.js`

Salin PERSIS isi `server/index.js` yang disertakan di bawah (jangan
ubah satu baris pun dari kode Sesi 1 yang sudah jalan), lalu
TAMBAHKAN hal-hal berikut. Saya akan membandingkan dengan file lama
untuk memastikan hanya ada tambahan.

1. Tambahkan `const QRCode = require('qrcode');` di bawah require
   bcryptjs.
2. Tambahkan konstanta setelah STATUSES:
   `const JENJANG = new Set(['caberawit', 'pra_remaja', 'remaja', 'usia_nikah']);`
   `const STATUS_ABSENSI = new Set(['hadir', 'izin', 'sakit', 'alfa']);`
   `const TINGKAT_PERTEMUAN = new Set(['kelompok', 'desa', 'daerah']);`
3. Tambahkan fungsi-fungsi baru di antara akhir fungsi rejectDelete
   dan `async function serveStatic`:
   - `pertemuanScopeWhere(auth)` — kondisi SQL filter pertemuan
     sesuai peran: admin→semua; daerah→semua pertemuan (satu daerah
     saja); desa→pertemuan desa_id = desanya ATAU pertemuan kelompok
     yang desanya = desanya; kelompok→pertemuan kelompok_id =
     kelompoknya ATAU pertemuan desa_id = desa dari kelompoknya
     ATAU pertemuan tingkat daerah.
   - `canManagePertemuan(auth, pertemuan)` — boleh mencatat absen /
     menutup pertemuan bila: admin (semua), ATAU peran user sama
     dengan pertemuan.tingkat DAN scopenya cocok (kelompok→
     kelompok_id sama; desa→desa_id sama; daerah→tingkat 'daerah').
     Kalau tidak, fail 403.
   - `generusInScope(pertemuan, generusId)` — cek generus: status
     'approved', jenjang generus ada di pertemuan.jenjang_target,
     DAN kelompok generus masuk lingkup pertemuan (kelompok→
     kelompok_id sama; desa→kelompok.desa_id sama; daerah→semua).
     Kembalikan baris generus atau null. Satu query JOIN kelompok.
   - `createPertemuan(req, res, auth)` — POST. Body {tingkat,
     kelompok_id?, desa_id?, jenjang[], tanggal}. Validasi: tingkat
     salah satu dari 3; jenjang array tidak kosong, tiap elemen ada
     di JENJANG; tanggal format YYYY-MM-DD valid (boleh tanggal lalu
     — untuk mencatat pertemuan yang sudah lewat dari kertas).
     Scope yang dibuat harus sesuai peran: kelompok→tingkat
     'kelompok' + kelompok_id miliknya; desa→tingkat 'desa' +
     desa_id miliknya; daerah→tingkat 'daerah' (tanpa id);
     admin→bebas (tingkat apa saja, dengan id yang sesuai).
     INSERT, response 201 + {pertemuan}.
   - `listPertemuan(res, auth, url)` — GET, ikut scope
     (pertemuanScopeWhere). Filter opsional ?tingkat=, ?tanggal=.
     Urut tanggal DESC, id DESC. Response 200 + {pertemuan: []}.
   - `getPertemuan(res, auth, id)` — GET satu pertemuan (scope).
     Response 200 + {pertemuan, ringkasan: {hadir, izin, sakit,
     alfa}} (hitung tiap status absensi).
   - `listAbsensi(res, auth, id, url)` — GET daftar absensi satu
     pertemuan: JOIN generus (nama, kelas_sekolah, jenjang), urut
     nama. Response 200 + {absensi: []} (tiap baris ada id,
     generus_id, status, koreksi_count). Scope pertemuan dulu.
   - `recordAbsen(req, res, auth, id)` — POST absen dengan kode.
     Body {kode} (string, di-trim). Tentukan jenis kode: 32 karakter
     hex → cari generus by qr_token; 6 karakter dari MANUAL_ALPHABET
     → cari by kode_manual; selain itu 404 'Kode tidak ditemukan.'
     TRANSAKSI + KUNCI (wajib, cegah balapan dengan penutupan):
     BEGIN; `SELECT id, selesai_pada FROM pertemuan WHERE id = $1
     FOR UPDATE`; bila pertemuan tidak ada → ROLLBACK 404.
     Cek generus (approved + generusInScope); bila tidak cocok →
     ROLLBACK 404. Bila selesai_pada NULL: INSERT baris absensi
     status 'hadir' bila belum ada, atau UPDATE status jadi 'hadir'
     bila sudah ada; COMMIT. Bila selesai_pada sudah terisi →
     ROLLBACK 409 'Gunakan koreksi.' Response 200 + {absensi}.
     Juga cek canManagePertemuan SEBELUM transaksi (403 bila
     bukan tingkatnya).
   - `recordAbsenManual(req, res, auth, id)` — POST absen manual.
     Body {generus_id, status} — status hanya 'hadir'/'izin'/
     'sakit' (TIDAK boleh 'alfa' dari sini). Transaksi + FOR UPDATE
     sama seperti recordAbsen (cek pertemuan, cek generusInScope,
     INSERT bila belum ada / UPDATE bila sudah ada dan belum
     selesai, 409 bila sudah selesai). Response 200 + {absensi}.
   - `selesaiPertemuan(res, auth, id)` — POST menutup pertemuan.
     canManagePertemuan. TRANSAKSI: BEGIN; SELECT pertemuan
     FOR UPDATE; bila tidak ada → ROLLBACK 404; bila sudah selesai
     → ROLLBACK 409. UPDATE pertemuan SET selesai_pada = now().
     INSERT alfa: satu INSERT ... SELECT ... WHERE NOT EXISTS —
     tandai semua generus approved dalam lingkup + jenjang target
     yang belum punya baris absensi, status 'alfa', dicatat_oleh =
     user yang menutup. COMMIT. Response 200 + {pertemuan,
     alfa_ditandai: <jumlah>}.
   - `koreksiAbsensi(req, res, auth, pertemuanId, absensiId)` —
     POST koreksi. Body {status} (salah satu dari 4 status).
     TRANSAKSI: BEGIN; SELECT absensi WHERE id = $1 AND
     pertemuan_id = $2 FOR UPDATE; bila tidak ada → ROLLBACK 404.
     Cek pertemuan: selesai_pada TIDAK NULL, sekarang <=
     selesai_pada + 24 jam, dan koreksi_count = 0; bila tidak
     memenuhi → ROLLBACK 409 dengan pesan jelas ('Sudah pernah
     dikoreksi' / 'Di luar batas 24 jam' / 'Pertemuan belum
     selesai'). UPDATE status + koreksi_count = 1 + updated_at =
     now(). COMMIT. Response 200 + {absensi}.
   - `qrSvg(req, res, auth, id)` — GET QR generus sebagai SVG.
     Generus harus approved + punya qr_token. Scope: pengurus hanya
     boleh untuk generus di wilayahnya (kelompok→kelompoknya,
     desa→kelompok di desanya, daerah/admin→semua); di luar scope
     → 404. Buat SVG dengan `QRCode.toString(qr_token,
     { type: 'svg', margin: 1 })`. Response: Content-Type
     `image/svg+xml`, Cache-Control no-store, X-Content-Type-Options
     nosniff. Bila generus tidak ada / bukan approved / tanpa
     qr_token → 404.
4. Tambahkan routing di handle(), disisipkan SEBELUM
   `fail(404, 'Rute tidak ditemukan.');`:
   - POST /api/pertemuan → createPertemuan
   - GET /api/pertemuan → listPertemuan
   - GET /api/pertemuan/:id → getPertemuan
   - GET /api/pertemuan/:id/absensi → listAbsensi
   - POST /api/pertemuan/:id/absen → recordAbsen
   - POST /api/pertemuan/:id/absen-manual → recordAbsenManual
   - POST /api/pertemuan/:id/selesai → selesaiPertemuan
   - POST /api/pertemuan/:id/absensi/:absensiId/koreksi → koreksiAbsensi
   - GET /api/generus/:id/qr.svg → qrSvg
   Pakai pola regex yang sama seperti route generus yang sudah ada
   (`/^\/api\/pertemuan\/([1-9]\d*)$/` dan seterusnya, dengan
   positiveId). Route GET qr.svg tidak bentrok dengan route POST
   generus karena metode berbeda.

## Format jawaban

Satu blok kode berlabel `server/index.js`, isi file LENGKAP tanpa
potongan (salinan Sesi 1 + semua tambahan di atas). Jangan tambah
file lain. Akhiri dengan ringkasan 8 baris: keputusan desain + cara
menjalankan migrasi + cara menjalankan smoke test S2 + yang belum
diputuskan. Bahasa jawaban: Indonesia.

## Isi file saat ini (salin persis, lalu tambahkan)

### server/index.js (saat ini, Sesi 1 — JANGAN ubah, hanya tambah)
```js
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

/*
 * Variabel yang sudah ada di environment selalu diutamakan.
 * Parser ini menerima KEY=value dan nilai yang dibungkus tanda petik.
 */
function loadEnv() {
  let content;

  try {
    content = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.hasOwn(process.env, match[1])) continue;

    let value = match[2];
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadEnv();

const db = require('./db');

const PORT = Number(process.env.PORT || 3101);
const SESSION_SECRET = process.env.SESSION_SECRET;
const SESSION_SECONDS = 12 * 60 * 60;
const RESET_SECONDS = 60 * 60;
const MAX_BODY = 100 * 1024;
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const MANUAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const ROLES = new Set(['admin', 'daerah', 'desa', 'kelompok']);
const TINGKAT = new Set(['paud', 'sd', 'smp', 'sma', 'kuliah', 'kerja']);
const STATUSES = new Set(['pending', 'approved', 'rejected', 'delete_pending']);
const loginFailures = new Map();

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT tidak valid.');
}

if (!SESSION_SECRET || Buffer.byteLength(SESSION_SECRET, 'utf8') < 32) {
  throw new Error('SESSION_SECRET wajib diisi minimal 32 byte acak.');
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new HttpError(status, message);
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

function sendError(res, error) {
  if (res.headersSent || res.destroyed) return;

  if (error instanceof HttpError) {
    sendJson(res, error.status, { error: error.message });
    return;
  }

  console.error('Terjadi kesalahan saat memproses permintaan.');
  sendJson(res, 500, { error: 'Terjadi kesalahan pada server.' });
}

function requiredString(value, label, max = 255) {
  if (typeof value !== 'string') fail(400, `${label} wajib diisi.`);
  const result = value.trim();
  if (!result || result.length > max) {
    fail(400, `${label} tidak valid.`);
  }
  return result;
}

function passwordValue(value, label, minimum = 1) {
  const result = requiredString(value, label, 72);
  if (
    Array.from(result).length < minimum ||
    Buffer.byteLength(result, 'utf8') > 72
  ) {
    fail(400, `${label} tidak valid.`);
  }
  return result;
}

function normalizedEmail(value) {
  const email = requiredString(value, 'Email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(400, 'Email tidak valid.');
  }
  return email;
}

function positiveId(value, label = 'ID') {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    !/^[1-9]\d*$/.test(String(value))
  ) {
    fail(400, `${label} tidak valid.`);
  }

  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > 2147483647) {
    fail(400, `${label} tidak valid.`);
  }
  return number;
}

function optionalId(value, label) {
  if (value === undefined || value === null || value === '') return null;
  return positiveId(value, label);
}

function validDate(value) {
  const date = requiredString(value, 'Tanggal lahir', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    fail(400, 'Tanggal lahir tidak valid.');
  }

  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date ||
    date > new Date().toISOString().slice(0, 10)
  ) {
    fail(400, 'Tanggal lahir tidak valid.');
  }
  return date;
}

async function readJson(req) {
  const contentType = (req.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  if (contentType !== 'application/json') {
    fail(415, 'Gunakan Content-Type application/json.');
  }

  const declaredLength = req.headers['content-length'];
  if (declaredLength && Number(declaredLength) > MAX_BODY) {
    req.resume();
    fail(413, 'Ukuran permintaan terlalu besar.');
  }

  let size = 0;
  const chunks = [];

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      req.resume();
      fail(413, 'Ukuran permintaan terlalu besar.');
    }
    chunks.push(chunk);
  }

  let data;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    fail(400, 'JSON tidak valid.');
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    fail(400, 'Isi permintaan tidak valid.');
  }
  return data;
}

function randomString(alphabet, length) {
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += alphabet[crypto.randomInt(alphabet.length)];
  }
  return result;
}

function sessionCookie(token, secure, maxAge = SESSION_SECONDS) {
  return [
    `gensa_session=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAge}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

function cookieToken(req) {
  const cookies = (req.headers.cookie || '').split(';');
  const matches = [];

  for (const part of cookies) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === 'gensa_session') {
      matches.push(part.slice(separator + 1).trim());
    }
  }

  if (matches.length !== 1 || !/^[a-f0-9]{64}$/.test(matches[0])) {
    return null;
  }
  return matches[0];
}

function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;

  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    fail(403, 'Asal permintaan tidak diizinkan.');
  }

  const protocol = req.socket.encrypted ? 'https:' : 'http:';
  if (
    parsed.protocol !== protocol ||
    parsed.host !== req.headers.host ||
    parsed.username ||
    parsed.password
  ) {
    fail(403, 'Asal permintaan tidak diizinkan.');
  }
}

async function authenticate(req) {
  const token = cookieToken(req);
  if (!token) fail(401, 'Silakan masuk terlebih dahulu.');

  const result = await db.query(
    `SELECT u.id, u.email, u.role, u.desa_id, u.kelompok_id,
            u.must_change_password
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1
       AND s.revoked = false
       AND s.expires_at > now()
       AND u.active = true`,
    [token]
  );

  if (result.rowCount !== 1) fail(401, 'Silakan masuk terlebih dahulu.');
  return { user: result.rows[0], token };
}

function requireRole(user, role) {
  if (user.role !== role) fail(403, 'Anda tidak memiliki akses.');
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    desa_id: user.desa_id,
    kelompok_id: user.kelompok_id,
    must_change_password: user.must_change_password,
  };
}

function rateState(email) {
  const now = Date.now();

  for (const [key, entry] of loginFailures) {
    if (entry.expiresAt <= now) loginFailures.delete(key);
  }

  return loginFailures.get(email);
}

function recordLoginFailure(email) {
  const now = Date.now();
  let entry = rateState(email);

  if (!entry) {
    entry = { count: 0, expiresAt: now + 15 * 60 * 1000 };
    loginFailures.set(email, entry);
  }
  entry.count += 1;
}

async function login(req, res) {
  const body = await readJson(req);
  const email = normalizedEmail(body.email);
  const password = passwordValue(body.password, 'Password');
  const state = rateState(email);

  if (state && state.count >= 5) {
    fail(429, 'Terlalu banyak percobaan. Coba lagi nanti.');
  }

  const result = await db.query(
    `SELECT id, email, password_hash, role, desa_id, kelompok_id,
            must_change_password, active
     FROM users
     WHERE lower(email) = $1`,
    [email]
  );

  const user = result.rows[0];
  const valid = user && user.active && await bcrypt.compare(password, user.password_hash);

  if (!valid) {
    recordLoginFailure(email);
    fail(401, 'Email atau password salah.');
  }

  loginFailures.delete(email);

  const token = crypto.randomBytes(32).toString('hex');
  await db.query(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 * interval '1 second'))`,
    [token, user.id, SESSION_SECONDS]
  );

  sendJson(
    res,
    200,
    {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        must_change_password: user.must_change_password,
      },
    },
    { 'Set-Cookie': sessionCookie(token, Boolean(req.socket.encrypted)) }
  );
}

async function logout(req, res, auth) {
  await db.query(
    'UPDATE sessions SET revoked = true WHERE token = $1',
    [auth.token]
  );
  sendJson(
    res,
    200,
    { ok: true },
    { 'Set-Cookie': sessionCookie('', Boolean(req.socket.encrypted), 0) }
  );
}

async function createUser(req, res, auth) {
  requireRole(auth.user, 'admin');
  const body = await readJson(req);

  const email = normalizedEmail(body.email);
  const role = requiredString(body.role, 'Peran', 20);
  const desaId = optionalId(body.desa_id, 'Desa');
  const kelompokId = optionalId(body.kelompok_id, 'Kelompok');

  if (!ROLES.has(role)) fail(400, 'Peran tidak valid.');

  const validScope =
    ((role === 'admin' || role === 'daerah') && desaId === null && kelompokId === null) ||
    (role === 'desa' && desaId !== null && kelompokId === null) ||
    (role === 'kelompok' && desaId === null && kelompokId !== null);

  if (!validScope) fail(400, 'Wilayah tidak sesuai dengan peran.');

  if (desaId !== null) {
    const result = await db.query('SELECT id FROM desa WHERE id = $1', [desaId]);
    if (result.rowCount !== 1) fail(400, 'Desa tidak ditemukan.');
  }

  if (kelompokId !== null) {
    const result = await db.query('SELECT id FROM kelompok WHERE id = $1', [kelompokId]);
    if (result.rowCount !== 1) fail(400, 'Kelompok tidak ditemukan.');
  }

  const initialPassword = randomString(PASSWORD_ALPHABET, 12);
  const passwordHash = await bcrypt.hash(initialPassword, 12);

  let result;
  try {
    result = await db.query(
      `INSERT INTO users
         (email, password_hash, role, desa_id, kelompok_id, must_change_password)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, email, role, desa_id, kelompok_id, must_change_password`,
      [email, passwordHash, role, desaId, kelompokId]
    );
  } catch (error) {
    if (error.code === '23505') fail(409, 'Email sudah digunakan.');
    if (error.code === '23503') fail(400, 'Wilayah tidak ditemukan.');
    throw error;
  }

  sendJson(res, 201, { user: result.rows[0], initial_password: initialPassword });
}

async function changePassword(req, res, auth) {
  const body = await readJson(req);
  const oldPassword = passwordValue(body.old_password, 'Password lama');
  const newPassword = passwordValue(body.new_password, 'Password baru', 8);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      'SELECT password_hash FROM users WHERE id = $1 AND active = true FOR UPDATE',
      [auth.user.id]
    );

    if (
      result.rowCount !== 1 ||
      !(await bcrypt.compare(oldPassword, result.rows[0].password_hash))
    ) {
      fail(400, 'Password lama salah.');
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await client.query(
      `UPDATE users SET password_hash = $1, must_change_password = false
       WHERE id = $2`,
      [hash, auth.user.id]
    );
    await client.query(
      'UPDATE sessions SET revoked = true WHERE user_id = $1 AND token <> $2',
      [auth.user.id, auth.token]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  sendJson(res, 200, { ok: true });
}

function resetSignature(payload) {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest();
}

function passwordFingerprint(passwordHash) {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(passwordHash)
    .digest('base64url');
}

async function requestReset(req, res) {
  const body = await readJson(req);
  const email = normalizedEmail(body.email);

  const result = await db.query(
    'SELECT id, email, password_hash FROM users WHERE lower(email) = $1 AND active = true',
    [email]
  );

  if (result.rowCount === 1) {
    const user = result.rows[0];
    const payload = Buffer.from(JSON.stringify({
      id: user.id,
      exp: Math.floor(Date.now() / 1000) + RESET_SECONDS,
      fingerprint: passwordFingerprint(user.password_hash),
      nonce: crypto.randomBytes(16).toString('hex'),
    })).toString('base64url');
    const token = `${payload}.${resetSignature(payload).toString('base64url')}`;

    const protocol = req.socket.encrypted ? 'https' : 'http';
    // Host tetap, sehingga header Host tidak dapat mengubah tujuan tautan.
    const link = `${protocol}://127.0.0.1:${PORT}/reset-password.html?token=${encodeURIComponent(token)}`;
    console.log(`Tautan reset untuk ${user.email}: ${link}`);
  }

  sendJson(res, 200, {
    ok: true,
    message: 'Jika akun tersedia, petunjuk reset akan disiapkan.',
  });
}

function parseResetToken(value) {
  const token = requiredString(value, 'Token', 2048);
  const parts = token.split('.');
  if (
    parts.length !== 2 ||
    !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
    !/^[A-Za-z0-9_-]+$/.test(parts[1])
  ) {
    fail(400, 'Token reset tidak valid atau sudah kedaluwarsa.');
  }

  let received;
  try {
    received = Buffer.from(parts[1], 'base64url');
  } catch {
    fail(400, 'Token reset tidak valid atau sudah kedaluwarsa.');
  }

  const expected = resetSignature(parts[0]);
  if (
    received.length !== expected.length ||
    !crypto.timingSafeEqual(received, expected)
  ) {
    fail(400, 'Token reset tidak valid atau sudah kedaluwarsa.');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    fail(400, 'Token reset tidak valid atau sudah kedaluwarsa.');
  }

  if (
    !payload ||
    !Number.isSafeInteger(payload.id) ||
    payload.id < 1 ||
    !Number.isSafeInteger(payload.exp) ||
    payload.exp <= Math.floor(Date.now() / 1000) ||
    typeof payload.fingerprint !== 'string'
  ) {
    fail(400, 'Token reset tidak valid atau sudah kedaluwarsa.');
  }

  return payload;
}

async function confirmReset(req, res) {
  const body = await readJson(req);
  const payload = parseResetToken(body.token);
  const newPassword = passwordValue(body.new_password, 'Password baru', 8);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      'SELECT password_hash FROM users WHERE id = $1 AND active = true FOR UPDATE',
      [payload.id]
    );

    if (
      result.rowCount !== 1 ||
      payload.fingerprint !== passwordFingerprint(result.rows[0].password_hash)
    ) {
      fail(400, 'Token reset tidak valid atau sudah kedaluwarsa.');
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await client.query(
      `UPDATE users SET password_hash = $1, must_change_password = false
       WHERE id = $2`,
      [hash, payload.id]
    );
    await client.query(
      'UPDATE sessions SET revoked = true WHERE user_id = $1',
      [payload.id]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  sendJson(res, 200, { ok: true });
}

async function createGenerus(req, res, auth) {
  requireRole(auth.user, 'kelompok');
  const body = await readJson(req);

  const nama = requiredString(body.nama, 'Nama', 200);
  const tanggalLahir = validDate(body.tanggal_lahir);
  const kelas = requiredString(body.kelas_sekolah, 'Kelas sekolah', 100);
  const tingkat = requiredString(body.tingkat, 'Tingkat', 20);
  const ortuNama = requiredString(body.ortu_nama, 'Nama orang tua', 200);
  const ortuHubungan = requiredString(body.ortu_hubungan, 'Hubungan orang tua', 100);
  const ortuHp = requiredString(body.ortu_hp, 'Nomor HP orang tua', 30);

  if (!TINGKAT.has(tingkat)) fail(400, 'Tingkat tidak valid.');
  if (!/^[+0-9 ()-]+$/.test(ortuHp)) fail(400, 'Nomor HP tidak valid.');

  const result = await db.query(
    `INSERT INTO generus
       (kelompok_id, nama, tanggal_lahir, kelas_sekolah, tingkat,
        ortu_nama, ortu_hubungan, ortu_hp, status, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)
     RETURNING id, kelompok_id, nama, tanggal_lahir, kelas_sekolah,
               tingkat, jenjang, ortu_nama, ortu_hubungan, ortu_hp,
               status, requested_by, created_at, updated_at`,
    [
      auth.user.kelompok_id, nama, tanggalLahir, kelas, tingkat,
      ortuNama, ortuHubungan, ortuHp, auth.user.id,
    ]
  );

  sendJson(res, 201, { generus: result.rows[0] });
}

async function listGenerus(res, auth, url) {
  const status = url.searchParams.get('status');
  if (status !== null && !STATUSES.has(status)) {
    fail(400, 'Status tidak valid.');
  }

  const result = await db.query(
    `SELECT g.id, g.kelompok_id, g.nama, g.tanggal_lahir, g.kelas_sekolah,
            g.tingkat, g.jenjang, g.ortu_nama, g.ortu_hubungan, g.ortu_hp,
            g.status, g.alasan_penolakan, g.alasan_penghapusan,
            g.requested_by, g.decided_by, g.decided_at, g.qr_token,
            g.kode_manual, g.created_at, g.updated_at
     FROM generus g
     JOIN kelompok k ON k.id = g.kelompok_id
     WHERE ($1::text IS NULL OR g.status::text = $1)
       AND (
         $2::text IN ('admin', 'daerah')
         OR ($2::text = 'desa' AND k.desa_id = $3)
         OR ($2::text = 'kelompok' AND g.kelompok_id = $4)
       )
     ORDER BY g.created_at DESC, g.id DESC`,
    [status, auth.user.role, auth.user.desa_id, auth.user.kelompok_id]
  );

  sendJson(res, 200, { generus: result.rows });
}

async function approveGenerus(res, auth, id) {
  requireRole(auth.user, 'admin');

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const qrToken = crypto.randomBytes(16).toString('hex');
    const kodeManual = randomString(MANUAL_ALPHABET, 6);

    try {
      const result = await db.query(
        `UPDATE generus
         SET status = 'approved', qr_token = $1, kode_manual = $2,
             decided_by = $3, decided_at = now(), updated_at = now()
         WHERE id = $4 AND status = 'pending'
         RETURNING id, kelompok_id, nama, status, qr_token, kode_manual,
                   decided_by, decided_at, updated_at`,
        [qrToken, kodeManual, auth.user.id, id]
      );

      if (result.rowCount !== 1) {
        fail(409, 'Generus tidak ditemukan atau tidak berstatus pending.');
      }

      sendJson(res, 200, { generus: result.rows[0] });
      return;
    } catch (error) {
      if (error.code === '23505') continue;
      throw error;
    }
  }

  throw new Error('Gagal membuat kode unik.');
}

async function rejectGenerus(req, res, auth, id) {
  requireRole(auth.user, 'admin');
  const body = await readJson(req);
  const catatan = requiredString(body.catatan, 'Catatan', 2000);

  const result = await db.query(
    `UPDATE generus
     SET status = 'rejected', alasan_penolakan = $1,
         decided_by = $2, decided_at = now(), updated_at = now()
     WHERE id = $3 AND status = 'pending'
     RETURNING id, status, alasan_penolakan, decided_by, decided_at, updated_at`,
    [catatan, auth.user.id, id]
  );

  if (result.rowCount !== 1) {
    fail(409, 'Generus tidak ditemukan atau tidak berstatus pending.');
  }
  sendJson(res, 200, { generus: result.rows[0] });
}

async function requestDelete(req, res, auth, id) {
  requireRole(auth.user, 'kelompok');
  const body = await readJson(req);
  const alasan = requiredString(body.alasan, 'Alasan', 2000);

  const result = await db.query(
    `UPDATE generus
     SET status = 'delete_pending', alasan_penghapusan = $1, updated_at = now()
     WHERE id = $2 AND kelompok_id = $3 AND status = 'approved'
     RETURNING id, status, alasan_penghapusan, updated_at`,
    [alasan, id, auth.user.kelompok_id]
  );

  if (result.rowCount !== 1) {
    fail(409, 'Generus tidak ditemukan atau tidak dapat diajukan untuk dihapus.');
  }
  sendJson(res, 200, { generus: result.rows[0] });
}

async function approveDelete(res, auth, id) {
  requireRole(auth.user, 'admin');

  const result = await db.query(
    "DELETE FROM generus WHERE id = $1 AND status = 'delete_pending' RETURNING id",
    [id]
  );

  if (result.rowCount !== 1) {
    fail(409, 'Pengajuan penghapusan tidak ditemukan.');
  }
  sendJson(res, 200, { ok: true });
}

async function rejectDelete(req, res, auth, id) {
  requireRole(auth.user, 'admin');
  const body = await readJson(req);
  const catatan = requiredString(body.catatan, 'Catatan', 2000);

  const result = await db.query(
    `UPDATE generus
     SET status = 'approved', alasan_penghapusan = NULL,
         alasan_penolakan = $1, decided_by = $2, decided_at = now(),
         updated_at = now()
     WHERE id = $3 AND status = 'delete_pending'
     RETURNING id, status, alasan_penolakan, decided_by, decided_at, updated_at`,
    [catatan, auth.user.id, id]
  );

  if (result.rowCount !== 1) {
    fail(409, 'Pengajuan penghapusan tidak ditemukan.');
  }
  sendJson(res, 200, { generus: result.rows[0] });
}

async function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    fail(400, 'Alamat tidak valid.');
  }

  if (
    decoded.includes('\0') ||
    decoded.includes('\\') ||
    decoded.split('/').some((part) => part === '.' || part === '..')
  ) {
    fail(404, 'Halaman tidak ditemukan.');
  }

  const extension = path.extname(decoded).toLowerCase();
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
  };

  if (!contentTypes[extension]) fail(404, 'Halaman tidak ditemukan.');

  const requested = path.resolve(PUBLIC_DIR, `.${decoded}`);
  if (!requested.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    fail(404, 'Halaman tidak ditemukan.');
  }

  let realPath;
  try {
    realPath = await fs.promises.realpath(requested);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      fail(404, 'Halaman tidak ditemukan.');
    }
    throw error;
  }

  const realPublicDir = await fs.promises.realpath(PUBLIC_DIR);
  if (!realPath.startsWith(`${realPublicDir}${path.sep}`)) {
    fail(404, 'Halaman tidak ditemukan.');
  }

  let content;
  try {
    content = await fs.promises.readFile(realPath);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      fail(404, 'Halaman tidak ditemukan.');
    }
    throw error;
  }

  res.writeHead(200, {
    'Content-Type': contentTypes[extension],
    'Content-Length': content.length,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
  });
  res.end(content);
}

async function handle(req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://127.0.0.1');
  } catch {
    fail(400, 'Alamat tidak valid.');
  }

  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(302, { Location: '/login.html', 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  if (req.method === 'GET' && !pathname.startsWith('/api/')) {
    await serveStatic(req, res, pathname);
    return;
  }

  if (!pathname.startsWith('/api/')) fail(404, 'Halaman tidak ditemukan.');

  if (req.method !== 'GET') checkOrigin(req);

  if (req.method === 'POST' && pathname === '/api/login') {
    await login(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/reset-password') {
    await requestReset(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/reset-password/confirm') {
    await confirmReset(req, res);
    return;
  }

  const auth = await authenticate(req);

  if (req.method === 'POST' && pathname === '/api/logout') {
    await logout(req, res, auth);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/me') {
    sendJson(res, 200, { user: publicUser(auth.user) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/change-password') {
    await changePassword(req, res, auth);
    return;
  }

  if (auth.user.must_change_password) {
    fail(403, 'Ganti password terlebih dahulu.');
  }

  if (req.method === 'POST' && pathname === '/api/users') {
    await createUser(req, res, auth);
    return;
  }

  if (pathname === '/api/generus' && req.method === 'POST') {
    await createGenerus(req, res, auth);
    return;
  }

  if (pathname === '/api/generus' && req.method === 'GET') {
    await listGenerus(res, auth, url);
    return;
  }

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

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => sendError(res, error));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Server GENSA berjalan di http://127.0.0.1:${PORT}`);
});
```

### server/migrations/002_pertemuan_absensi.sql (sudah ada di repo)

```sql
DO $$
BEGIN
  CREATE TYPE status_absensi AS ENUM ('hadir', 'izin', 'sakit', 'alfa');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS pertemuan (
  id SERIAL PRIMARY KEY,
  tingkat TEXT NOT NULL
    CHECK (tingkat IN ('kelompok', 'desa', 'daerah')),
  kelompok_id INTEGER REFERENCES kelompok(id),
  desa_id INTEGER REFERENCES desa(id),
  jenjang_target jenjang_generus[] NOT NULL
    CHECK (cardinality(jenjang_target) >= 1),
  tanggal DATE NOT NULL,
  dibuat_oleh INTEGER NOT NULL REFERENCES users(id),
  selesai_pada TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (tingkat = 'kelompok' AND kelompok_id IS NOT NULL AND desa_id IS NULL)
    OR (tingkat = 'desa' AND desa_id IS NOT NULL AND kelompok_id IS NULL)
    OR (tingkat = 'daerah' AND kelompok_id IS NULL AND desa_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS absensi (
  id SERIAL PRIMARY KEY,
  pertemuan_id INTEGER NOT NULL REFERENCES pertemuan(id),
  generus_id INTEGER NOT NULL REFERENCES generus(id),
  status status_absensi NOT NULL,
  dicatat_oleh INTEGER NOT NULL REFERENCES users(id),
  koreksi_count INTEGER NOT NULL DEFAULT 0 CHECK (koreksi_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pertemuan_id, generus_id)
);

CREATE INDEX IF NOT EXISTS absensi_pertemuan_id_idx
  ON absensi (pertemuan_id);

CREATE INDEX IF NOT EXISTS absensi_generus_id_idx
  ON absensi (generus_id);

CREATE INDEX IF NOT EXISTS pertemuan_tanggal_idx
  ON pertemuan (tanggal);
```
