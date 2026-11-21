'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const nodemailer = require('nodemailer');
const db = require('../db');
const { fail, sendJson } = require('../middleware/errors');
const { normalizedEmail, passwordValue, optionalId, requiredString } = require('../middleware/validate');
const { readJson, randomString, sessionCookie, requestSecure, requestProtocol } = require('../middleware/http');
const { rateState, recordLoginFailure, checkResetRateLimit, requireRole, loginFailures } = require('../middleware/auth');
const {
  PORT, SESSION_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI, SESSION_SECONDS, RESET_SECONDS, APP_URL,
  SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM,
  SMTP_TERKONFIGURASI, ROLES, PASSWORD_ALPHABET,
} = require('../config');

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
    { 'Set-Cookie': sessionCookie(token, requestSecure(req)) }
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
    { 'Set-Cookie': sessionCookie('', requestSecure(req), 0) }
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

async function kirimEmailReset(email, link) {
  if (!SMTP_TERKONFIGURASI) return false;

  try {
    const escapeHtml = (value) => String(value).replace(
      /[&<>"']/g,
      (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]
    );

    const safeEmail = escapeHtml(email);
    const safeLink = escapeHtml(link);

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: SMTP_FROM,
      to: email,
      subject: 'Reset password GENSA',
      text: `Halo,\n\nAnda meminta reset password akun GENSA (${email}).\nBuka tautan berikut dalam 1 jam untuk membuat password baru:\n${link}\n\nBila Anda tidak meminta reset ini, abaikan email ini.\n\nGENSA — Platform Manajemen Generus`,
      html: `
        <div style="background-color: #F6F1E9; color: #8A5A33; padding: 20px; font-family: sans-serif;">
          <p>Halo,</p>
          <p>Anda meminta reset password akun GENSA (${safeEmail}).</p>
          <p>Buka tautan berikut dalam 1 jam untuk membuat password baru:</p>
          <p><a href="${safeLink}" style="color: #5F7A57;">Buat password baru</a></p>
          <p>Bila Anda tidak meminta reset ini, abaikan email ini.</p>
          <p>GENSA — Platform Manajemen Generus</p>
        </div>
      `,
    });

    return true;
  } catch {
    // R4: pesan error SMTP mentah dapat memuat isi email atau tautan reset.
    console.error('Gagal mengirim email reset:', 'Pengiriman SMTP gagal. Periksa konfigurasi SMTP.');
    return false;
  }
}

async function requestReset(req, res) {
  const body = await readJson(req);
  const email = normalizedEmail(body.email);
  checkResetRateLimit(req, email);

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

    const protocol = requestProtocol(req).slice(0, -1);
    // Basis tautan tetap dari konfigurasi (APP_URL) atau alamat lokal,
    // sehingga header Host tidak dapat mengubah tujuan tautan.
    const base = APP_URL || `${protocol}://127.0.0.1:${PORT}`;
    const link = `${base}/reset-password.html?token=${encodeURIComponent(token)}`;
    const terkirim = await kirimEmailReset(user.email, link);

    // R4 didahulukan: saat SMTP terkonfigurasi, kegagalan pengiriman
    // tidak boleh menyebabkan tautan reset ditulis ke log.
    if (!terkirim && !SMTP_TERKONFIGURASI) {
      console.log(`Tautan reset untuk ${user.email}: ${link}`);
    }
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

// createGenerus — diubah Sesi 13A: terima kelas_id (dropdown), kelas_sekolah diisi dari nama kelas.

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
      Location: '/dashboard.html',
      'Set-Cookie': sessionCookie(
        token,
        requestSecure(req)
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

module.exports = {
  login, logout, createUser, changePassword, resetSignature,
  passwordFingerprint, buatStateGoogle, periksaStateGoogle, kirimEmailReset,
  requestReset, parseResetToken, confirmReset, mulaiLoginGoogle,
  callbackLoginGoogle,
};
