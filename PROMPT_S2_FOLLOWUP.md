Berikut isi file yang kamu minta. Setelah membacanya, kerjakan prompt Sesi 2 yang sudah saya kirim sebelumnya (file PROMPT_S2_QR_ABSENSI.md) — jangan tanya lagi, langsung keluarkan output file-file yang diminta di sana (migrasi 002, diff index.js, cetak-qr.html, smoke-test-s2.js).

===== FILE: server/index.js =====
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

===== FILE: server/smoke-test.js =====
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

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

const { Client } = require('pg');

const PORT = Number(process.env.PORT || 3101);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@gensa.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const suffix = crypto.randomBytes(8).toString('hex');

let failures = 0;
let adminCookie;
let kelompokCookie;
let kelompokPassword;
let kelompokEmail;
let kelompokId;
let generusId;

async function request(method, url, body, cookie) {
  const headers = {};

  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;

  const response = await fetch(`${BASE}${url}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    redirect: 'manual',
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    // Assertion pada langkah terkait akan melaporkan respons yang tidak sesuai.
  }

  const setCookie = response.headers.get('set-cookie');
  const sessionCookie = setCookie ? setCookie.split(';')[0] : null;
  return { response, data, cookie: sessionCookie };
}

async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL: ${name} — ${error.message}`);
  }
}

async function findKelompok() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL wajib diisi untuk mencari kelompok contoh.');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT k.id
       FROM kelompok k
       JOIN desa d ON d.id = k.desa_id
       JOIN daerah a ON a.id = d.daerah_id
       WHERE a.nama = $1 AND d.nama = $2 AND k.nama = $3`,
      ['Daerah Contoh', 'Desa Contoh 1', 'Kelompok Contoh A']
    );
    assert.equal(result.rowCount, 1, 'Kelompok contoh tidak ditemukan.');
    return result.rows[0].id;
  } finally {
    await client.end();
  }
}

async function main() {
  if (!ADMIN_PASSWORD || !ADMIN_PASSWORD.trim()) {
    console.error('FAIL: ADMIN_PASSWORD wajib diisi.');
    process.exitCode = 1;
    return;
  }

  await check('Login dengan password salah ditolak', async () => {
    const result = await request('POST', '/api/login', {
      email: ADMIN_EMAIL,
      password: `Salah${crypto.randomBytes(12).toString('hex')}`,
    });
    assert.equal(result.response.status, 401);
  });

  await check('Admin login dan menerima cookie', async () => {
    const result = await request('POST', '/api/login', {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    assert.equal(result.response.status, 200);
    assert.ok(result.cookie);
    assert.equal(result.data.user.must_change_password, true);
    adminCookie = result.cookie;
  });

  await check('GET /api/me tanpa login ditolak', async () => {
    const result = await request('GET', '/api/me');
    assert.equal(result.response.status, 401);
  });

  await check('Admin menuntaskan ganti password awal', async () => {
    assert.ok(adminCookie, 'Cookie admin belum tersedia.');
    const result = await request('POST', '/api/change-password', {
      old_password: ADMIN_PASSWORD,
      new_password: ADMIN_PASSWORD,
    }, adminCookie);
    assert.equal(result.response.status, 200);
  });

  await check('Admin membuat akun kelompok', async () => {
    assert.ok(adminCookie, 'Cookie admin belum tersedia.');
    kelompokId = await findKelompok();
    kelompokEmail = `kelompok-${suffix}@tes.gensa.local`;

    const result = await request('POST', '/api/users', {
      email: kelompokEmail,
      role: 'kelompok',
      kelompok_id: kelompokId,
    }, adminCookie);

    assert.equal(result.response.status, 201);
    assert.equal(result.data.user.role, 'kelompok');
    assert.equal(result.data.user.must_change_password, true);
    assert.equal(typeof result.data.initial_password, 'string');
    kelompokPassword = result.data.initial_password;
  });

  await check('Akun kelompok mengganti password dan login kembali', async () => {
    assert.ok(kelompokEmail && kelompokPassword, 'Akun kelompok belum tersedia.');

    const first = await request('POST', '/api/login', {
      email: kelompokEmail,
      password: kelompokPassword,
    });
    assert.equal(first.response.status, 200);
    assert.equal(first.data.user.must_change_password, true);
    assert.ok(first.cookie);

    const newPassword = `Tes${crypto.randomBytes(16).toString('hex')}`;
    const changed = await request('POST', '/api/change-password', {
      old_password: kelompokPassword,
      new_password: newPassword,
    }, first.cookie);
    assert.equal(changed.response.status, 200);

    const second = await request('POST', '/api/login', {
      email: kelompokEmail,
      password: newPassword,
    });
    assert.equal(second.response.status, 200);
    assert.equal(second.data.user.must_change_password, false);
    assert.ok(second.cookie);
    kelompokCookie = second.cookie;
  });

  await check('Kelompok mengajukan generus tanpa QR', async () => {
    assert.ok(kelompokCookie, 'Cookie kelompok belum tersedia.');

    const result = await request('POST', '/api/generus', {
      nama: `Generus Tes ${suffix}`,
      tanggal_lahir: '2015-05-10',
      kelas_sekolah: 'Kelas 4',
      tingkat: 'sd',
      ortu_nama: 'Orang Tua Tes',
      ortu_hubungan: 'Ibu',
      ortu_hp: '081234567890',
    }, kelompokCookie);

    assert.equal(result.response.status, 201);
    assert.equal(result.data.generus.status, 'pending');
    assert.equal(result.data.generus.qr_token, undefined);
    assert.equal(result.data.generus.kelompok_id, kelompokId);
    generusId = result.data.generus.id;
  });

  await check('Daftar kelompok hanya berisi generus kelompoknya', async () => {
    assert.ok(kelompokCookie && generusId, 'Data tes belum tersedia.');

    const result = await request('GET', '/api/generus', undefined, kelompokCookie);
    assert.equal(result.response.status, 200);
    assert.ok(Array.isArray(result.data.generus));
    assert.ok(result.data.generus.some((item) => item.id === generusId));
    assert.ok(result.data.generus.every((item) => item.kelompok_id === kelompokId));
  });

  await check('Admin menyetujui generus dan membuat QR serta kode', async () => {
    assert.ok(adminCookie && generusId, 'Data tes belum tersedia.');

    const result = await request(
      'POST',
      `/api/generus/${generusId}/approve`,
      {},
      adminCookie
    );
    assert.equal(result.response.status, 200);
    assert.equal(result.data.generus.status, 'approved');
    assert.match(result.data.generus.qr_token, /^[a-f0-9]{32}$/);
    assert.match(result.data.generus.kode_manual, /^[A-HJ-NP-Z2-9]{6}$/);
  });

  await check('Akun daerah tidak dapat mengajukan generus', async () => {
    assert.ok(adminCookie, 'Cookie admin belum tersedia.');

    const email = `daerah-${suffix}@tes.gensa.local`;
    const created = await request('POST', '/api/users', {
      email,
      role: 'daerah',
    }, adminCookie);
    assert.equal(created.response.status, 201);

    const loggedIn = await request('POST', '/api/login', {
      email,
      password: created.data.initial_password,
    });
    assert.equal(loggedIn.response.status, 200);
    assert.ok(loggedIn.cookie);

    const newPassword = `Tes${crypto.randomBytes(16).toString('hex')}`;
    const changed = await request('POST', '/api/change-password', {
      old_password: created.data.initial_password,
      new_password: newPassword,
    }, loggedIn.cookie);
    assert.equal(changed.response.status, 200);

    const result = await request('POST', '/api/generus', {
      nama: 'Tidak boleh dibuat',
    }, loggedIn.cookie);
    assert.equal(result.response.status, 403);
  });

  await check('Percobaan keenam setelah lima login gagal dibatasi', async () => {
    const email = `limit-${suffix}@tes.gensa.local`;

    for (let i = 0; i < 5; i += 1) {
      const result = await request('POST', '/api/login', {
        email,
        password: 'PasswordSalah123',
      });
      assert.equal(result.response.status, 401);
    }

    const limited = await request('POST', '/api/login', {
      email,
      password: 'PasswordSalah123',
    });
    assert.equal(limited.response.status, 429);
  });

  if (failures > 0) {
    console.error(`${failures} pemeriksaan gagal.`);
    process.exitCode = 1;
  } else {
    console.log('Semua pemeriksaan lulus.');
  }
}

main().catch(() => {
  console.error('FAIL: Smoke test tidak dapat diselesaikan.');
  process.exitCode = 1;
});

===== FILE: server/seed.js =====
'use strict';

const { Client } = require('pg');
const bcrypt = require('bcryptjs');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@gensa.local')
    .trim()
    .toLowerCase();

  if (!databaseUrl || !adminPassword || !adminPassword.trim() || !adminEmail) {
    throw new Error('DATABASE_URL, ADMIN_PASSWORD, dan email admin wajib diisi.');
  }

  // Bcrypt hanya memakai 72 byte pertama; tolak agar password tidak terpotong.
  if (Buffer.byteLength(adminPassword, 'utf8') > 72) {
    throw new Error('ADMIN_PASSWORD tidak boleh melebihi 72 byte.');
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      'INSERT INTO daerah (nama) VALUES ($1) ON CONFLICT DO NOTHING',
      ['Daerah Contoh']
    );

    const daerahResult = await client.query(
      'SELECT id FROM daerah WHERE nama = $1',
      ['Daerah Contoh']
    );
    const daerahId = daerahResult.rows[0].id;

    const organisasi = [
      ['Desa Contoh 1', 'Kelompok Contoh A'],
      ['Desa Contoh 2', 'Kelompok Contoh B'],
      ['Desa Contoh 3', 'Kelompok Contoh C'],
    ];

    for (const [namaDesa, namaKelompok] of organisasi) {
      await client.query(
        'INSERT INTO desa (daerah_id, nama) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [daerahId, namaDesa]
      );

      const desaResult = await client.query(
        'SELECT id FROM desa WHERE daerah_id = $1 AND nama = $2',
        [daerahId, namaDesa]
      );

      await client.query(
        'INSERT INTO kelompok (desa_id, nama) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [desaResult.rows[0].id, namaKelompok]
      );
    }

    const adminResult = await client.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [adminEmail, passwordHash, 'admin']
    );

    // Konflik email tidak boleh diam-diam menghasilkan seed tanpa admin.
    if (adminResult.rowCount === 0) {
      const existingUser = await client.query(
        'SELECT role FROM users WHERE lower(email) = lower($1)',
        [adminEmail]
      );
      if (existingUser.rowCount !== 1 || existingUser.rows[0].role !== 'admin') {
        throw new Error('Email admin sudah digunakan oleh akun dengan peran lain.');
      }
    }

    await client.query('COMMIT');
    console.log('Seed selesai: 1 daerah, 3 desa, dan 3 kelompok contoh tersedia.');
    console.log(
      adminResult.rowCount === 1
        ? 'Akun admin dibuat; password wajib diganti saat login pertama.'
        : 'Akun admin sudah ada; kredensialnya tidak diubah.'
    );
    console.log('Seed tidak menambahkan data generus.');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Pertahankan kegagalan awal tanpa menampilkan detail database.
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const knownMessages = new Set([
    'DATABASE_URL, ADMIN_PASSWORD, dan email admin wajib diisi.',
    'ADMIN_PASSWORD tidak boleh melebihi 72 byte.',
    'Email admin sudah digunakan oleh akun dengan peran lain.',
  ]);

  console.error(
    knownMessages.has(error.message)
      ? error.message
      : 'Seed gagal. Periksa konfigurasi dan pastikan migrasi sudah dijalankan.'
  );
  process.exitCode = 1;
});

===== FILE: STATE.md =====
# STATE.md — GENSA (progres terakhir)

> File ini DIBACA Codex di awal setiap sesi dan DITULIS ULANG di akhir
> sesi. Tujuannya: lanjut kerja tanpa baca ulang semua file (hemat token)
> dan progres tidak hilang walau kena limit.

## Status sekarang (2026-11-21 ~00:45 WIB)

- Demo v1 selesai (2026-11-15). File utama:
  `sistem-generus-standalone.html` (= `GENSA_Demo_v1.html`).
- Repo GitHub publik: `RoisChakim/gensa` (commit `c8cb40a0`).
- Codex sudah login di VM Muse (2026-11-20) dan siap dipakai.
- Skill wajib: `docs/skills/web-security.md`, `docs/skills/ponytail.md`,
  `docs/skills/uiux.md` — dibaca dulu sebelum kerja (lihat `AGENTS.md`).
- **MVP SESI 1 SELESAI (2026-11-21 ~00:45 WIB): backend fondasi
  JALAN + smoke test 11/11 LULUS.** Server Node.js + PostgreSQL di
  `server/` (lihat "Yang sudah selesai"). Server TIDAK dibiarkan
  jalan — nyalakan manual: `node server/index.js` dari root repo
  (butuh `.env`, sudah ada, mode 600).
- Akun Admin Utama: `admin@gensa.local` (password awal dibuat acak
  saat seed; WAJIB diganti saat login pertama — flag sudah
  dikembalikan ke true setelah smoke test). Password awal HANYA ada
  di laporan Muse ke pemilik, TIDAK di repo.
- 19 pertanyaan Codex SUDAH dijawab pemilik — lihat
  `docs/PRD_JAWABAN.md` (bagian terakhir). Jangan tanya lagi.

## Yang sudah selesai

- 2026-11-20: Codex review PRD (prompt `PROMPT_PRD_REVIEW.md`).
  Sesi `01a1f99e-7e78-76f0-8693-9ae5b799d069`, model gpt-6.1-terra,
  5.483 token. Codex HANYA review + bertanya, TIDAK membangun.
  Hasil: 19 pertanyaan klarifikasi (di bawah). Limit mingguan
  Codex saat itu sisa 1d 19h.
- CATATAN TEKNIS: Codex di VM ini TIDAK bisa membaca STATE.md /
  skill dan TIDAK bisa menulis STATE.md — alat workspace gagal
  (`codex-code-mode-host` tidak ada di
  `/opt/hatch-image/bin/`). Jadi review ini hanya berdasarkan PRD
  di prompt; pertanyaan di bawah disimpan ke file ini oleh Muse,
  bukan oleh Codex. Perlu diperbaiki sebelum sesi Codex berikutnya
  yang butuh baca/tulis file.
- 2026-11-21 ~00:45: **MVP Sesi 1 selesai — backend fondasi.**
  Model gpt-6.1-terra, reasoning medium. Dua panggilan Codex
  (skema, lalu server via `codex exec resume --last`), total
  ~90 ribu token. Yang dibangun Codex (ditulis ke repo oleh Muse,
  karena Codex tidak bisa tulis file):
  - `server/migrations/001_init.sql` — tabel daerah, desa,
    kelompok, users, generus, sessions + 4 enum. Jenjang kolom
    GENERATED dari tingkat. CHECK: peran↔scope, reject wajib
    catatan, approved wajib qr_token + kode_manual.
  - `server/seed.js` — 1 daerah + 3 desa + 3 kelompok contoh,
    1 akun Admin Utama (password dari env, wajib ganti saat
    login pertama). Idempotent. Generus KOSONG.
  - `server/db.js`, `server/index.js` — server HTTP Node stdlib
    + pg + bcryptjs (tanpa Express/ORM). Endpoint: login/logout,
    /api/me, buat akun (admin saja, password awal acak 12 karakter),
    ganti password, reset password (token HMAC 1 jam, link hanya
    di console server — SMTP belum ada), ajukan generus (kelompok
    saja), list generus ikut scope, approve/reject generus (admin,
    approve isi qr_token 32 hex + kode_manual 6 karakter),
    ajukan hapus + setuju/tolak hapus (admin). Rate limit login
    5 gagal/15 menit → 429. Cookie HttpOnly SameSite=Lax.
    Akun yang wajib ganti password hanya bisa /api/me, logout,
    ganti password.
  - `server/public/login.html` — halaman login minimal palet GENSA.
  - `server/smoke-test.js` — 11 pemeriksaan, SEMUA LULUS
    (login salah 401, admin login + cookie, /api/me tanpa login 401,
    ganti password awal, buat akun kelompok, kelompok ajukan generus
    pending tanpa QR, list ikut scope, admin approve isi QR+kode,
    daerah tidak bisa ajukan generus 403, rate limit 429).
  - `server/migrate.js` — runner migrasi (ditambahkan Muse).
  - `.env.example` diperbarui (DATABASE_URL, PORT 3101,
    SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD). `.env` asli di
    root repo, mode 600, gitignored — TIDAK ada rahasia di repo.
  - Migrasi + seed SUDAH dijalankan di database asli dan
    terverifikasi: 1 daerah, 3 desa, 3 kelompok, 1 admin
    (must_change_password=true), 0 generus awal. Data tes dari
    smoke test masih ada (2 akun @tes.gensa.local + 1 generus
    approved "Generus Tes ..." dengan kode_manual) — hapus manual
    bila mengganggu.
  - Halaman reset password (`/reset-password.html`) BELUM dibuat;
    token reset baru bisa dipakai lewat endpoint confirm.
  - `updated_at` tidak ada trigger — di-SET manual di tiap UPDATE.
  - Penolakan hapus menyimpan catatan di `alasan_penolakan`; belum
    ada riwayat keputusan terpisah.
- CARA KERJA CODEX DI VM INI (terbukti jalan 2026-11-21):
  `codex exec` dengan stdin dari FILE (`- < prompt.md`, JANGAN dari
  pipe harness — stdin yang tidak EOF bikin Codex gantung), flag
  `-m gpt-6.1-terra -c model_reasoning_effort="medium"`,
  output ditangkap `-o /tmp/codex-*.txt`, lalu Muse yang menulis
  file-nya ke repo. Sesi lanjutan pakai `codex exec resume --last`
  (tanpa `--approve-for-me`, flag itu tidak dikenal resume).
  Prompt build: `PROMPT_S1_SCHEMA.md`, `PROMPT_S1_SERVER.md`.
  `codex-code-mode-host` TETAP hilang dan `/opt/hatch-image/bin`
  read-only — jangan coba install binary dari tarball npm (gagal
  cek risiko eksekusi). Model terbaik yang tersedia:
  gpt-6.1-terra (prioritas 1, generasi terbaru); jangan pakai yang
  murah (gpt-6-luna, gpt-reserve).

## Yang sedang dikerjakan

- MVP Sesi 2 (berikutnya): QR + absensi (cetak QR, scan QR/manual,
  status hadir/izin/sakit/alfa, koreksi 1x dalam 24 jam), lalu
  Sesi 3: jadwal, Sesi 4: laporan Word. Login Google, absen offline,
  dan link izin DITUNDA (sesuai PRD_JAWABAN.md).
- Satu perubahan kecil per sesi. Prompt sesi berikut ditulis ke
  `PROMPT_S2_*.md` dulu, baru dijalankan ke Codex.

## Pertanyaan Codex atas PRD (2026-11-20)

Dua hal yang perlu dipastikan lebih dulu: jawaban no. 1 menyatakan
penambahan generus hanya oleh Kelompok, sedangkan no. 2 juga
mengizinkan Desa; dan cara pembuatan akun masih bertentangan antara
dibuat Admin dan pendaftaran khusus per peran.

1. **Cakupan minggu ini:** Bagian mana yang wajib selesai minggu
   ini? Jika belum ditentukan, apakah MVP boleh difokuskan pada akun
   dan peran, data generus serta persetujuannya, jadwal, dan absensi;
   sementara materi, laporan Word, dan fitur lain menyusul?
2. **Akun dan organisasi:** Siapa yang membuat akun Admin Utama,
   Daerah, Desa, dan Kelompok? Apakah halaman pendaftaran hanya
   mengirim permohonan akun yang harus disetujui, atau Admin langsung
   membuat semua akun? Apakah satu akun boleh memiliki beberapa peran
   atau wilayah?
3. **Batas akses:** Apakah setiap pengurus hanya boleh melihat dan
   mengubah data dalam wilayahnya? Untuk Daerah yang "bisa semuanya
   seperti Admin", tindakan apa saja yang tetap khusus Admin Utama,
   selain persetujuan dan penambahan generus?
4. **Penambahan generus:** Apakah Kelompok **dan** Desa sama-sama
   boleh mengajukan generus baru? Ketika Desa mengajukan, apakah
   generus harus langsung dipilihkan Kelompok? Siapa yang boleh
   mengubah data generus setelah disetujui?
5. **Penghapusan dan perpindahan:** Selain Desa, siapa yang boleh
   mengajukan penghapusan? Apakah generus yang keluar sebaiknya
   dinonaktifkan agar riwayat absensi tetap ada? Bagaimana proses
   perpindahan generus antar-Kelompok atau Desa, dan apakah perlu
   persetujuan?
6. **Persetujuan:** Apakah Admin Utama dapat menyetujui atau menolak
   dengan catatan, dan apakah pemohon perlu mendapat pemberitahuan?
   Apakah ada batasan siapa yang dapat melihat alasan penghapusan?
7. **Data generus dan orang tua:** Kolom apa saja yang wajib diisi?
   Untuk orang tua, apakah diperlukan nama, hubungan, dan nomor
   telepon saja, atau juga data lain? Apakah satu generus dapat
   memiliki lebih dari satu orang tua atau wali?
8. **Jenjang dan PAUD–SD:** Apa saja jenjang utama yang digunakan,
   termasuk hubungan caberawit, pra remaja, remaja, dan PAUD–SD?
   Apakah subkelas PAUD–SD berlaku sama di semua wilayah? Apakah
   perubahan kelas seorang generus perlu menyimpan riwayat?
9. **Login:** Apakah Google login wajib untuk MVP atau pilihan
   tambahan? Jika dipakai, apakah hanya email yang sudah didaftarkan
   Admin yang boleh masuk? Apakah semua pengguna pasti mempunyai
   alamat email untuk reset password?
10. **QR generus:** Saat QR hilang, apakah QR lama harus
    dinonaktifkan dan diterbitkan kode baru? Ini perlu dipastikan
    karena QR disebut tidak dapat berubah. Apakah QR harus dapat
    dicetak atau disimpan sebagai gambar?
11. **Pemindaian absensi:** Apakah hanya pengurus pada tingkat
    penyelenggara yang boleh memindai, dan apakah mereka hanya boleh
    memindai generus yang termasuk sasaran kegiatan tersebut? Apakah
    diperlukan status hadir, izin, sakit, dan alfa; serta bolehkah
    pengurus mengoreksi hasil setelah kegiatan?
12. **Penggunaan offline:** Perangkat apa yang harus mendukung
    pemindaian offline, dan apakah pengurus harus login serta
    mengunduh jadwal dan data yang diperlukan sebelum kehilangan
    koneksi? Jika dua perangkat mencatat generus yang sama atau
    memberi status berbeda, aturan mana yang menang?
13. **Jadwal:** Untuk jadwal berulang, pola apa yang diperlukan —
    misalnya harian, mingguan, atau bulanan? Apakah satu pertemuan
    dalam rangkaian boleh diubah atau dibatalkan sendiri? Bagaimana
    peserta ditentukan jika jenjang atau wilayahnya berubah?
14. **Izin publik:** Siapa yang boleh membuka tautan izin — siapa
    saja yang memiliki tautan, atau harus login? Apakah pengirim
    memilih kegiatan dan tanggal tertentu, dan apakah izin perlu
    disetujui pengurus? Bagaimana mencegah orang memilih nama orang
    lain atau mengirim izin berulang?
15. **Persentase kehadiran:** Apakah rumusnya **jumlah hadir ÷
    jumlah pertemuan yang wajib diikuti × 100%**? Bagaimana izin,
    sakit, kegiatan yang dibatalkan, dan generus yang baru bergabung
    dihitung? Apakah laporan memakai tanggal pertemuan atau waktu
    data tersinkron?
16. **Materi dan penilaian:** Siapa yang membuat daftar materi dan
    tugas hafalan, dan apakah materi berbeda menurut jenjang atau
    wilayah? Apakah pengurus dapat memperbarui hasil berulang kali,
    dan apakah riwayat perubahan perlu disimpan? Untuk persentase
    Hasil, apakah rumusnya jumlah tugas berstatus *Hafal* dibagi
    seluruh tugas hafalan yang berlaku?
17. **Laporan Word:** Laporan apa saja yang wajib tersedia pada
    tahap awal, siapa yang boleh mengunduhnya, dan apakah perlu kop,
    tanda tangan, atau format contoh? Apakah laporan Daerah perlu
    rincian per generus atau cukup rekap per wilayah dan kegiatan?
18. **Server dan PWA:** Apakah server, domain, sertifikat HTTPS,
    layanan email, dan pencadangan sudah tersedia? Perangkat dan
    browser apa yang harus didukung, terutama untuk instalasi PWA
    dan pemindaian kamera?
19. **Privasi dan retensi:** Siapa yang boleh melihat nomor telepon
    orang tua dan alasan izin? Berapa lama data dan riwayat perlu
    disimpan, terutama untuk generus yang sudah keluar?

## Langkah berikut

- Sesi 2: QR + absensi. Buat `PROMPT_S2_QR_ABSENSI.md` (konteks
  inline, karena Codex tidak bisa baca file), jalankan Codex,
  tulis file-nya, tes, simpan ke STATE.md.
- Jangan push ke GitHub dari VM — repo `RoisChakim/gensa` di-push
  pemilik sendiri (konektor GitHub ditolak 403 saat membuat repo).
- Aturan dari pemilik: SETIAP sebelum prompt ke Codex, kabari
  pemilik dulu. Sesi 1 ini dijalankan atas jadwal yang pemilik
  buat sendiri (limit kembali ~23:56 WIB).

## Catatan / keputusan pengguna

- Palet: krem hangat `#F6F1E9`, coklat `#8A5A33`, sage `#5F7A57/#7C9A6E`.
  Tanpa latar gelap, tanpa neon.
- Peran Daerah baca-saja masih tafsiran, belum dikonfirmasi.
- Struktur kelas pra remaja/remaja A–C, usia nikah A–B masih tebakan.
- Jangan masukkan rahasia ke kode/repo.

===== FILE: docs/skills/web-security.md =====
---
name: web-security
description: >
  Keamanan web anti-bobol untuk aplikasi web (GENSA dan sejenisnya). Pakai ini
  setiap kali menulis, mengubah, atau mereview kode web: login, peran (role),
  form, database, dan apa pun yang menyentuh data pengguna. Tujuannya satu:
  web tidak bisa dibobol lewat input, akun, atau celah umum.
---

# Keamanan Web (Anti-Bobol)

Aturan ini tidak boleh dipotong demi kecepatan atau kemudahan. Kalau ada
konflik antara "gampang" dan "aman", pilih aman, lalu jelaskan ke pengguna.

## 1. Jangan pernah percaya input pengguna

- Semua data dari form, URL, QR, file upload, dan API adalah input yang
  belum dipercaya — walau datang dari pengguna yang sudah login.
- Validasi di server, bukan cuma di browser. Cek di browser itu untuk
  kenyamanan saja; penyerang bisa melewatinya dengan mudah.
- Tolak yang tidak sesuai aturan (tipe, panjang, format), jangan coba
  "membersihkan" lalu tetap dipakai.

## 2. Cegah XSS (script jahat lewat input)

- Jangan pernah menampilkan data pengguna dengan `innerHTML` atau
  sejenisnya tanpa escape. Pakai `textContent` atau escape HTML.
- Jangan simpan lalu tampilkan HTML mentah dari pengguna.
- Kalau butuh menampilkan format, pakai daftar tag yang diizinkan saja,
  sisanya dibuang.

## 3. Cegah SQL injection & kebocoran database

- Jangan pernah gabungkan input pengguna ke query dengan tempel string.
  Pakai parameter / prepared statement.
- Akun database untuk aplikasi hanya boleh akses tabel yang ia butuhkan,
  bukan semua.
- Pesan error jangan bocorkan struktur database (nama tabel, kolom, query).

## 4. Login & peran (role) harus dicek di server

- Password jangan disimpan polos. Pakai hashing yang kuat (misalnya
  bcrypt/argon2) + salt.
- Session/token harus acak, punya masa berlaku, dan bisa dicabut.
- Peran (Admin, Daerah, Desa, Kelompok) dicek di server untuk SETIAP
  aksi — bukan cuma disembunyikan di tampilan. Menyembunyikan tombol
  bukan pengaman.
- Satu kelompok hanya boleh lihat/ubah datanya sendiri. Cek kepemilikan
  data di server sebelum tampilkan atau ubah.
- Batasi percobaan login (misalnya kunci sementara setelah beberapa kali
  gagal) supaya tidak bisa ditebak paksa (brute force).

## 5. Rahasia jangan masuk ke kode

- API key, password, token, dan kredensial JANGAN ditulis di kode,
  apalagi di kode yang dikirim ke browser atau di-push ke GitHub.
- Pakai environment variable / secret store. Kalau rahasia pernah
  bocor ke repo, anggap sudah diketahui orang dan segera ganti.
- Jangan tampilkan detail error server ke pengguna (stack trace,
  path file, versi library).

## 6. File upload & QR

- Upload hanya terima tipe file yang diizinkan, cek isi file bukan
  cuma ekstensinya, dan batasi ukurannya.
- File upload jangan bisa dijalankan sebagai kode. Simpan di luar
  folder yang bisa dieksekusi, dan beri nama acak.
- QR absensi hanya berisi ID acak yang tidak bisa ditebak, bukan data
  pribadi. Cek di server bahwa QR itu masih berlaku dan milik
  kelompok yang benar.

## 7. Komunikasi & sesi

- Pakai HTTPS selalu. Jangan kirim password/token lewat HTTP.
- Cookie sesi: `HttpOnly`, `Secure`, `SameSite`.
- Logout harus benar-benar menghapus sesi di server.

## 8. Sebelum selesai, cek ini

- [ ] Semua form divalidasi di server.
- [ ] Tidak ada `innerHTML` dengan data pengguna.
- [ ] Tidak ada query tempel string.
- [ ] Setiap aksi dicek peran + kepemilikan datanya di server.
- [ ] Tidak ada rahasia di kode / repo.
- [ ] Pesan error tidak bocorkan info dalam.

Kalau ada satu yang belum terpenuhi, sebutkan dengan jelas apa risikonya
dan jangan klaim web sudah aman.

===== FILE: docs/skills/ponytail.md =====
---
name: ponytail
description: >
  Lazy senior dev mode: the smallest change that fully solves the task, and a
  reply a busy human understands in one read. Use on any coding task (writing,
  fixing, refactoring, reviewing, choosing dependencies) and when the user says
  "ponytail", "be lazy", "simplest solution", "yagni", or complains about
  over-engineering or bloat. Levels: lite, full (default), ultra.
argument-hint: "[lite|full|ultra|off]"
license: MIT
---

# Ponytail

You are a lazy senior developer. The best code is the code never written. You solve the whole problem with the least new code. End your reply with one or two lines: what you skipped or did not check, and any risk the user must know.

Active for the whole session until the user says "stop ponytail" or "normal mode". Switch level: `/ponytail lite|full|ultra`.

## Before you write

Read the task and the code it touches. List every place your change must reach: callers, tests, fixtures, config, exports. Check what your change could break for users: data it would destroy or expose, callers that stop working. That is scope. Extra features are not.

## The smallest complete change

Take the first option that fully works:

1. Does it need to exist? Skip features, options and flexibility nobody asked for, and name them in one line. A vague request ("build me X") gets the smallest version that does the core job.
2. Already in this codebase (a helper, component, service, pattern)? Use it the way the surrounding code does.
3. Standard library or a platform feature? Use it, unless the project has its own. A house component beats a native widget.
4. An installed dependency? Use it. Never add a dependency for a few lines.
5. Can it be one line a reader gets at a glance? One line.
6. Otherwise: the minimum code that works.

- Be lazy about the solution, never about the change itself: finish every part the task needs, including the callers, tests and fixtures your change breaks.
- No abstraction, wrapper, type conversion, option, config, boilerplate or "for later" code nobody asked for. Keep values in the form the platform already gives you. Deletion beats addition. Keep the structure the codebase already has: its layers, interfaces and conventions.
- The shortest working diff wins, once you know everything it must touch. A one-liner that needs decoding is not short.
- Comment only the why the code cannot show, in one line.
- Bug fix: before you edit, grep every caller of the function you touch, then fix the root cause once in the shared code.
- Code you move or merge keeps its error handling and validation.
- Between options of equal size, take the one that is correct on edge cases.
- Lazy code without its check is unfinished: new non-trivial logic (a branch, a loop, a parser, money or security, or a whole new script or app) leaves one small test or an assert-based self-check. Trivial changes need none.
- A shortcut with a known limit gets a code comment in this form: `shortcut: <the limit>, <when to upgrade>`.

Never cut: validation at trust boundaries, error handling that prevents data loss, security, accessibility, the calibration real hardware needs, anything the user asked for.

## Levels

| Level | Behavior |
|-------|----------|
| **lite** | Build what was asked. Name the smaller option in one line and let the user pick. |
| **full** | The rules above. Default. |
| **ultra** | Also question the request: before building, push back on any part the need does not justify. |

===== FILE: docs/skills/uiux.md =====
---
name: uiux
description: >
  Prinsip UI/UX untuk aplikasi web GENSA (dan sejenisnya). Pakai ini setiap
  kali membuat atau mengubah tampilan: layout, warna, teks, form, dan alur.
  Tujuannya: tampilan yang santai, jelas, dan gampang dipakai di HP oleh
  siapa pun — bukan yang terlihat "AI banget".
---

# UI/UX (GENSA)

## Palet & rasa (jangan diubah tanpa persetujuan pengguna)

- Latar: krem hangat `#F6F1E9`.
- Tombol utama: coklat `#8A5A33`, tanpa gradasi.
- Aksen: sage `#5F7A57` / `#7C9A6E`.
- JANGAN pakai latar gelap dan JANGAN pakai lime neon / warna neon.
- Satu gaya untuk semua halaman. Jangan tiap halaman beda gaya.

## Jelas dulu, bagus kemudian

- Satu layar, satu tugas utama. Jangan tumpuk banyak hal dalam satu layar.
- Judul dan tombol pakai kata kerja yang jelas ("Tambah Generus",
  "Cetak QR", "Kirim Laporan"), bukan kata yang ambigu.
- Bahasa Indonesia yang natural dan sederhana, seperti ngomong biasa.
  Bukan bahasa kaku dan bukan gaya AI.
- Angka penting (jumlah generus, persen kehadiran) tampil besar dan
  langsung kelihatan, jangan disembunyikan di balik klik.

## Gampang dipakai di HP

- Utamakan HP dulu (mobile-first). Semua harus bisa dipakai dengan
  satu tangan.
- Tombol dan area sentuh cukup besar, jangan terlalu rapat.
- Form sedikit saja: hanya minta data yang benar-benar dibutuhkan.
- Kalau ada langkah panjang, pecah jadi beberapa langkah pendek
  dengan penanda "Langkah 1 dari 3".
- Teks jangan terlalu kecil. Kontras cukup supaya terbaca di bawah
  sinar matahari.

## Konsisten

- Pakai komponen yang sama untuk hal yang sama (tombol, kartu, tabel,
  form). Jangan buat gaya baru untuk tiap halaman.
- Warna punya arti yang tetap: satu warna untuk aksi utama, satu
  untuk bahaya/hapus, satu untuk info. Jangan ganti-ganti.
- Pesan sukses/gagal selalu jelas dan muncul di tempat yang sama,
  dengan kata yang dimengerti ("Data tersimpan", bukan "Operasi
  berhasil 200").

## Jangan bikin bingung

- Jangan sembunyikan fungsi penting di balik menu yang dalam.
- Kalau suatu aksi tidak bisa dilakukan (misalnya peran Daerah
  baca-saja), jelaskan kenapa — jangan cuma tombolnya hilang tanpa
  penjelasan.
- Kosong itu bukan error: kalau belum ada data, tampilkan pesan
  yang ramah dan ajakan yang jelas ("Belum ada generus. Tambah dulu."),
  bukan halaman kosong atau error.
- Konfirmasi dulu sebelum hapus data. Tuliskan apa yang akan hilang.

## Sebelum selesai, cek ini

- [ ] Palet sesuai (krem, coklat, sage; tanpa gelap/neon).
- [ ] Bisa dipakai penuh dari HP.
- [ ] Teks natural, bukan gaya AI.
- [ ] Satu layar, satu tugas utama.
- [ ] Pesan sukses/gagal jelas dan ramah.
- [ ] Aksi hapus selalu minta konfirmasi.

Kalau ada yang belum terpenuhi, sebutkan dan perbaiki sebelum
diserahkan ke pengguna.
