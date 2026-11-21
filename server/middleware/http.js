'use strict';

const crypto = require('node:crypto');
const { fail } = require('./errors');
const { MAX_BODY, MAX_FOTO_BYTES, SESSION_SECONDS, TRUST_PROXY } = require('../config');

async function readFotoBody(req) {
  const contentLength = Number(req.headers['content-length'] || 0);

  if (contentLength > MAX_FOTO_BYTES) {
    req.resume();
    fail(413, 'Foto maksimal 2 MB.');
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    function rejectFoto(status, pesan) {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      req.resume();

      try {
        fail(status, pesan);
      } catch (error) {
        reject(error);
      }
    }

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;

      if (size > MAX_FOTO_BYTES) {
        rejectFoto(413, 'Foto maksimal 2 MB.');
        return;
      }

      chunks.push(chunk);
    });

    req.once('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, size));
    });

    req.once('aborted', () => {
      rejectFoto(400, 'Unggah foto terputus.');
    });

    req.once('error', (error) => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      reject(error);
    });
  });
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

// Protokol yang dilihat klien. Di belakang proxy tepercaya, baca
// x-forwarded-proto; bila tidak, pakai status TLS koneksi langsung.

function requestProtocol(req) {
  if (TRUST_PROXY) {
    const forwarded = (req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    if (forwarded === 'https' || forwarded === 'http') {
      return `${forwarded}:`;
    }
  }
  return req.socket.encrypted ? 'https:' : 'http:';
}

function requestSecure(req) {
  return requestProtocol(req) === 'https:';
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

  const protocol = requestProtocol(req);
  if (
    parsed.protocol !== protocol ||
    parsed.host !== req.headers.host ||
    parsed.username ||
    parsed.password
  ) {
    fail(403, 'Asal permintaan tidak diizinkan.');
  }
}

module.exports = {
  readFotoBody, readJson, randomString, sessionCookie, cookieToken,
  requestProtocol, requestSecure, checkOrigin,
};
