'use strict';

const db = require('../db');
const { fail } = require('./errors');
const { cookieToken } = require('./http');
const { TRUST_PROXY } = require('../config');

const loginFailures = new Map();
// Batas permintaan reset password (13G): maks 5 per jam per email dan
// maks 10 per jam per IP, supaya tautan reset tidak bisa dispam
// (membanjiri log bila SMTP mati, membanjiri email bila SMTP jalan).
// Seperti limit lain di file ini, Map ini ada di memori — hilang saat
// server restart dan per-instans di serverless.
const resetAttempts = new Map();
// Percobaan POST /api/izin per IP (R2): maks 10 per menit.
const izinAttempts = new Map();

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

// IP klien untuk rate limit izin publik. Di belakang proxy tepercaya
// (TRUST_PROXY=1) pakai entri pertama x-forwarded-for.

function clientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim() !== '') {
      return forwarded.split(',')[0].trim();
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

// R2: batasi POST /api/izin publik — maks 10 percobaan per menit per IP,
// supaya kode 6 karakter tidak bisa ditebak berulang (brute force).

function checkIzinRateLimit(req) {
  const now = Date.now();
  const ip = clientIp(req);

  for (const [key, entry] of izinAttempts) {
    if (entry.expiresAt <= now) izinAttempts.delete(key);
  }

  let entry = izinAttempts.get(ip);
  if (!entry) {
    entry = { count: 0, expiresAt: now + 60 * 1000 };
    izinAttempts.set(ip, entry);
  }

  entry.count += 1;
  if (entry.count > 10) {
    fail(429, 'Terlalu banyak percobaan. Coba lagi nanti.');
  }
}

// 13G: batasi POST /api/reset-password — maks 5 per jam per email dan
// maks 10 per jam per IP. Dipanggil SEBELUM query DB supaya email yang
// tidak terdaftar pun ikut dibatasi (dan respons tetap ok:true).

function checkResetRateLimit(req, email) {
  const now = Date.now();
  const ip = clientIp(req);

  for (const [key, entry] of resetAttempts) {
    if (entry.expiresAt <= now) resetAttempts.delete(key);
  }

  for (const [key, batas] of [
    [`email:${email}`, 5],
    [`ip:${ip}`, 10],
  ]) {
    let entry = resetAttempts.get(key);
    if (!entry) {
      entry = { count: 0, expiresAt: now + 60 * 60 * 1000 };
      resetAttempts.set(key, entry);
    }

    entry.count += 1;
    if (entry.count > batas) {
      fail(429, 'Terlalu banyak permintaan reset. Coba lagi nanti.');
    }
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

module.exports = {
  loginFailures, resetAttempts, izinAttempts, rateState, recordLoginFailure,
  clientIp, checkIzinRateLimit, checkResetRateLimit, authenticate, requireRole,
  publicUser,
};
