'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');

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
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ||
  `http://127.0.0.1:${PORT}/api/auth/google/callback`;
const SESSION_SECONDS = 12 * 60 * 60;
const RESET_SECONDS = 60 * 60;
const MAX_BODY = 100 * 1024;
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const MANUAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const ROLES = new Set(['admin', 'daerah', 'desa', 'kelompok']);
const TINGKAT = new Set(['paud', 'sd', 'smp', 'sma', 'kuliah', 'kerja']);
const STATUSES = new Set(['pending', 'approved', 'rejected', 'delete_pending']);
const JENJANG = new Set(['caberawit', 'pra_remaja', 'remaja', 'usia_nikah']);
const STATUS_ABSENSI = new Set(['hadir', 'izin', 'sakit', 'alfa']);
const TINGKAT_PERTEMUAN = new Set(['kelompok', 'desa', 'daerah']);
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

function buatStateGoogle() {
  const payload = Buffer.from(JSON.stringify({
    nonce: crypto.randomBytes(16).toString('hex'),
    exp: Math.floor(Date.now() / 1000) + 600,
  })).toString('base64url');

  return `${payload}.${resetSignature(payload).toString('base64url')}`;
}

function periksaStateGoogle(value) {
  try {
    const state = requiredString(value, 'State', 2048);
    const parts = state.split('.');

    if (
      parts.length !== 2 ||
      !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))
    ) {
      throw new Error('State tidak valid');
    }

    const [payload, signature] = parts;
    const received = Buffer.from(signature, 'base64url');
    const expected = resetSignature(payload);

    if (
      received.length !== expected.length ||
      !crypto.timingSafeEqual(received, expected)
    ) {
      throw new Error('Tanda tangan tidak valid');
    }

    const data = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    );

    if (
      !data ||
      !Number.isSafeInteger(data.exp) ||
      data.exp <= Date.now() / 1000 ||
      typeof data.nonce !== 'string' ||
      !/^[a-f0-9]{32}$/.test(data.nonce)
    ) {
      throw new Error('State tidak berlaku');
    }

    return data;
  } catch {
    fail(403, 'Tautan login sudah tidak berlaku.');
  }
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

// pg mengembalikan kolom jenjang_generus[] sebagai string '{a,b}'
// karena OID array enum kustom tidak dikenal parser bawaannya.
// Ubah ke array JS supaya respons API konsisten.
function normalisasiPertemuan(pertemuan) {
  if (!pertemuan) return pertemuan;
  if (typeof pertemuan.jenjang_target === 'string') {
    const isi = pertemuan.jenjang_target.slice(1, -1);
    pertemuan.jenjang_target = isi ? isi.split(',') : [];
  }
  return pertemuan;
}

function pertemuanScopeWhere(auth) {
  return {
    sql: `(
      $1::text IN ('admin', 'daerah')
      OR (
        $1::text = 'desa'
        AND (
          p.desa_id = $2::integer
          OR EXISTS (
            SELECT 1 FROM kelompok k
            WHERE k.id = p.kelompok_id AND k.desa_id = $2::integer
          )
        )
      )
      OR (
        $1::text = 'kelompok'
        AND (
          p.kelompok_id = $3::integer
          OR p.desa_id = (
            SELECT k.desa_id FROM kelompok k WHERE k.id = $3::integer
          )
          OR p.tingkat = 'daerah'
        )
      )
    )`,
    values: [auth.user.role, auth.user.desa_id, auth.user.kelompok_id],
  };
}

function canManagePertemuan(auth, pertemuan) {
  const user = auth.user;

  if (user.role === 'admin') return;

  if (
    user.role === pertemuan.tingkat &&
    (
      (user.role === 'kelompok' && user.kelompok_id === pertemuan.kelompok_id) ||
      (user.role === 'desa' && user.desa_id === pertemuan.desa_id) ||
      user.role === 'daerah'
    )
  ) {
    return;
  }

  fail(403, 'Anda tidak memiliki akses untuk mengelola pertemuan ini.');
}

async function generusInScope(pertemuan, generusId, client = db) {
  const result = await client.query(
    `SELECT g.id, g.kelompok_id, g.nama, g.kelas_sekolah, g.jenjang, g.status
     FROM generus g
     JOIN kelompok k ON k.id = g.kelompok_id
     WHERE g.id = $1
       AND g.status = 'approved'
       AND g.jenjang = ANY($2::jenjang_generus[])
       AND (
         ($3::text = 'kelompok' AND g.kelompok_id = $4::integer)
         OR ($3::text = 'desa' AND k.desa_id = $5::integer)
         OR $3::text = 'daerah'
       )
     FOR SHARE OF g, k`,
    [
      generusId, pertemuan.jenjang_target, pertemuan.tingkat,
      pertemuan.kelompok_id, pertemuan.desa_id,
    ]
  );

  return result.rows[0] || null;
}

function validPertemuanDate(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith('0000-')
  ) {
    fail(400, 'Tanggal pertemuan tidak valid.');
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    fail(400, 'Tanggal pertemuan tidak valid.');
  }

  return value;
}

function generusScopeWhere(auth) {
  return {
    sql: `(
      $1::text IN ('admin', 'daerah')
      OR ($1::text = 'desa' AND k.desa_id = $2::integer)
      OR ($1::text = 'kelompok' AND g.kelompok_id = $3::integer)
    )`,
    values: [auth.user.role, auth.user.desa_id, auth.user.kelompok_id],
  };
}

async function hitungLaporan(auth, dari, sampai, rincian) {
  if (
    typeof dari !== 'string' ||
    typeof sampai !== 'string'
  ) {
    fail(400, 'Tanggal awal dan tanggal akhir wajib diisi dengan format YYYY-MM-DD yang valid.');
  }

  validPertemuanDate(dari);
  validPertemuanDate(sampai);

  if (dari > sampai) {
    fail(400, 'Tanggal awal tidak boleh setelah tanggal akhir.');
  }

  const jumlahHari =
    (Date.parse(`${sampai}T00:00:00Z`) -
      Date.parse(`${dari}T00:00:00Z`)) / 86400000 + 1;

  if (jumlahHari > 62) {
    fail(400, 'Rentang laporan maksimal 62 hari.');
  }

  const scope = generusScopeWhere(auth);
  const scopePertemuan = pertemuanScopeWhere(auth);
  const values = [...scope.values, dari, sampai];

  // Kedua helper scope memakai parameter yang sama:
  // $1 = role, $2 = desa_id, $3 = kelompok_id.
  const [hasilGenerus, hasilKelompok, hasilWilayah] = await Promise.all([
    db.query(
      `
        SELECT
          g.id,
          g.nama,
          g.kelompok_id,
          k.nama AS kelompok,
          d.nama AS desa,
          g.kelas_sekolah,
          g.jenjang,
          COUNT(p.id) AS wajib,
          COUNT(p.id) FILTER (WHERE a.status = 'hadir') AS hadir,
          COUNT(p.id) FILTER (WHERE a.status IN ('izin', 'sakit')) AS izin,
          COUNT(p.id) FILTER (WHERE a.status = 'alfa') AS alfa
        FROM generus g
        JOIN kelompok k ON k.id = g.kelompok_id
        JOIN desa d ON d.id = k.desa_id
        LEFT JOIN absensi a ON a.generus_id = g.id
        LEFT JOIN pertemuan p
          ON p.id = a.pertemuan_id
          AND p.selesai_pada IS NOT NULL
          AND p.tanggal BETWEEN $4::date AND $5::date
          AND ${scopePertemuan.sql}
          AND g.jenjang = ANY(p.jenjang_target)
          AND p.tanggal >= DATE(g.decided_at)
        WHERE g.status = 'approved'
          AND ${scope.sql}
        GROUP BY
          g.id, g.nama, g.kelompok_id, k.nama, d.nama,
          g.kelas_sekolah, g.jenjang
        ORDER BY k.nama, g.jenjang, g.nama, g.id
      `,
      values,
    ),
    db.query(
      `
        SELECT
          k.id,
          k.nama AS kelompok,
          d.nama AS desa,
          COUNT(p.id) AS pertemuan
        FROM kelompok k
        JOIN desa d ON d.id = k.desa_id
        LEFT JOIN pertemuan p
          ON p.selesai_pada IS NOT NULL
          AND p.tanggal BETWEEN $4::date AND $5::date
          AND (
            (p.tingkat = 'kelompok' AND p.kelompok_id = k.id)
            OR (p.tingkat = 'desa' AND p.desa_id = k.desa_id)
            OR p.tingkat = 'daerah'
          )
        WHERE
          $1::text IN ('admin', 'daerah')
          OR ($1::text = 'desa' AND k.desa_id = $2::integer)
          OR ($1::text = 'kelompok' AND k.id = $3::integer)
        GROUP BY k.id, k.nama, d.nama
        ORDER BY d.nama, k.nama, k.id
      `,
      values,
    ),
    db.query(
      `
        SELECT CASE
          WHEN $1::text = 'kelompok'
            THEN (SELECT nama FROM kelompok WHERE id = $3::integer)
          WHEN $1::text = 'desa'
            THEN (SELECT nama FROM desa WHERE id = $2::integer)
          ELSE 'Seluruh Daerah'
        END AS wilayah
      `,
      scope.values,
    ),
  ]);

  const kelompokTotal = new Map();

  const barisGenerus = hasilGenerus.rows.map((row) => {
    const hadir = Number(row.hadir);
    const izin = Number(row.izin);
    const alfa = Number(row.alfa);
    const wajib = Number(row.wajib);
    const persen = wajib > 0
      ? Math.round(hadir / wajib * 1000) / 10
      : null;

    const key = String(row.kelompok_id);
    let total = kelompokTotal.get(key);

    if (!total) {
      total = { generus: 0, jumlahPersen: 0, jumlahWajib: 0 };
      kelompokTotal.set(key, total);
    }

    total.generus += 1;

    if (persen !== null) {
      total.jumlahPersen += persen;
      total.jumlahWajib += 1;
    }

    return {
      id: row.id,
      nama: row.nama,
      kelompok: row.kelompok,
      desa: row.desa,
      kelas_sekolah: row.kelas_sekolah,
      jenjang: row.jenjang,
      hadir,
      izin,
      alfa,
      wajib,
      persen,
    };
  });

  const rekap = hasilKelompok.rows.map((row) => {
    const total = kelompokTotal.get(String(row.id));

    return {
      kelompok: row.kelompok,
      desa: row.desa,
      generus: total ? total.generus : 0,
      pertemuan: Number(row.pertemuan),
      rata_persen: total && total.jumlahWajib > 0
        ? Math.round(total.jumlahPersen / total.jumlahWajib * 10) / 10
        : null,
    };
  });

  const laporan = {
    periode: { dari, sampai },
    wilayah: hasilWilayah.rows[0]?.wilayah || auth.user.role,
    rekap,
  };

  if (rincian) {
    laporan.rincian = barisGenerus;
  }

  return laporan;
}

async function buatLaporanWord(laporan) {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    HeadingLevel,
    AlignmentType,
    WidthType,
  } = require('docx');

  const labelJenjang = {
    caberawit: 'Caberawit',
    pra_remaja: 'Pra Remaja',
    remaja: 'Remaja',
    usia_nikah: 'Usia Nikah',
  };

  function tanggal(value) {
    const [tahun, bulan, hari] = value.split('-');
    return `${hari}/${bulan}/${tahun}`;
  }

  function persen(value) {
    return value === null
      ? '-'
      : value.toLocaleString('id-ID', {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        });
  }

  function sel(value, header) {
    return new TableCell({
      ...(header ? { shading: { fill: 'F6F1E9' } } : {}),
      children: [
        new Paragraph({
          children: [
            new TextRun({
              text: value == null ? '-' : String(value),
              bold: header,
              size: 18,
              ...(header ? { color: '8A5A33' } : {}),
            }),
          ],
        }),
      ],
    });
  }

  function tabel(headers, rows) {
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: headers.map((value) => sel(value, true)),
        }),
        ...rows.map((row) => new TableRow({
          children: row.map((value) => sel(value, false)),
        })),
      ],
    });
  }

  const sekarang = new Date();
  const dibuat = [
    String(sekarang.getDate()).padStart(2, '0'),
    String(sekarang.getMonth() + 1).padStart(2, '0'),
    sekarang.getFullYear(),
  ].join('/');

  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'Laporan Kehadiran Generus',
          bold: true,
          color: '8A5A33',
        }),
      ],
    }),
    new Paragraph({
      text: `Periode: ${tanggal(laporan.periode.dari)} – ${tanggal(laporan.periode.sampai)}`,
    }),
    new Paragraph({ text: `Wilayah: ${laporan.wilayah}` }),
    new Paragraph({ text: `Dibuat: ${dibuat}` }),
    new Paragraph({
      text: 'Rekap Kehadiran',
      heading: HeadingLevel.HEADING_1,
    }),
    tabel(
      ['Kelompok', 'Desa', 'Generus', 'Pertemuan', 'Rata-rata % Hadir'],
      laporan.rekap.map((row) => [
        row.kelompok,
        row.desa,
        row.generus,
        row.pertemuan,
        persen(row.rata_persen),
      ]),
    ),
  ];

  if (laporan.rincian) {
    children.push(
      new Paragraph({
        text: 'Rincian per Generus',
        heading: HeadingLevel.HEADING_1,
      }),
      tabel(
        [
          'Nama', 'Kelompok', 'Kelas', 'Jenjang',
          'Hadir', 'Izin', 'Alfa', 'Wajib', '% Hadir',
        ],
        laporan.rincian.map((row) => [
          row.nama,
          row.kelompok,
          row.kelas_sekolah,
          labelJenjang[row.jenjang] || row.jenjang,
          row.hadir,
          row.izin,
          row.alfa,
          row.wajib,
          persen(row.persen),
        ]),
      ),
    );
  }

  const document = new Document({
    sections: [{ children }],
  });

  return Packer.toBuffer(document);
}

function tugasScopeWhere(auth) {
  if (auth.user.role === 'kelompok') {
    return {
      sql: '(t.kelompok_id = $1 OR t.kelompok_id IS NULL)',
      values: [auth.user.kelompok_id],
    };
  }

  if (auth.user.role === 'desa') {
    return {
      sql: `(
        t.kelompok_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM kelompok kt
          WHERE kt.id = t.kelompok_id
            AND kt.desa_id = $1
        )
      )`,
      values: [auth.user.desa_id],
    };
  }

  if (auth.user.role === 'admin' || auth.user.role === 'daerah') {
    return { sql: 'TRUE', values: [] };
  }

  fail(403, 'Akses tidak diizinkan.');
}

function materiPositiveId(value, label) {
  const validType =
    typeof value === 'number' ||
    (typeof value === 'string' && /^[0-9]+$/.test(value));
  const id = validType ? Number(value) : NaN;

  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) {
    fail(400, `${label} harus berupa angka positif yang valid.`);
  }

  return id;
}

async function readMateriBody(req) {
  const body = await readJson(req);

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail(400, 'Data tidak valid.');
  }

  return body;
}

async function getMateriTugas(db, auth) {
  const scope = tugasScopeWhere(auth);
  const result = await db.query(
    `SELECT t.*, k.nama AS kelompok_nama
     FROM tugas t
     LEFT JOIN kelompok k ON k.id = t.kelompok_id
     WHERE ${scope.sql}
     ORDER BY t.kategori, t.judul, t.id`,
    scope.values
  );

  return result.rows;
}

async function createTugas(req, res, auth) {
  if (auth.user.role !== 'kelompok' && auth.user.role !== 'admin') {
    fail(403, 'Hanya kelompok dan Admin yang bisa membuat tugas.');
  }

  const body = await readMateriBody(req);
  const judul = typeof body.judul === 'string' ? body.judul.trim() : '';

  if (judul.length < 1 || judul.length > 255) {
    fail(400, 'Judul harus berisi 1–255 karakter.');
  }

  if (!['doa_surat', 'makna_pegon', 'praktik_solat'].includes(body.kategori)) {
    fail(400, 'Kategori tugas tidak valid.');
  }

  let kelompokId = null;

  if (auth.user.role === 'kelompok') {
    kelompokId = materiPositiveId(auth.user.kelompok_id, 'Kelompok');
  } else if (body.kelompok_id != null && body.kelompok_id !== '') {
    kelompokId = materiPositiveId(body.kelompok_id, 'Kelompok');
  }

  const client = await db.getClient();
  let tugas;

  try {
    await client.query('BEGIN');

    if (kelompokId !== null) {
      const kelompok = await client.query(
        'SELECT id FROM kelompok WHERE id = $1 FOR KEY SHARE',
        [kelompokId]
      );

      if (!kelompok.rows.length) {
        fail(400, 'Kelompok tidak ditemukan.');
      }
    }

    const result = await client.query(
      `INSERT INTO tugas (judul, kategori, kelompok_id, dibuat_oleh)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [judul, body.kategori, kelompokId, auth.user.id]
    );

    tugas = result.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  sendJson(res, 201, { tugas });
}

async function listTugas(req, res, auth) {
  const tugas = await getMateriTugas(db, auth);
  sendJson(res, 200, { tugas });
}

async function deleteTugas(req, res, auth, rawId) {
  if (auth.user.role !== 'kelompok' && auth.user.role !== 'admin') {
    fail(403, 'Hanya kelompok dan Admin yang bisa menghapus tugas.');
  }

  const id = materiPositiveId(rawId, 'Tugas');
  const scope = tugasScopeWhere(auth);
  const values = [...scope.values, id];
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `SELECT t.*
       FROM tugas t
       WHERE (${scope.sql}) AND t.id = $${values.length}
       FOR UPDATE OF t`,
      values
    );

    const tugas = result.rows[0];

    if (!tugas) {
      fail(404, 'Tugas tidak ditemukan.');
    }

    if (
      auth.user.role !== 'admin' &&
      (
        tugas.kelompok_id === null ||
        Number(tugas.kelompok_id) !== Number(auth.user.kelompok_id)
      )
    ) {
      fail(403, 'Anda tidak boleh menghapus tugas ini.');
    }

    const existing = await client.query(
      'SELECT id FROM penilaian WHERE tugas_id = $1 LIMIT 1',
      [id]
    );

    if (existing.rows.length) {
      fail(409, 'Tugas sudah memiliki penilaian.');
    }

    await client.query('DELETE FROM tugas WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');

    if (error.code === '23503') {
      fail(409, 'Tugas sudah memiliki penilaian.');
    }

    throw error;
  } finally {
    client.release();
  }

  sendJson(res, 200, { ok: true });
}

async function savePenilaian(req, res, auth) {
  if (auth.user.role !== 'kelompok' && auth.user.role !== 'admin') {
    fail(403, 'Hanya pengurus kelompok dan Admin yang bisa memberi nilai.');
  }

  const body = await readMateriBody(req);
  const generusId = materiPositiveId(body.generus_id, 'Generus');
  const tugasId = materiPositiveId(body.tugas_id, 'Tugas');

  if (body.nilai == null || body.nilai === '') {
    fail(400, 'Nilai wajib diisi.');
  }

  const generusScope = generusScopeWhere(auth);
  const tugasScope = tugasScopeWhere(auth);
  const generusValues = [...generusScope.values, generusId];
  const tugasValues = [...tugasScope.values, tugasId];
  const client = await db.getClient();
  let penilaian;

  try {
    await client.query('BEGIN');

    const generusResult = await client.query(
      `SELECT g.id
       FROM generus g
       JOIN kelompok k ON k.id = g.kelompok_id
       WHERE (${generusScope.sql})
         AND g.id = $${generusValues.length}
         AND g.status = 'approved'
       FOR SHARE OF g, k`,
      generusValues
    );

    if (!generusResult.rows.length) {
      fail(404, 'Generus tidak ditemukan.');
    }

    // Kunci bersama mencegah tugas dihapus selama penilaian disimpan.
    const tugasResult = await client.query(
      `SELECT t.*
       FROM tugas t
       WHERE (${tugasScope.sql}) AND t.id = $${tugasValues.length}
       FOR SHARE OF t`,
      tugasValues
    );

    const tugas = tugasResult.rows[0];

    if (!tugas) {
      fail(404, 'Tugas tidak ditemukan.');
    }

    const allowedValues =
      tugas.kategori === 'doa_surat'
        ? ['hafal', 'belum']
        : ['bisa', 'tidak'];

    if (!allowedValues.includes(body.nilai)) {
      fail(400, 'Nilai tidak sesuai dengan kategori tugas.');
    }

    const existingResult = await client.query(
      `SELECT *
       FROM penilaian
       WHERE generus_id = $1 AND tugas_id = $2
       FOR UPDATE`,
      [generusId, tugasId]
    );

    const existing = existingResult.rows[0];

    if (!existing) {
      const result = await client.query(
        `INSERT INTO penilaian (
           generus_id, tugas_id, nilai, diubah_count, dicatat_oleh
         )
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [generusId, tugasId, body.nilai, 0, auth.user.id]
      );

      penilaian = result.rows[0];
    } else {
      if (existing.diubah_count >= 2 && auth.user.role !== 'admin') {
        fail(
          403,
          'Nilai sudah diubah 2 kali. Minta izin Admin untuk mengubah lagi.'
        );
      }

      const diubahCount =
        auth.user.role === 'admin' ? 0 : existing.diubah_count + 1;

      const result = await client.query(
        `UPDATE penilaian
         SET nilai = $1,
             diubah_count = $2,
             dicatat_oleh = $3,
             updated_at = now()
         WHERE id = $4
         RETURNING *`,
        [body.nilai, diubahCount, auth.user.id, existing.id]
      );

      penilaian = result.rows[0];
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');

    if (error.code === '23505') {
      fail(409, 'Penilaian sudah ada. Muat ulang halaman.');
    }

    throw error;
  } finally {
    client.release();
  }

  sendJson(res, 200, { penilaian });
}

async function listPenilaian(req, res, auth) {
  const url = new URL(req.url, 'http://localhost');
  const rawKelompokId = url.searchParams.get('kelompok_id');
  let kelompokId = null;

  if (auth.user.role === 'kelompok') {
    kelompokId = materiPositiveId(auth.user.kelompok_id, 'Kelompok');
  } else if (rawKelompokId !== null) {
    kelompokId = materiPositiveId(rawKelompokId, 'Kelompok');
  }

  if (auth.user.role === 'desa' && kelompokId !== null) {
    const kelompok = await db.query(
      'SELECT id FROM kelompok WHERE id = $1 AND desa_id = $2',
      [kelompokId, auth.user.desa_id]
    );

    if (!kelompok.rows.length) {
      fail(403, 'Kelompok berada di luar wilayah desa Anda.');
    }
  }

  const scope = generusScopeWhere(auth);
  const values = [...scope.values];
  let where = `(${scope.sql})`;

  if (kelompokId !== null) {
    values.push(kelompokId);
    where += ` AND g.kelompok_id = $${values.length}`;
  }

  const [tugas, penilaianResult, hasilResult] = await Promise.all([
    getMateriTugas(db, auth),
    db.query(
      `SELECT
         p.id,
         p.generus_id,
         p.tugas_id,
         p.nilai,
         p.diubah_count,
         p.dicatat_oleh,
         p.created_at,
         p.updated_at
       FROM penilaian p
       JOIN generus g ON g.id = p.generus_id
       JOIN kelompok k ON k.id = g.kelompok_id
       WHERE ${where}
       ORDER BY p.generus_id, p.tugas_id`,
      values
    ),
    db.query(
      `SELECT
         g.id AS generus_id,
         g.nama,
         g.kelas_sekolah,
         g.jenjang,
         k.nama AS kelompok,
         g.ortu_nama,
         g.ortu_hp,
         hitungan.hafal,
         hitungan.total_hafalan
       FROM generus g
       JOIN kelompok k ON k.id = g.kelompok_id
       CROSS JOIN LATERAL (
         SELECT
           (COUNT(*) FILTER (WHERE p.nilai = 'hafal'))::integer AS hafal,
           COUNT(*)::integer AS total_hafalan
         FROM tugas t
         LEFT JOIN penilaian p
           ON p.tugas_id = t.id AND p.generus_id = g.id
         WHERE t.kategori = 'doa_surat'
           AND (t.kelompok_id IS NULL OR t.kelompok_id = g.kelompok_id)
       ) hitungan
       WHERE ${where} AND g.status = 'approved'
       ORDER BY k.nama, g.jenjang, g.nama, g.id`,
      values
    ),
  ]);

  const hasil = hasilResult.rows.map((row) => ({
    ...row,
    persen:
      row.total_hafalan > 0
        ? Math.round((row.hafal / row.total_hafalan) * 1000) / 10
        : null,
  }));

  sendJson(res, 200, {
    tugas,
    penilaian: penilaianResult.rows,
    hasil,
  });
}

async function createPertemuan(req, res, auth) {
  const body = await readJson(req);
  const tingkat = body.tingkat;

  if (!TINGKAT_PERTEMUAN.has(tingkat)) {
    fail(400, 'Tingkat pertemuan tidak valid.');
  }

  const kelompokId = optionalId(body.kelompok_id, 'Kelompok');
  const desaId = optionalId(body.desa_id, 'Desa');

  if (
    !Array.isArray(body.jenjang) ||
    body.jenjang.length === 0 ||
    !body.jenjang.every((jenjang) => JENJANG.has(jenjang))
  ) {
    fail(400, 'Jenjang pertemuan tidak valid.');
  }

  const jenjang = [...new Set(body.jenjang)];
  const tanggal = validPertemuanDate(body.tanggal);

  const validScope =
    (tingkat === 'kelompok' && kelompokId !== null && desaId === null) ||
    (tingkat === 'desa' && desaId !== null && kelompokId === null) ||
    (tingkat === 'daerah' && kelompokId === null && desaId === null);

  if (!validScope) fail(400, 'Wilayah tidak sesuai dengan tingkat pertemuan.');

  canManagePertemuan(auth, {
    tingkat,
    kelompok_id: kelompokId,
    desa_id: desaId,
  });

  let result;
  try {
    result = await db.query(
      `INSERT INTO pertemuan
         (tingkat, kelompok_id, desa_id, jenjang_target, tanggal, dibuat_oleh)
       VALUES ($1, $2, $3, $4::jenjang_generus[], $5::date, $6)
       RETURNING *`,
      [tingkat, kelompokId, desaId, jenjang, tanggal, auth.user.id]
    );
  } catch (error) {
    if (error.code === '23503') fail(400, 'Wilayah atau pengguna tidak ditemukan.');
    throw error;
  }

  sendJson(res, 201, { pertemuan: normalisasiPertemuan(result.rows[0]) });
}

async function listPertemuan(res, auth, url) {
  const tingkat = url.searchParams.get('tingkat');
  const tanggalValue = url.searchParams.get('tanggal');

  if (tingkat !== null && !TINGKAT_PERTEMUAN.has(tingkat)) {
    fail(400, 'Tingkat pertemuan tidak valid.');
  }

  const tanggal = tanggalValue === null ? null : validPertemuanDate(tanggalValue);
  const scope = pertemuanScopeWhere(auth);

  const result = await db.query(
    `SELECT p.*
     FROM pertemuan p
     WHERE ${scope.sql}
       AND ($4::text IS NULL OR p.tingkat = $4::text)
       AND ($5::date IS NULL OR p.tanggal = $5::date)
     ORDER BY p.tanggal DESC, p.id DESC`,
    [...scope.values, tingkat, tanggal]
  );

  sendJson(res, 200, { pertemuan: result.rows.map(normalisasiPertemuan) });
}

async function getPertemuan(res, auth, id) {
  const scope = pertemuanScopeWhere(auth);
  const result = await db.query(
    `SELECT p.*
     FROM pertemuan p
     WHERE ${scope.sql} AND p.id = $4`,
    [...scope.values, id]
  );

  if (result.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');

  const ringkasan = await db.query(
    `SELECT
       (count(*) FILTER (WHERE status = 'hadir'))::integer AS hadir,
       (count(*) FILTER (WHERE status = 'izin'))::integer AS izin,
       (count(*) FILTER (WHERE status = 'sakit'))::integer AS sakit,
       (count(*) FILTER (WHERE status = 'alfa'))::integer AS alfa
     FROM absensi
     WHERE pertemuan_id = $1`,
    [id]
  );

  sendJson(res, 200, {
    pertemuan: normalisasiPertemuan(result.rows[0]),
    ringkasan: ringkasan.rows[0],
  });
}

async function updatePertemuan(req, res, auth, id) {
  const client = await db.getClient();
  let pertemuan;

  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');

    const found = await client.query(
      'SELECT * FROM pertemuan WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (found.rowCount !== 1) {
      fail(404, 'Pertemuan tidak ditemukan.');
    }

    pertemuan = found.rows[0];
    canManagePertemuan(auth, pertemuan);

    if (pertemuan.selesai_pada !== null) {
      fail(409, 'Pertemuan sudah selesai.');
    }

    const body = await readJson(req);

    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      fail(400, 'Data perubahan tidak valid.');
    }

    const hasTanggal = Object.hasOwn(body, 'tanggal');
    const hasJenjang = Object.hasOwn(body, 'jenjang');

    if (!hasTanggal && !hasJenjang) {
      fail(400, 'Tidak ada yang diubah.');
    }

    if (Object.keys(body).some((key) => !['tanggal', 'jenjang'].includes(key))) {
      fail(400, 'Hanya tanggal dan jenjang yang boleh diubah.');
    }

    const columns = [];
    const values = [];

    if (hasTanggal) {
      values.push(validPertemuanDate(body.tanggal));
      columns.push(`tanggal = $${values.length}::date`);
    }

    if (hasJenjang) {
      if (
        !Array.isArray(body.jenjang) ||
        body.jenjang.length === 0 ||
        !body.jenjang.every((jenjang) => JENJANG.has(jenjang))
      ) {
        fail(400, 'Jenjang pertemuan tidak valid.');
      }

      values.push([...new Set(body.jenjang)]);
      columns.push(`jenjang_target = $${values.length}::jenjang_generus[]`);
    }

    columns.push('updated_at = now()');
    values.push(id);

    // Nama kolom berasal dari konstanta di atas; data selalu parameter.
    const result = await client.query(
      `UPDATE pertemuan
       SET ${columns.join(', ')}
       WHERE id = $${values.length}
       RETURNING *`,
      values
    );

    pertemuan = result.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  sendJson(res, 200, { pertemuan: normalisasiPertemuan(pertemuan) });
}

async function deletePertemuan(res, auth, id) {
  const client = await db.getClient();

  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');

    const found = await client.query(
      'SELECT * FROM pertemuan WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (found.rowCount !== 1) {
      fail(404, 'Pertemuan tidak ditemukan.');
    }

    const pertemuan = found.rows[0];
    canManagePertemuan(auth, pertemuan);

    if (pertemuan.selesai_pada !== null) {
      fail(409, 'Pertemuan sudah selesai.');
    }

    const absensi = await client.query(
      'SELECT 1 FROM absensi WHERE pertemuan_id = $1 LIMIT 1',
      [id]
    );

    if (absensi.rowCount !== 0) {
      fail(409, 'Pertemuan sudah memiliki absensi.');
    }

    await client.query('DELETE FROM pertemuan WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');

    if (error.code === '23503') {
      fail(409, 'Pertemuan masih memiliki data terkait.');
    }

    throw error;
  } finally {
    client.release();
  }

  sendJson(res, 200, { ok: true });
}

async function listAbsensi(res, auth, id, url) {
  const scope = pertemuanScopeWhere(auth);
  const pertemuan = await db.query(
    `SELECT p.id
     FROM pertemuan p
     WHERE ${scope.sql} AND p.id = $4`,
    [...scope.values, id]
  );

  if (pertemuan.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');

  const result = await db.query(
    `SELECT a.id, a.pertemuan_id, a.generus_id, a.status, a.dicatat_oleh,
            a.koreksi_count, a.created_at, a.updated_at,
            g.nama, g.kelas_sekolah, g.jenjang
     FROM absensi a
     JOIN generus g ON g.id = a.generus_id
     WHERE a.pertemuan_id = $1
     ORDER BY g.nama, g.id`,
    [id]
  );

  sendJson(res, 200, { absensi: result.rows });
}

async function daftarPertemuan(res, auth, id) {
  const existing = await db.query(
    'SELECT * FROM pertemuan WHERE id = $1',
    [id]
  );
  if (existing.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');

  const pertemuan = existing.rows[0];
  try {
    canManagePertemuan(auth, pertemuan);
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) {
      fail(404, 'Pertemuan tidak ditemukan.');
    }
    throw error;
  }

  // CATATAN KEAMANAN: respons memuat kode_manual dan qr_token,
  // sama dengan data cetak-qr untuk pengurus yang sama.
  // Hanya pengurus yang lolos canManagePertemuan boleh mengunduhnya.
  const result = await db.query(
    `SELECT g.id, g.nama, g.kelas_sekolah, g.jenjang,
            g.kode_manual, g.qr_token
     FROM generus g
     JOIN kelompok k ON k.id = g.kelompok_id
     WHERE g.status = 'approved'
       AND g.jenjang = ANY($1::jenjang_generus[])
       AND (
         ($2::text = 'kelompok' AND g.kelompok_id = $3::integer)
         OR ($2::text = 'desa' AND k.desa_id = $4::integer)
         OR $2::text = 'daerah'
       )
     ORDER BY g.nama, g.id`,
    [
      pertemuan.jenjang_target, pertemuan.tingkat,
      pertemuan.kelompok_id, pertemuan.desa_id,
    ]
  );

  sendJson(res, 200, {
    pertemuan: normalisasiPertemuan(pertemuan),
    generus: result.rows,
  });
}

async function recordAbsen(req, res, auth, id) {
  const existing = await db.query(
    'SELECT * FROM pertemuan WHERE id = $1',
    [id]
  );

  if (existing.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');
  canManagePertemuan(auth, existing.rows[0]);

  const body = await readJson(req);
  if (typeof body.kode !== 'string') fail(404, 'Kode tidak ditemukan.');

  const kode = body.kode.trim();
  let qrToken = null;
  let kodeManual = null;

  if (/^[a-fA-F0-9]{32}$/.test(kode)) {
    qrToken = kode.toLowerCase();
  } else if (
    kode.length === 6 &&
    Array.from(kode).every((karakter) => MANUAL_ALPHABET.includes(karakter))
  ) {
    kodeManual = kode;
  } else {
    fail(404, 'Kode tidak ditemukan.');
  }

  const client = await db.getClient();
  let absensi;

  try {
    await client.query('BEGIN');

    const locked = await client.query(
      'SELECT * FROM pertemuan WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (locked.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');
    const pertemuan = locked.rows[0];
    canManagePertemuan(auth, pertemuan);

    const found = await client.query(
      `SELECT id
       FROM generus
       WHERE status = 'approved'
         AND (
           ($1::text IS NOT NULL AND qr_token = $1::text)
           OR ($2::text IS NOT NULL AND kode_manual = $2::text)
         )`,
      [qrToken, kodeManual]
    );

    if (found.rowCount !== 1) fail(404, 'Kode tidak ditemukan.');

    const generus = await generusInScope(pertemuan, found.rows[0].id, client);
    if (!generus) fail(404, 'Kode tidak ditemukan.');

    if (pertemuan.selesai_pada !== null) fail(409, 'Gunakan koreksi.');

    const result = await client.query(
      `INSERT INTO absensi (pertemuan_id, generus_id, status, dicatat_oleh)
       VALUES ($1, $2, 'hadir', $3)
       ON CONFLICT (pertemuan_id, generus_id)
       DO UPDATE SET status = EXCLUDED.status,
                     dicatat_oleh = EXCLUDED.dicatat_oleh,
                     updated_at = now()
       RETURNING id, pertemuan_id, generus_id, status, dicatat_oleh,
                 koreksi_count, created_at, updated_at`,
      [id, generus.id, auth.user.id]
    );

    absensi = result.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  sendJson(res, 200, { absensi });
}

async function recordAbsenManual(req, res, auth, id) {
  const existing = await db.query(
    'SELECT * FROM pertemuan WHERE id = $1',
    [id]
  );

  if (existing.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');
  canManagePertemuan(auth, existing.rows[0]);

  const body = await readJson(req);
  const generusId = positiveId(body.generus_id, 'Generus');
  const status = body.status;

  if (!STATUS_ABSENSI.has(status) || status === 'alfa') {
    fail(400, 'Status absensi manual harus hadir, izin, atau sakit.');
  }

  const client = await db.getClient();
  let absensi;

  try {
    await client.query('BEGIN');

    const locked = await client.query(
      'SELECT * FROM pertemuan WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (locked.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');
    const pertemuan = locked.rows[0];
    canManagePertemuan(auth, pertemuan);

    const generus = await generusInScope(pertemuan, generusId, client);
    if (!generus) fail(404, 'Generus tidak ditemukan dalam lingkup pertemuan.');

    if (pertemuan.selesai_pada !== null) fail(409, 'Gunakan koreksi.');

    const result = await client.query(
      `INSERT INTO absensi (pertemuan_id, generus_id, status, dicatat_oleh)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (pertemuan_id, generus_id)
       DO UPDATE SET status = EXCLUDED.status,
                     dicatat_oleh = EXCLUDED.dicatat_oleh,
                     updated_at = now()
       RETURNING id, pertemuan_id, generus_id, status, dicatat_oleh,
                 koreksi_count, created_at, updated_at`,
      [id, generus.id, status, auth.user.id]
    );

    absensi = result.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  sendJson(res, 200, { absensi });
}

async function syncAbsensi(req, res, auth, id) {
  const existing = await db.query(
    'SELECT * FROM pertemuan WHERE id = $1',
    [id]
  );
  if (existing.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');
  canManagePertemuan(auth, existing.rows[0]);
  if (existing.rows[0].selesai_pada !== null) {
    fail(409, 'Pertemuan sudah selesai. Gunakan koreksi.');
  }

  const body = await readJson(req);
  if (
    !Array.isArray(body.items) ||
    body.items.length < 1 ||
    body.items.length > 200
  ) {
    fail(400, 'Daftar antrean tidak valid.');
  }

  const hasil = [];
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      'SELECT * FROM pertemuan WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (locked.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');

    const pertemuan = locked.rows[0];
    canManagePertemuan(auth, pertemuan);
    if (pertemuan.selesai_pada !== null) {
      fail(409, 'Pertemuan sudah selesai. Gunakan koreksi.');
    }

    for (const item of body.items) {
      let generusId;
      try {
        if (
          !item ||
          typeof item !== 'object' ||
          Array.isArray(item) ||
          !['hadir', 'izin', 'sakit'].includes(item.status) ||
          typeof item.client_id !== 'string' ||
          item.client_id.length < 1 ||
          item.client_id.length > 64 ||
          item.client_id.trim().length === 0 ||
          item.client_id.includes('\u0000')
        ) {
          fail(400, 'Data antrean tidak valid.');
        }
        generusId = positiveId(item.generus_id);
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 400) {
          throw error;
        }
        hasil.push({
          generus_id: item?.generus_id ?? null,
          diterima: false,
          alasan: 'Data antrean tidak valid.',
        });
        continue;
      }

      let dicatatPada = null;
      if (
        typeof item.dicatat_pada === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
          item.dicatat_pada
        )
      ) {
        const waktu = Date.parse(item.dicatat_pada);
        if (
          Number.isFinite(waktu) &&
          waktu <= Date.now() + 24 * 60 * 60 * 1000
        ) {
          dicatatPada = new Date(waktu).toISOString();
        }
      }

      const duplikat = await client.query(
        `SELECT status FROM sync_items
         WHERE pertemuan_id = $1 AND client_id = $2`,
        [id, item.client_id]
      );
      if (duplikat.rowCount > 0) {
        hasil.push({
          generus_id: generusId,
          diterima: true,
          sudah_ada: true,
          status: duplikat.rows[0].status,
        });
        continue;
      }

      const generus = await generusInScope(pertemuan, generusId, client);
      if (!generus) {
        hasil.push({
          generus_id: generusId,
          diterima: false,
          alasan: 'Generus tidak ditemukan dalam lingkup pertemuan.',
        });
        continue;
      }

      const sebelumnya = await client.query(
        `SELECT status FROM absensi
         WHERE pertemuan_id = $1 AND generus_id = $2
         FOR UPDATE`,
        [id, generusId]
      );

      let statusAkhir;
      if (sebelumnya.rowCount === 0) {
        await client.query(
          `INSERT INTO absensi
             (pertemuan_id, generus_id, status, dicatat_oleh, dicatat_pada)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, generusId, item.status, auth.user.id, dicatatPada]
        );
        statusAkhir = item.status;
      } else {
        statusAkhir = sebelumnya.rows[0].status;
        if (statusAkhir !== 'hadir' && item.status === 'hadir') {
          await client.query(
            `UPDATE absensi
             SET status = 'hadir',
                 dicatat_oleh = $3,
                 dicatat_pada = $4,
                 updated_at = now()
             WHERE pertemuan_id = $1 AND generus_id = $2`,
            [id, generusId, auth.user.id, dicatatPada]
          );
          statusAkhir = 'hadir';
        }
      }

      await client.query(
        `INSERT INTO sync_items
           (pertemuan_id, generus_id, client_id, status,
            dicatat_pada, dicatat_oleh)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id, generusId, item.client_id, statusAkhir,
          dicatatPada, auth.user.id,
        ]
      );

      hasil.push({
        generus_id: generusId,
        diterima: true,
        status: statusAkhir,
      });
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  sendJson(res, 200, { hasil });
}

async function selesaiPertemuan(res, auth, id) {
  const existing = await db.query(
    'SELECT * FROM pertemuan WHERE id = $1',
    [id]
  );

  if (existing.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');
  canManagePertemuan(auth, existing.rows[0]);

  const client = await db.getClient();
  let pertemuan;
  let alfaDitandai;

  try {
    await client.query('BEGIN');

    const locked = await client.query(
      'SELECT * FROM pertemuan WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (locked.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');
    const current = locked.rows[0];
    canManagePertemuan(auth, current);

    if (current.selesai_pada !== null) {
      fail(409, 'Pertemuan sudah selesai.');
    }

    const updated = await client.query(
      `UPDATE pertemuan
       SET selesai_pada = now(), updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    const alfa = await client.query(
      `INSERT INTO absensi (pertemuan_id, generus_id, status, dicatat_oleh)
       SELECT $1, g.id, 'alfa', $2
       FROM generus g
       JOIN kelompok k ON k.id = g.kelompok_id
       WHERE g.status = 'approved'
         AND g.jenjang = ANY($3::jenjang_generus[])
         AND (
           ($4::text = 'kelompok' AND g.kelompok_id = $5::integer)
           OR ($4::text = 'desa' AND k.desa_id = $6::integer)
           OR $4::text = 'daerah'
         )
         AND NOT EXISTS (
           SELECT 1 FROM absensi a
           WHERE a.pertemuan_id = $1 AND a.generus_id = g.id
         )`,
      [
        id, auth.user.id, current.jenjang_target, current.tingkat,
        current.kelompok_id, current.desa_id,
      ]
    );

    pertemuan = updated.rows[0];
    alfaDitandai = alfa.rowCount;

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  sendJson(res, 200, { pertemuan: normalisasiPertemuan(pertemuan), alfa_ditandai: alfaDitandai });
}

async function linkIzin(res, auth, id) {
  const hasilPertemuan = await db.query(
    'SELECT * FROM pertemuan WHERE id = $1',
    [id]
  );

  if (!hasilPertemuan.rows[0]) {
    fail(404, 'Pertemuan tidak ditemukan.');
  }

  const pertemuan = hasilPertemuan.rows[0];
  canManagePertemuan(auth, pertemuan);

  let token = pertemuan.izin_token;

  for (let percobaan = 0; token === null && percobaan < 10; percobaan += 1) {
    const calonToken = crypto.randomBytes(16).toString('hex');

    try {
      const hasilUpdate = await db.query(
        `UPDATE pertemuan
         SET izin_token = $2, updated_at = now()
         WHERE id = $1 AND izin_token IS NULL
         RETURNING izin_token`,
        [id, calonToken]
      );

      if (hasilUpdate.rows[0]) {
        token = hasilUpdate.rows[0].izin_token;
      } else {
        const terbaru = await db.query(
          'SELECT * FROM pertemuan WHERE id = $1',
          [id]
        );

        if (!terbaru.rows[0]) {
          fail(404, 'Pertemuan tidak ditemukan.');
        }

        canManagePertemuan(auth, terbaru.rows[0]);
        token = terbaru.rows[0].izin_token;
      }
    } catch (error) {
      if (error.code !== '23505') {
        throw error;
      }
    }
  }

  if (token === null) {
    fail(500, 'Tautan izin belum berhasil dibuat. Silakan coba lagi.');
  }

  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 200, { url: '/izin.html?t=' + token });
}

async function listIzin(res, auth, id) {
  const hasilPertemuan = await db.query(
    'SELECT * FROM pertemuan WHERE id = $1',
    [id]
  );

  if (!hasilPertemuan.rows[0]) {
    fail(404, 'Pertemuan tidak ditemukan.');
  }

  canManagePertemuan(auth, hasilPertemuan.rows[0]);

  const hasil = await db.query(
    `SELECT
       i.id,
       i.pertemuan_id,
       i.generus_id,
       g.nama,
       g.kelas_sekolah,
       i.alasan,
       i.keterangan,
       i.status,
       i.catatan_penolakan,
       i.created_at,
       i.diputuskan_pada
     FROM izin i
     JOIN generus g ON g.id = i.generus_id
     WHERE i.pertemuan_id = $1
     ORDER BY i.created_at, i.id`,
    [id]
  );

  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 200, { izin: hasil.rows });
}

async function setujuiIzin(req, res, auth, pertemuanId, izinId) {
  const hasilPertemuan = await db.query(
    'SELECT * FROM pertemuan WHERE id = $1',
    [pertemuanId]
  );

  if (!hasilPertemuan.rows[0]) {
    fail(404, 'Pertemuan tidak ditemukan.');
  }

  canManagePertemuan(auth, hasilPertemuan.rows[0]);

  const client = await db.getClient();
  let izin;
  let absensi;

  try {
    await client.query('BEGIN');

    const terkunci = await client.query(
      'SELECT * FROM pertemuan WHERE id = $1 FOR UPDATE',
      [pertemuanId]
    );

    if (!terkunci.rows[0]) {
      fail(404, 'Pertemuan tidak ditemukan.');
    }

    const pertemuan = normalisasiPertemuan(terkunci.rows[0]);
    canManagePertemuan(auth, pertemuan);

    if (pertemuan.selesai_pada !== null) {
      fail(409, 'Pertemuan sudah selesai. Gunakan koreksi.');
    }

    const hasilIzin = await client.query(
      `SELECT *
       FROM izin
       WHERE id = $1 AND pertemuan_id = $2
       FOR UPDATE`,
      [izinId, pertemuanId]
    );

    const pengajuan = hasilIzin.rows[0];

    if (!pengajuan) {
      fail(404, 'Izin tidak ditemukan.');
    }

    if (pengajuan.status !== 'menunggu') {
      fail(409, 'Izin sudah diputuskan.');
    }

    const generus = await generusInScope(
      pertemuan,
      pengajuan.generus_id,
      client
    );

    if (!generus) {
      fail(409, 'Generus tidak lagi termasuk peserta kegiatan ini.');
    }

    const hasilAbsensi = await client.query(
      `INSERT INTO absensi (
         pertemuan_id, generus_id, status, dicatat_oleh
       )
       VALUES ($1, $2, $3::status_absensi, $4)
       ON CONFLICT (pertemuan_id, generus_id)
       DO UPDATE SET
         status = EXCLUDED.status,
         dicatat_oleh = EXCLUDED.dicatat_oleh,
         updated_at = now()
       RETURNING *`,
      [
        pertemuanId,
        pengajuan.generus_id,
        pengajuan.alasan,
        auth.user.id
      ]
    );

    const hasilUpdate = await client.query(
      `UPDATE izin
       SET
         status = 'disetujui',
         diputuskan_oleh = $3,
         diputuskan_pada = now(),
         updated_at = now()
       WHERE id = $1 AND pertemuan_id = $2
       RETURNING *`,
      [izinId, pertemuanId, auth.user.id]
    );

    absensi = hasilAbsensi.rows[0];
    izin = hasilUpdate.rows[0];

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 200, { izin, absensi });
}

async function tolakIzin(req, res, auth, pertemuanId, izinId) {
  const hasilPertemuan = await db.query(
    'SELECT * FROM pertemuan WHERE id = $1',
    [pertemuanId]
  );

  if (!hasilPertemuan.rows[0]) {
    fail(404, 'Pertemuan tidak ditemukan.');
  }

  canManagePertemuan(auth, hasilPertemuan.rows[0]);

  const body = await readJson(req);

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail(400, 'Data penolakan tidak valid.');
  }

  let catatan = null;

  if (body.catatan !== undefined && body.catatan !== null) {
    if (typeof body.catatan !== 'string') {
      fail(400, 'Catatan harus berupa teks.');
    }

    if (body.catatan.trim() !== '') {
      catatan = requiredString(body.catatan, 'Catatan', 500);
    }
  }

  const client = await db.getClient();
  let izin;

  try {
    await client.query('BEGIN');

    const terkunci = await client.query(
      'SELECT * FROM pertemuan WHERE id = $1 FOR UPDATE',
      [pertemuanId]
    );

    if (!terkunci.rows[0]) {
      fail(404, 'Pertemuan tidak ditemukan.');
    }

    const pertemuan = terkunci.rows[0];
    canManagePertemuan(auth, pertemuan);

    if (pertemuan.selesai_pada !== null) {
      fail(409, 'Pertemuan sudah selesai. Gunakan koreksi.');
    }

    const hasilIzin = await client.query(
      `SELECT *
       FROM izin
       WHERE id = $1 AND pertemuan_id = $2
       FOR UPDATE`,
      [izinId, pertemuanId]
    );

    if (!hasilIzin.rows[0]) {
      fail(404, 'Izin tidak ditemukan.');
    }

    if (hasilIzin.rows[0].status !== 'menunggu') {
      fail(409, 'Izin sudah diputuskan.');
    }

    const hasilUpdate = await client.query(
      `UPDATE izin
       SET
         status = 'ditolak',
         catatan_penolakan = $3,
         diputuskan_oleh = $4,
         diputuskan_pada = now(),
         updated_at = now()
       WHERE id = $1 AND pertemuan_id = $2
       RETURNING *`,
      [izinId, pertemuanId, catatan, auth.user.id]
    );

    izin = hasilUpdate.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 200, { izin });
}

async function koreksiAbsensi(req, res, auth, pertemuanId, absensiId) {
  const existing = await db.query(
    'SELECT * FROM pertemuan WHERE id = $1',
    [pertemuanId]
  );

  if (existing.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');
  canManagePertemuan(auth, existing.rows[0]);

  const body = await readJson(req);
  const status = body.status;
  if (!STATUS_ABSENSI.has(status)) fail(400, 'Status absensi tidak valid.');

  const client = await db.getClient();
  let absensi;

  try {
    await client.query('BEGIN');

    const locked = await client.query(
      `SELECT id, koreksi_count
       FROM absensi
       WHERE id = $1 AND pertemuan_id = $2
       FOR UPDATE`,
      [absensiId, pertemuanId]
    );

    if (locked.rowCount !== 1) fail(404, 'Absensi tidak ditemukan.');

    // Diperiksa setelah memperoleh kunci, memakai waktu database saat ini.
    const meeting = await client.query(
      `SELECT p.*,
              clock_timestamp() <= p.selesai_pada + interval '24 hours'
                AS dalam_batas
       FROM pertemuan p
       WHERE p.id = $1`,
      [pertemuanId]
    );

    if (meeting.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');
    const pertemuan = meeting.rows[0];
    canManagePertemuan(auth, pertemuan);

    if (pertemuan.selesai_pada === null) {
      fail(409, 'Pertemuan belum selesai.');
    }
    if (!pertemuan.dalam_batas) {
      fail(409, 'Di luar batas 24 jam.');
    }
    if (locked.rows[0].koreksi_count !== 0) {
      fail(409, 'Sudah pernah dikoreksi.');
    }

    const result = await client.query(
      `UPDATE absensi
       SET status = $1, koreksi_count = 1,
           dicatat_oleh = $2, updated_at = now()
       WHERE id = $3 AND pertemuan_id = $4
       RETURNING id, pertemuan_id, generus_id, status, dicatat_oleh,
                 koreksi_count, created_at, updated_at`,
      [status, auth.user.id, absensiId, pertemuanId]
    );

    absensi = result.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  sendJson(res, 200, { absensi });
}

async function qrSvg(req, res, auth, id) {
  const result = await db.query(
    `SELECT g.qr_token
     FROM generus g
     JOIN kelompok k ON k.id = g.kelompok_id
     WHERE g.id = $1
       AND g.status = 'approved'
       AND g.qr_token IS NOT NULL
       AND (
         $2::text IN ('admin', 'daerah')
         OR ($2::text = 'desa' AND k.desa_id = $3::integer)
         OR ($2::text = 'kelompok' AND g.kelompok_id = $4::integer)
       )`,
    [id, auth.user.role, auth.user.desa_id, auth.user.kelompok_id]
  );

  if (result.rowCount !== 1 || !result.rows[0].qr_token) {
    fail(404, 'QR generus tidak ditemukan.');
  }

  const svg = await QRCode.toString(result.rows[0].qr_token, {
    type: 'svg',
    margin: 1,
  });

  res.writeHead(200, {
    'Content-Type': 'image/svg+xml',
    'Content-Length': Buffer.byteLength(svg),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(svg);
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
    '.json': 'application/manifest+json',
    '.png': 'image/png',
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

async function muatIzinPublik(req, res, url) {
  const token = url.searchParams.get('t');

  if (typeof token !== 'string' || !/^[a-fA-F0-9]{32}$/.test(token)) {
    fail(404, 'Tautan izin tidak ditemukan.');
  }

  const hasilPertemuan = await db.query(
    'SELECT * FROM pertemuan WHERE izin_token = $1',
    [token.toLowerCase()]
  );

  if (!hasilPertemuan.rows[0]) {
    fail(404, 'Tautan izin tidak ditemukan.');
  }

  const pertemuan = normalisasiPertemuan(hasilPertemuan.rows[0]);
  const data = {
    pertemuan: {
      id: pertemuan.id,
      tanggal: pertemuan.tanggal,
      tingkat: pertemuan.tingkat
    },
    desa: [],
    kelompok: [],
    generus: []
  };

  let kelompokId;

  if (pertemuan.tingkat === 'kelompok') {
    // Sesuai aturan tingkat kelompok, kedua parameter diabaikan.
    kelompokId = pertemuan.kelompok_id;
  } else {
    const desaIdQuery = url.searchParams.has('desa_id')
      ? positiveId(url.searchParams.get('desa_id'), 'Desa')
      : null;

    const kelompokIdQuery = url.searchParams.has('kelompok_id')
      ? positiveId(url.searchParams.get('kelompok_id'), 'Kelompok')
      : null;

    let desaId;

    if (pertemuan.tingkat === 'desa') {
      desaId = pertemuan.desa_id;

      if (desaIdQuery !== null && desaIdQuery !== desaId) {
        fail(404, 'Desa tidak ditemukan.');
      }
    } else if (pertemuan.tingkat === 'daerah') {
      if (desaIdQuery === null) {
        if (kelompokIdQuery !== null) {
          fail(404, 'Kelompok tidak ditemukan.');
        }

        const hasilDesa = await db.query(
          'SELECT id, nama FROM desa ORDER BY nama, id'
        );

        data.desa = hasilDesa.rows;
        res.setHeader('Cache-Control', 'no-store');
        sendJson(res, 200, data);
        return;
      }

      desaId = desaIdQuery;
    } else {
      fail(404, 'Tautan izin tidak ditemukan.');
    }

    const hasilDesa = await db.query(
      'SELECT id FROM desa WHERE id = $1',
      [desaId]
    );

    if (!hasilDesa.rows[0]) {
      fail(404, 'Desa tidak ditemukan.');
    }

    if (kelompokIdQuery === null) {
      const hasilKelompok = await db.query(
        `SELECT id, nama
         FROM kelompok
         WHERE desa_id = $1
         ORDER BY nama, id`,
        [desaId]
      );

      data.kelompok = hasilKelompok.rows;
      res.setHeader('Cache-Control', 'no-store');
      sendJson(res, 200, data);
      return;
    }

    const hasilKelompok = await db.query(
      'SELECT id FROM kelompok WHERE id = $1 AND desa_id = $2',
      [kelompokIdQuery, desaId]
    );

    if (!hasilKelompok.rows[0]) {
      fail(404, 'Kelompok tidak ditemukan.');
    }

    kelompokId = kelompokIdQuery;
  }

  const hasilGenerus = await db.query(
    `SELECT g.id, g.nama, g.kelas_sekolah
     FROM generus g
     JOIN kelompok k ON k.id = g.kelompok_id
     WHERE g.status = 'approved'
       AND g.jenjang = ANY($1::jenjang_generus[])
       AND (
         ($2::text = 'kelompok' AND g.kelompok_id = $3)
         OR ($2::text = 'desa' AND k.desa_id = $4)
         OR $2::text = 'daerah'
       )
       AND g.kelompok_id = $5
     ORDER BY g.nama, g.id`,
    [
      pertemuan.jenjang_target,
      pertemuan.tingkat,
      pertemuan.kelompok_id,
      pertemuan.desa_id,
      kelompokId
    ]
  );

  data.generus = hasilGenerus.rows;
  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 200, data);
}

async function kirimIzin(req, res, url) {
  const token = url.searchParams.get('t');

  if (typeof token !== 'string' || !/^[a-fA-F0-9]{32}$/.test(token)) {
    fail(404, 'Tautan izin tidak ditemukan.');
  }

  const tokenNormal = token.toLowerCase();
  const hasilPertemuan = await db.query(
    'SELECT * FROM pertemuan WHERE izin_token = $1',
    [tokenNormal]
  );

  if (!hasilPertemuan.rows[0]) {
    fail(404, 'Tautan izin tidak ditemukan.');
  }

  if (hasilPertemuan.rows[0].selesai_pada !== null) {
    fail(409, 'Kegiatan sudah selesai.');
  }

  const body = await readJson(req);

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail(400, 'Data pengajuan tidak valid.');
  }

  const generusId = positiveId(body.generus_id, 'Generus');

  if (body.alasan !== 'sakit' && body.alasan !== 'izin') {
    fail(400, 'Alasan harus sakit atau izin.');
  }

  let keterangan = null;

  if (body.alasan === 'izin') {
    keterangan = requiredString(body.keterangan, 'Alasan izin', 500);
  } else if (body.keterangan !== undefined && body.keterangan !== null) {
    if (typeof body.keterangan !== 'string') {
      fail(400, 'Keterangan harus berupa teks.');
    }

    if (body.keterangan.trim() !== '') {
      keterangan = requiredString(body.keterangan, 'Keterangan', 500);
    }
  }

  if (typeof body.kode !== 'string') {
    fail(404, 'Kode tidak ditemukan.');
  }

  const kode = body.kode.trim();
  let qrToken = null;
  let kodeManual = null;

  if (/^[a-fA-F0-9]{32}$/.test(kode)) {
    qrToken = kode.toLowerCase();
  } else if (
    kode.length === 6 &&
    [...kode].every((karakter) => MANUAL_ALPHABET.includes(karakter))
  ) {
    kodeManual = kode;
  } else {
    fail(404, 'Kode tidak ditemukan.');
  }

  const client = await db.getClient();
  let izin;

  try {
    await client.query('BEGIN');

    const terkunci = await client.query(
      `SELECT *
       FROM pertemuan
       WHERE id = $1 AND izin_token = $2
       FOR UPDATE`,
      [hasilPertemuan.rows[0].id, tokenNormal]
    );

    if (!terkunci.rows[0]) {
      fail(404, 'Tautan izin tidak ditemukan.');
    }

    const pertemuan = normalisasiPertemuan(terkunci.rows[0]);

    if (pertemuan.selesai_pada !== null) {
      fail(409, 'Kegiatan sudah selesai.');
    }

    const hasilGenerus = await client.query(
      `SELECT id
       FROM generus
       WHERE status = 'approved'
         AND (qr_token = $1 OR kode_manual = $2)`,
      [qrToken, kodeManual]
    );

    const generus = hasilGenerus.rows[0];

    if (!generus || generus.id !== generusId) {
      fail(404, 'Kode tidak ditemukan.');
    }

    const dalamLingkup = await generusInScope(
      pertemuan,
      generus.id,
      client
    );

    if (!dalamLingkup) {
      fail(404, 'Kode tidak ditemukan.');
    }

    const duplikat = await client.query(
      `SELECT id
       FROM izin
       WHERE pertemuan_id = $1
         AND generus_id = $2
         AND status IN ('menunggu', 'disetujui')
       LIMIT 1`,
      [pertemuan.id, generusId]
    );

    if (duplikat.rows[0]) {
      fail(409, 'Izin sudah diajukan untuk kegiatan ini.');
    }

    const hasilIzin = await client.query(
      `INSERT INTO izin (
         pertemuan_id, generus_id, alasan, keterangan, status
       )
       VALUES ($1, $2, $3, $4, 'menunggu')
       RETURNING
         id, pertemuan_id, generus_id, alasan, keterangan,
         status, created_at`,
      [pertemuan.id, generusId, body.alasan, keterangan]
    );

    izin = hasilIzin.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 201, { izin });
}

async function mulaiLoginGoogle(req, res) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    fail(
      503,
      'Login Google belum dikonfigurasi. Minta Admin mengaturnya.'
    );
  }

  const state = buatStateGoogle();
  const target = new URL(
    'https://accounts.google.com/o/oauth2/v2/auth'
  );

  target.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  target.searchParams.set('redirect_uri', GOOGLE_REDIRECT_URI);
  target.searchParams.set('response_type', 'code');
  target.searchParams.set('scope', 'openid email profile');
  target.searchParams.set('state', state);
  target.searchParams.set('prompt', 'select_account');

  res.writeHead(302, {
    Location: target.toString(),
    'Cache-Control': 'no-store',
  });
  res.end();
}

async function callbackLoginGoogle(req, res, url) {
  function redirectError(kode) {
    res.writeHead(302, {
      Location: `/login.html?google=${kode}`,
      'Cache-Control': 'no-store',
    });
    res.end();
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    redirectError('tautan-kadaluarsa');
    return;
  }

  try {
    periksaStateGoogle(state);
  } catch {
    redirectError('tautan-kadaluarsa');
    return;
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    redirectError('gagal');
    return;
  }

  let email;
  let sub;

  try {
    const tokenResponse = await fetch(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: GOOGLE_REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!tokenResponse.ok) {
      redirectError('gagal');
      return;
    }

    const tokenData = await tokenResponse.json();
    const idToken = tokenData?.id_token;

    if (typeof idToken !== 'string' || !idToken.trim()) {
      redirectError('gagal');
      return;
    }

    const infoResponse = await fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' +
        encodeURIComponent(idToken),
      { signal: AbortSignal.timeout(10000) }
    );

    if (!infoResponse.ok) {
      redirectError('gagal');
      return;
    }

    const info = await infoResponse.json();
    const expiresAt = Number(info?.exp);

    if (
      !info ||
      info.aud !== GOOGLE_CLIENT_ID ||
      info.email_verified !== 'true' ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now() / 1000 ||
      ![
        'https://accounts.google.com',
        'accounts.google.com',
      ].includes(info.iss) ||
      typeof info.email !== 'string' ||
      !info.email.trim() ||
      typeof info.sub !== 'string' ||
      !info.sub.trim()
    ) {
      redirectError('gagal');
      return;
    }

    email = normalizedEmail(info.email);
    sub = requiredString(info.sub, 'Akun Google', 255);
  } catch {
    redirectError('gagal');
    return;
  }

  try {
    const result = await db.query(
      `SELECT id, email, password_hash, role, desa_id,
              kelompok_id, must_change_password, active, google_sub
       FROM users
       WHERE lower(email) = $1`,
      [email]
    );
    const user = result.rows[0];

    if (
      !user ||
      !user.active ||
      (user.google_sub !== null && user.google_sub !== sub)
    ) {
      redirectError('belum-terdaftar');
      return;
    }

    if (user.google_sub === null) {
      // Syarat tambahan mencegah penimpaan ikatan oleh callback bersamaan.
      const binding = await db.query(
        `UPDATE users
         SET google_sub = $1
         WHERE id = $2
           AND active = true
           AND (google_sub IS NULL OR google_sub = $1)
         RETURNING id`,
        [sub, user.id]
      );

      if (binding.rowCount !== 1) {
        redirectError('belum-terdaftar');
        return;
      }
    }

    const token = crypto.randomBytes(32).toString('hex');
    await db.query(
      `INSERT INTO sessions (token, user_id, expires_at)
       VALUES ($1, $2, now() + ($3 * interval '1 second'))`,
      [token, user.id, SESSION_SECONDS]
    );

    res.writeHead(302, {
      Location: '/jadwal.html',
      'Set-Cookie': sessionCookie(
        token,
        Boolean(req.socket.encrypted)
      ),
      'Cache-Control': 'no-store',
    });
    res.end();
  } catch (error) {
    redirectError(
      error?.code === '23505' ? 'belum-terdaftar' : 'gagal'
    );
  }
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

  if (req.method === 'GET' && pathname === '/api/auth/google') {
    await mulaiLoginGoogle(req, res);
    return;
  }

  if (
    req.method === 'GET' &&
    pathname === '/api/auth/google/callback'
  ) {
    await callbackLoginGoogle(req, res, url);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/izin') {
    await muatIzinPublik(req, res, url);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/izin') {
    await kirimIzin(req, res, url);
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

  if (
    req.method === 'GET' &&
    (pathname === '/api/laporan' || pathname === '/api/laporan.docx')
  ) {
    const dari = url.searchParams.get('dari');
    const sampai = url.searchParams.get('sampai');
    const rincian = url.searchParams.get('rincian') ?? '0';

    if (rincian !== '0' && rincian !== '1') {
      fail(400, 'Parameter rincian harus 0 atau 1.');
    }

    const laporan = await hitungLaporan(auth, dari, sampai, rincian === '1');

    if (pathname === '/api/laporan') {
      sendJson(res, 200, laporan);
      return;
    }

    const buffer = await buatLaporanWord(laporan);

    res.writeHead(200, {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition':
        `attachment; filename="laporan-kehadiran-${dari}_sd_${sampai}.docx"`,
      'Content-Length': buffer.length,
      'Cache-Control': 'no-store',
    });
    res.end(buffer);
    return;
  }

if (req.method === 'POST' && pathname === '/api/tugas') {
  await createTugas(req, res, auth);
  return;
}

if (req.method === 'GET' && pathname === '/api/tugas') {
  await listTugas(req, res, auth);
  return;
}

const deleteTugasMatch = pathname.match(/^\/api\/tugas\/([0-9]+)$/);

if (req.method === 'DELETE' && deleteTugasMatch) {
  await deleteTugas(req, res, auth, deleteTugasMatch[1]);
  return;
}

if (req.method === 'POST' && pathname === '/api/penilaian') {
  await savePenilaian(req, res, auth);
  return;
}

if (req.method === 'GET' && pathname === '/api/penilaian') {
  await listPenilaian(req, res, auth);
  return;
}

  if (req.method === 'POST' && pathname === '/api/pertemuan') {
    await createPertemuan(req, res, auth);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/pertemuan') {
    await listPertemuan(res, auth, url);
    return;
  }

  const pertemuanMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)$/);
  if (req.method === 'GET' && pertemuanMatch) {
    await getPertemuan(res, auth, positiveId(pertemuanMatch[1]));
    return;
  }

  if (req.method === 'PATCH' && pertemuanMatch) {
    await updatePertemuan(req, res, auth, positiveId(pertemuanMatch[1]));
    return;
  }

  if (req.method === 'DELETE' && pertemuanMatch) {
    await deletePertemuan(res, auth, positiveId(pertemuanMatch[1]));
    return;
  }

  const absensiMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)\/absensi$/);
  if (req.method === 'GET' && absensiMatch) {
    await listAbsensi(res, auth, positiveId(absensiMatch[1]), url);
    return;
  }

  const daftarMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)\/daftar$/);
  if (req.method === 'GET' && daftarMatch) {
    await daftarPertemuan(res, auth, positiveId(daftarMatch[1]));
    return;
  }

  const syncMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)\/sync$/);
  if (req.method === 'POST' && syncMatch) {
    await syncAbsensi(req, res, auth, positiveId(syncMatch[1]));
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

  const koreksiMatch = pathname.match(
    /^\/api\/pertemuan\/([1-9]\d*)\/absensi\/([1-9]\d*)\/koreksi$/
  );
  if (req.method === 'POST' && koreksiMatch) {
    await koreksiAbsensi(
      req, res, auth, positiveId(koreksiMatch[1]), positiveId(koreksiMatch[2])
    );
    return;
  }

  const linkIzinMatch = pathname.match(
    /^\/api\/pertemuan\/([1-9]\d*)\/link-izin$/
  );
  if (req.method === 'GET' && linkIzinMatch) {
    await linkIzin(res, auth, positiveId(linkIzinMatch[1]));
    return;
  }

  const listIzinMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)\/izin$/);
  if (req.method === 'GET' && listIzinMatch) {
    await listIzin(res, auth, positiveId(listIzinMatch[1]));
    return;
  }

  const putusIzinMatch = pathname.match(
    /^\/api\/pertemuan\/([1-9]\d*)\/izin\/([1-9]\d*)\/(setujui|tolak)$/
  );
  if (req.method === 'POST' && putusIzinMatch) {
    const pid = positiveId(putusIzinMatch[1]);
    const zid = positiveId(putusIzinMatch[2]);
    if (putusIzinMatch[3] === 'setujui') {
      await setujuiIzin(req, res, auth, pid, zid);
    } else {
      await tolakIzin(req, res, auth, pid, zid);
    }
    return;
  }

  const qrMatch = pathname.match(/^\/api\/generus\/([1-9]\d*)\/qr\.svg$/);
  if (req.method === 'GET' && qrMatch) {
    await qrSvg(req, res, auth, positiveId(qrMatch[1]));
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
