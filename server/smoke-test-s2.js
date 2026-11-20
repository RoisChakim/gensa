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
const suffix = crypto.randomBytes(8).toString('hex');

let failures = 0;
let adminCookie;
let kelompokCookie;
let desaCookie;
let kelompokId;
let desaId;
let pertemuanPertama;
let pertemuanKedua;
let absensiB;
const generus = {};

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

  const text = await response.text();
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

async function findKelompok() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL wajib diisi untuk mencari kelompok contoh.');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const result = await client.query(
      `SELECT k.id, k.desa_id
       FROM kelompok k
       JOIN desa d ON d.id = k.desa_id
       JOIN daerah a ON a.id = d.daerah_id
       WHERE a.nama = $1 AND d.nama = $2 AND k.nama = $3`,
      ['Daerah Contoh', 'Desa Contoh 2', 'Kelompok Contoh B']
    );

    assert.equal(result.rowCount, 1, 'Kelompok contoh tidak ditemukan.');
    return result.rows[0];
  } finally {
    await client.end();
  }
}

async function createAndLogin(role, scope) {
  const email = `${role}-${suffix}@tes.gensa.local`;
  const created = await request('POST', '/api/users', {
    email,
    role,
    ...scope,
  }, adminCookie);

  assert.equal(created.response.status, 201);
  assert.equal(created.data.user.role, role);
  assert.equal(typeof created.data.initial_password, 'string');

  const login = await request('POST', '/api/login', {
    email,
    password: created.data.initial_password,
  });

  assert.equal(login.response.status, 200);
  assert.ok(login.cookie);

  const newPassword = `Tes${crypto.randomBytes(16).toString('hex')}`;
  const changed = await request('POST', '/api/change-password', {
    old_password: created.data.initial_password,
    new_password: newPassword,
  }, login.cookie);

  assert.equal(changed.response.status, 200);
  return { cookie: login.cookie, user: created.data.user };
}

function dataGenerus(nama, tingkat) {
  return {
    nama: `Generus ${nama} ${suffix}`,
    tanggal_lahir: '2015-05-10',
    kelas_sekolah: tingkat === 'sd' ? 'Kelas 4' : 'Kelas 7',
    tingkat,
    ortu_nama: 'Orang Tua Tes',
    ortu_hubungan: 'Ibu',
    ortu_hp: '081234567890',
  };
}

async function daftarAbsensi(id, cookie = kelompokCookie) {
  const result = await request(
    'GET',
    `/api/pertemuan/${id}/absensi`,
    undefined,
    cookie
  );
  assert.equal(result.response.status, 200);
  assert.ok(Array.isArray(result.data.absensi));
  return result.data.absensi;
}

async function main() {
  if (!ADMIN_PASSWORD || !ADMIN_PASSWORD.trim()) {
    console.error('FAIL: ADMIN_PASSWORD wajib diisi.');
    process.exitCode = 1;
    return;
  }

  await check('Admin masuk dan membuat akun kelompok', async () => {
    const location = await findKelompok();
    kelompokId = location.id;
    desaId = location.desa_id;

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

    const account = await createAndLogin('kelompok', {
      kelompok_id: kelompokId,
    });
    assert.equal(account.user.kelompok_id, kelompokId);
    kelompokCookie = account.cookie;
  });

  await check('Kelompok mengajukan generus A, B, dan C', async () => {
    assert.ok(kelompokCookie, 'Akun kelompok belum tersedia.');

    for (const [nama, tingkat] of [['A', 'sd'], ['B', 'sd'], ['C', 'smp']]) {
      const result = await request(
        'POST',
        '/api/generus',
        dataGenerus(nama, tingkat),
        kelompokCookie
      );
      assert.equal(result.response.status, 201);
      assert.equal(result.data.generus.status, 'pending');
      generus[nama] = result.data.generus;
    }
  });

  await check('Admin menyetujui ketiga generus', async () => {
    assert.ok(adminCookie && generus.A && generus.B && generus.C);

    for (const nama of ['A', 'B', 'C']) {
      const result = await request(
        'POST',
        `/api/generus/${generus[nama].id}/approve`,
        {},
        adminCookie
      );
      assert.equal(result.response.status, 200);
      assert.match(result.data.generus.qr_token, /^[a-f0-9]{32}$/);
      assert.match(result.data.generus.kode_manual, /^[A-HJ-NP-Z2-9]{6}$/);
      generus[nama] = result.data.generus;
    }
  });

  await check('Kelompok membuat pertemuan pertama', async () => {
    const result = await request('POST', '/api/pertemuan', {
      tingkat: 'kelompok',
      kelompok_id: kelompokId,
      jenjang: ['caberawit'],
      tanggal: new Date().toISOString().slice(0, 10),
    }, kelompokCookie);

    assert.equal(result.response.status, 201);
    assert.ok(result.data.pertemuan.id);
    pertemuanPertama = result.data.pertemuan.id;
  });

  await check('Kode manual A mencatat hadir', async () => {
    const result = await request(
      'POST',
      `/api/pertemuan/${pertemuanPertama}/absen`,
      { kode: generus.A.kode_manual },
      kelompokCookie
    );
    assert.equal(result.response.status, 200);
    assert.equal(result.data.absensi.status, 'hadir');
    assert.equal((await daftarAbsensi(pertemuanPertama)).length, 1);
  });

  await check('QR A tidak membuat absensi ganda', async () => {
    const result = await request(
      'POST',
      `/api/pertemuan/${pertemuanPertama}/absen`,
      { kode: generus.A.qr_token },
      kelompokCookie
    );
    assert.equal(result.response.status, 200);
    assert.equal(result.data.absensi.status, 'hadir');
    assert.equal((await daftarAbsensi(pertemuanPertama)).length, 1);
  });

  await check('Generus di luar jenjang ditolak', async () => {
    const result = await request(
      'POST',
      `/api/pertemuan/${pertemuanPertama}/absen`,
      { kode: generus.C.kode_manual },
      kelompokCookie
    );
    assert.equal(result.response.status, 404);
  });

  await check('Kode yang salah ditolak', async () => {
    const result = await request(
      'POST',
      `/api/pertemuan/${pertemuanPertama}/absen`,
      { kode: 'kode-salah' },
      kelompokCookie
    );
    assert.equal(result.response.status, 404);
  });

  await check('Kelompok mencatat izin B', async () => {
    const result = await request(
      'POST',
      `/api/pertemuan/${pertemuanPertama}/absen-manual`,
      { generus_id: generus.B.id, status: 'izin' },
      kelompokCookie
    );
    assert.equal(result.response.status, 200);
    assert.equal(result.data.absensi.status, 'izin');
  });

  await check('Desa tidak dapat mencatat absen pertemuan kelompok', async () => {
    assert.ok(adminCookie && desaId);
    const account = await createAndLogin('desa', { desa_id: desaId });
    desaCookie = account.cookie;

    const result = await request(
      'POST',
      `/api/pertemuan/${pertemuanPertama}/absen`,
      { kode: generus.A.kode_manual },
      desaCookie
    );
    assert.equal(result.response.status, 403);
  });

  await check('Penutupan pertemuan dan penandaan alfa', async () => {
    let result = await request(
      'POST',
      `/api/pertemuan/${pertemuanPertama}/selesai`,
      {},
      kelompokCookie
    );
    assert.equal(result.response.status, 200);

    let rows = await daftarAbsensi(pertemuanPertama);
    assert.equal(rows.length, 2);
    assert.equal(rows.find((row) => row.generus_id === generus.A.id)?.status, 'hadir');
    assert.equal(rows.find((row) => row.generus_id === generus.B.id)?.status, 'izin');
    assert.ok(!rows.some((row) => row.generus_id === generus.C.id));
    assert.ok(!rows.some((row) => row.status === 'alfa'));

    result = await request('POST', '/api/pertemuan', {
      tingkat: 'kelompok',
      kelompok_id: kelompokId,
      jenjang: ['caberawit', 'pra_remaja'],
      tanggal: new Date().toISOString().slice(0, 10),
    }, kelompokCookie);
    assert.equal(result.response.status, 201);
    pertemuanKedua = result.data.pertemuan.id;

    result = await request(
      'POST',
      `/api/pertemuan/${pertemuanKedua}/absen`,
      { kode: generus.A.kode_manual },
      kelompokCookie
    );
    assert.equal(result.response.status, 200);

    result = await request(
      'POST',
      `/api/pertemuan/${pertemuanKedua}/selesai`,
      {},
      kelompokCookie
    );
    assert.equal(result.response.status, 200);

    rows = await daftarAbsensi(pertemuanKedua);
    assert.equal(rows.length, 3);
    assert.equal(rows.find((row) => row.generus_id === generus.A.id)?.status, 'hadir');
    const rowB = rows.find((row) => row.generus_id === generus.B.id);
    assert.equal(rowB?.status, 'alfa');
    assert.equal(rows.find((row) => row.generus_id === generus.C.id)?.status, 'alfa');
    absensiB = rowB.id;
  });

  await check('Koreksi B hanya dapat dilakukan satu kali', async () => {
    const url = `/api/pertemuan/${pertemuanKedua}/absensi/${absensiB}/koreksi`;
    let result = await request('POST', url, { status: 'hadir' }, kelompokCookie);
    assert.equal(result.response.status, 200);
    assert.equal(result.data.absensi.status, 'hadir');

    result = await request('POST', url, { status: 'izin' }, kelompokCookie);
    assert.equal(result.response.status, 409);
  });

  await check('QR A tersedia sebagai SVG', async () => {
    const result = await request(
      'GET',
      `/api/generus/${generus.A.id}/qr.svg`,
      undefined,
      kelompokCookie
    );
    assert.equal(result.response.status, 200);
    assert.match(result.response.headers.get('content-type') || '', /image\/svg\+xml/i);
    assert.match(result.text, /<svg\b/i);
  });

  await check('Halaman cetak QR tersedia', async () => {
    const result = await request('GET', '/cetak-qr.html');
    assert.equal(result.response.status, 200);
    assert.match(result.response.headers.get('content-type') || '', /text\/html/i);
  });

  await check('Daftar pertemuan kelompok mengikuti wilayah', async () => {
    const result = await request('GET', '/api/pertemuan', undefined, kelompokCookie);
    assert.equal(result.response.status, 200);
    assert.ok(Array.isArray(result.data.pertemuan));
    assert.ok(result.data.pertemuan.some((item) => item.id === pertemuanPertama));
    assert.ok(result.data.pertemuan.some((item) => item.id === pertemuanKedua));
    assert.ok(result.data.pertemuan.every((item) =>
      (item.tingkat === 'kelompok' && item.kelompok_id === kelompokId) ||
      (item.tingkat === 'desa' && item.desa_id === desaId) ||
      item.tingkat === 'daerah'
    ));
  });

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
