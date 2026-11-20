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
