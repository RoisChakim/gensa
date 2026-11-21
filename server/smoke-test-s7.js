'use strict';

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
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const suffix = crypto.randomBytes(8).toString('hex');

let failures = 0;
let adminCookie;
let kelompokId;
let testEmail;
let testPassword;
let testUserId;

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

  const buffer = Buffer.from(await response.arrayBuffer());
  const text = buffer.toString('utf8');
  let data = {};

  try {
    data = JSON.parse(text);
  } catch {
    // Respons non-JSON tetap tersedia sebagai text.
  }

  const setCookie = response.headers.get('set-cookie');

  return {
    response,
    data,
    text,
    buffer,
    cookie: setCookie ? setCookie.split(';')[0] : null,
  };
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

async function findKelompokC() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL wajib diisi untuk mencari kelompok contoh.');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const result = await client.query(
      `SELECT k.id AS kelompok_id
       FROM kelompok k
       JOIN desa d ON d.id = k.desa_id
       JOIN daerah a ON a.id = d.daerah_id
       WHERE a.nama = $1 AND d.nama = $2 AND k.nama = $3`,
      ['Daerah Contoh', 'Desa Contoh 3', 'Kelompok Contoh C']
    );

    assert.equal(result.rowCount, 1, 'Kelompok contoh C tidak ditemukan.');
    return result.rows[0].kelompok_id;
  } finally {
    await client.end();
  }
}

async function restoreAdminFlag() {
  if (!process.env.DATABASE_URL) return;

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query(
      'UPDATE users SET must_change_password = true WHERE lower(email) = lower($1)',
      [ADMIN_EMAIL]
    );
  } finally {
    await client.end();
  }
}

async function getUserRow(email) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const result = await client.query(
      'SELECT id, password_hash FROM users WHERE lower(email) = lower($1)',
      [email]
    );
    assert.equal(result.rowCount, 1, 'Akun tes tidak ditemukan.');
    return result.rows[0];
  } finally {
    await client.end();
  }
}

function buildResetToken(userId, passwordHash) {
  assert.ok(SESSION_SECRET, 'SESSION_SECRET wajib ada di .env.');

  const fingerprint = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(passwordHash)
    .digest('base64url');
  const payload = Buffer.from(JSON.stringify({
    id: userId,
    exp: Math.floor(Date.now() / 1000) + 3600,
    fingerprint,
    nonce: crypto.randomBytes(16).toString('hex'),
  })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');

  return `${payload}.${signature}`;
}

async function main() {
  if (!ADMIN_PASSWORD || !ADMIN_PASSWORD.trim()) {
    console.error('FAIL: ADMIN_PASSWORD wajib diisi.');
    process.exitCode = 1;
    return;
  }

  await check('Admin masuk dan membuat akun kelompok untuk reset', async () => {
    kelompokId = await findKelompokC();

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

    testEmail = `reset-${suffix}@tes.gensa.local`;
    const created = await request('POST', '/api/users', {
      email: testEmail,
      role: 'kelompok',
      kelompok_id: kelompokId,
    }, adminCookie);
    assert.equal(created.response.status, 201);

    testPassword = `Tes${crypto.randomBytes(16).toString('hex')}`;
    const testLogin = await request('POST', '/api/login', {
      email: testEmail,
      password: created.data.initial_password,
    });
    assert.equal(testLogin.response.status, 200);

    const changed = await request('POST', '/api/change-password', {
      old_password: created.data.initial_password,
      new_password: testPassword,
    }, testLogin.cookie);
    assert.equal(changed.response.status, 200);

    const row = await getUserRow(testEmail);
    testUserId = row.id;
  });

  await check('Manifest, ikon, dan service worker tersedia', async () => {
    const manifest = await request('GET', '/manifest.json');
    assert.equal(manifest.response.status, 200);
    assert.match(
      manifest.response.headers.get('content-type') || '',
      /application\/manifest\+json/i
    );
    assert.equal(manifest.data.name, 'GENSA — Sistem Manajemen Generus');
    assert.equal(manifest.data.short_name, 'GENSA');
    assert.equal(manifest.data.start_url, '/');
    assert.equal(manifest.data.display, 'standalone');
    assert.ok(Array.isArray(manifest.data.icons));
    assert.ok(manifest.data.icons.some((icon) => icon.sizes === '192x192'));
    assert.ok(manifest.data.icons.some((icon) => icon.sizes === '512x512'));

    for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512]]) {
      const icon = await request('GET', `/${name}`);
      assert.equal(icon.response.status, 200);
      assert.match(icon.response.headers.get('content-type') || '', /image\/png/i);
      assert.equal(icon.buffer.subarray(0, 4).toString('hex'), '89504e47');
      assert.equal(icon.buffer.readUInt32BE(16), size);
      assert.equal(icon.buffer.readUInt32BE(20), size);
    }

    const sw = await request('GET', '/sw.js');
    assert.equal(sw.response.status, 200);
    assert.match(sw.response.headers.get('content-type') || '', /javascript/i);
    assert.match(sw.text, /gensa-v2/);
    assert.match(sw.text, /\/dashboard\.html/);
    assert.match(sw.text, /\/generus\.html/);
    assert.match(sw.text, /\/akun\.html/);
    assert.match(sw.text, /addEventListener\('install'/);
    assert.match(sw.text, /addEventListener\('fetch'/);
    assert.match(sw.text, /\/api\//);
  });

  await check('Semua halaman memuat manifest dan service worker', async () => {
    for (const page of [
      'login.html', 'jadwal.html', 'cetak-qr.html',
      'laporan.html', 'scan.html', 'materi.html', 'reset-password.html',
    ]) {
      const result = await request('GET', `/${page}`, undefined, adminCookie);
      assert.equal(result.response.status, 200, page);
      assert.match(result.text, /rel="manifest" href="\/manifest\.json"/, page);
      assert.match(
        result.text,
        /navigator\.serviceWorker\.register\('\/sw\.js'\)/,
        page
      );
    }

    const login = await request('GET', '/login.html', undefined, adminCookie);
    assert.match(login.text, /Lupa password\?/);
    assert.match(login.text, /\/reset-password\.html/);
  });

  await check('Halaman reset password tersedia', async () => {
    const page = await request('GET', '/reset-password.html');
    assert.equal(page.response.status, 200);
    assert.match(page.response.headers.get('content-type') || '', /text\/html/i);
    assert.match(page.text, /Lupa Password/);
    assert.match(page.text, /\/api\/reset-password/);
    assert.match(page.text, /\/api\/reset-password\/confirm/);
  });

  await check('Alur reset password penuh jalan', async () => {
    const minta = await request('POST', '/api/reset-password', {
      email: testEmail,
    });
    assert.equal(minta.response.status, 200);
    assert.equal(minta.data.ok, true);

    const row = await getUserRow(testEmail);
    const token = buildResetToken(row.id, row.password_hash);

    const baru = `Baru${crypto.randomBytes(16).toString('hex')}`;
    const konfirmasi = await request('POST', '/api/reset-password/confirm', {
      token,
      new_password: baru,
    });
    assert.equal(konfirmasi.response.status, 200);
    assert.equal(konfirmasi.data.ok, true);

    const masukBaru = await request('POST', '/api/login', {
      email: testEmail,
      password: baru,
    });
    assert.equal(masukBaru.response.status, 200);

    const masukLama = await request('POST', '/api/login', {
      email: testEmail,
      password: testPassword,
    });
    assert.equal(masukLama.response.status, 401);

    // Token yang sama tidak bisa dipakai dua kali.
    const ulang = await request('POST', '/api/reset-password/confirm', {
      token,
      new_password: `Lain${crypto.randomBytes(16).toString('hex')}`,
    });
    assert.equal(ulang.response.status, 400);
  });

  await check('Token salah dan password pendek ditolak', async () => {
    const salah = await request('POST', '/api/reset-password/confirm', {
      token: 'tidak-valid',
      new_password: 'PasswordBaru123',
    });
    assert.equal(salah.response.status, 400);

    const row = await getUserRow(testEmail);
    const token = buildResetToken(row.id, row.password_hash);
    const pendek = await request('POST', '/api/reset-password/confirm', {
      token,
      new_password: 'pendek',
    });
    assert.equal(pendek.response.status, 400);
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
