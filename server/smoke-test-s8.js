'use strict';

// Smoke test Sesi 8 — Login Google (GENSA).
// Jalankan dengan server yang sudah diberi env Google dummy, misal:
//   GOOGLE_CLIENT_ID=test-client-id GOOGLE_CLIENT_SECRET=test-secret \
//     node server/index.js
// (tanpa kredensial Google asli, alur penuh sampai Google tidak bisa
// diuji — yang diuji: redirect awal, validasi state, kegagalan tukar
// kode yang ditangani dengan baik, dan tombol di login.html.)

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

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

const PORT = Number(process.env.PORT || 3101);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@gensa.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

let failures = 0;
let adminCookie;

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
    // Respons redirect bukan JSON — abaikan.
  }

  const setCookie = response.headers.get('set-cookie');
  const sessionCookie = setCookie ? setCookie.split(';')[0] : null;
  return { response, data, cookie: sessionCookie };
}

async function requestText(method, url, cookie) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;

  const response = await fetch(`${BASE}${url}`, {
    method,
    headers,
    redirect: 'manual',
  });

  return { response, text: await response.text() };
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

function signState(payload) {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
}

function buildState(expOffsetSeconds = 600, tamper = false) {
  const payload = Buffer.from(JSON.stringify({
    nonce: crypto.randomBytes(16).toString('hex'),
    exp: Math.floor(Date.now() / 1000) + expOffsetSeconds,
  })).toString('base64url');

  const signature = signState(tamper ? `${payload}x` : payload);
  return `${payload}.${signature}`;
}

async function restoreAdminFlag() {
  if (!process.env.DATABASE_URL) return;

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      'UPDATE users SET must_change_password = true WHERE email = $1',
      [ADMIN_EMAIL]
    );
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

  assert.ok(SESSION_SECRET, 'SESSION_SECRET wajib ada di .env.');
  assert.ok(
    GOOGLE_CLIENT_ID,
    'GOOGLE_CLIENT_ID wajib diisi (dummy tidak apa-apa) saat menjalankan tes ini.'
  );

  await check('GET /api/auth/google mengarah ke Google dengan state', async () => {
    const result = await request('GET', '/api/auth/google');
    assert.equal(result.response.status, 302);

    const location = result.response.headers.get('location');
    assert.ok(location, 'Header Location wajib ada.');
    const target = new URL(location);
    assert.equal(target.origin, 'https://accounts.google.com');
    assert.equal(target.pathname, '/o/oauth2/v2/auth');
    assert.equal(target.searchParams.get('client_id'), GOOGLE_CLIENT_ID);
    assert.equal(target.searchParams.get('response_type'), 'code');
    assert.ok(
      target.searchParams.get('scope').includes('openid'),
      'Scope wajib memuat openid.'
    );
    assert.ok(target.searchParams.get('redirect_uri'), 'redirect_uri wajib ada.');
    assert.ok(target.searchParams.get('state'), 'State wajib ada.');
  });

  await check('Callback tanpa parameter ditolak ke login', async () => {
    const result = await request('GET', '/api/auth/google/callback');
    assert.equal(result.response.status, 302);
    assert.equal(
      result.response.headers.get('location'),
      '/login.html?google=tautan-kadaluarsa'
    );
  });

  await check('Callback dengan state rusak ditolak', async () => {
    const result = await request(
      'GET',
      '/api/auth/google/callback?code=palsu&state=rusak'
    );
    assert.equal(result.response.status, 302);
    assert.equal(
      result.response.headers.get('location'),
      '/login.html?google=tautan-kadaluarsa'
    );
  });

  await check('Callback dengan state kedaluwarsa ditolak', async () => {
    const state = buildState(-60);
    const result = await request(
      'GET',
      `/api/auth/google/callback?code=palsu&state=${encodeURIComponent(state)}`
    );
    assert.equal(result.response.status, 302);
    assert.equal(
      result.response.headers.get('location'),
      '/login.html?google=tautan-kadaluarsa'
    );
  });

  await check('Callback dengan state tanda tangan salah ditolak', async () => {
    const state = buildState(600, true);
    const result = await request(
      'GET',
      `/api/auth/google/callback?code=palsu&state=${encodeURIComponent(state)}`
    );
    assert.equal(result.response.status, 302);
    assert.equal(
      result.response.headers.get('location'),
      '/login.html?google=tautan-kadaluarsa'
    );
  });

  await check('Callback state valid + kode palsu gagal dengan baik', async () => {
    const state = buildState(600);
    const result = await request(
      'GET',
      `/api/auth/google/callback?code=palsu&state=${encodeURIComponent(state)}`
    );
    assert.equal(result.response.status, 302);
    assert.equal(
      result.response.headers.get('location'),
      '/login.html?google=gagal'
    );
  });

  await check('Halaman login memuat tombol Google', async () => {
    const result = await requestText('GET', '/login.html');
    assert.equal(result.response.status, 200);
    assert.ok(result.text.includes('Masuk dengan Google'));
    assert.ok(result.text.includes('/api/auth/google'));
  });

  await check('Login email/password admin tetap jalan', async () => {
    const login = await request('POST', '/api/login', {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    assert.equal(login.response.status, 200);
    assert.ok(login.cookie);
    adminCookie = login.cookie;

    if (login.data.user.must_change_password) {
      const changed = await request('POST', '/api/change-password', {
        old_password: ADMIN_PASSWORD,
        new_password: ADMIN_PASSWORD,
      }, adminCookie);
      assert.equal(changed.response.status, 200);
    }

    const me = await request('GET', '/api/me', undefined, adminCookie);
    assert.equal(me.response.status, 200);
    assert.equal(me.data.user.email, ADMIN_EMAIL);
  });

  await restoreAdminFlag();

  if (failures) {
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
