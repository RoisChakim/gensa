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
let desaLainCookie;
let kelompokId;
let desaId;
let desa1Id;
let pertemuanPertama;
let pertemuanAbsensi;
let pertemuanSelesai;
const generus = {};

function hariIni(offset = 0) {
  const date = new Date(Date.now() + offset * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

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

async function findKelompokC() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL wajib diisi untuk mencari kelompok contoh.');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const result = await client.query(
      `SELECT k.id AS kelompok_id, k.desa_id AS desa_id,
              (SELECT d2.id FROM desa d2 WHERE d2.nama = $4) AS desa1_id
       FROM kelompok k
       JOIN desa d ON d.id = k.desa_id
       JOIN daerah a ON a.id = d.daerah_id
       WHERE a.nama = $1 AND d.nama = $2 AND k.nama = $3`,
      ['Daerah Contoh', 'Desa Contoh 3', 'Kelompok Contoh C', 'Desa Contoh 1']
    );

    assert.equal(result.rowCount, 1, 'Kelompok contoh C tidak ditemukan.');
    assert.ok(result.rows[0].desa1_id, 'Desa Contoh 1 tidak ditemukan.');
    return result.rows[0];
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

async function buatPertemuan(cookie, jenjang = ['caberawit']) {
  const result = await request('POST', '/api/pertemuan', {
    tingkat: 'kelompok',
    kelompok_id: kelompokId,
    jenjang,
    tanggal: hariIni(),
  }, cookie);

  assert.equal(result.response.status, 201);
  assert.ok(result.data.pertemuan.id);
  return result.data.pertemuan;
}

async function main() {
  if (!ADMIN_PASSWORD || !ADMIN_PASSWORD.trim()) {
    console.error('FAIL: ADMIN_PASSWORD wajib diisi.');
    process.exitCode = 1;
    return;
  }

  await check('Admin masuk dan membuat akun kelompok C', async () => {
    const location = await findKelompokC();
    kelompokId = location.kelompok_id;
    desaId = location.desa_id;
    desa1Id = location.desa1_id;

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

  await check('Kelompok C membuat pertemuan', async () => {
    const pertemuan = await buatPertemuan(kelompokCookie);
    assert.equal(pertemuan.tanggal.slice(0, 10), hariIni());
    assert.deepEqual(pertemuan.jenjang_target, ['caberawit']);
    pertemuanPertama = pertemuan.id;
  });

  await check('PATCH mengubah tanggal dan jenjang', async () => {
    const result = await request(
      'PATCH',
      `/api/pertemuan/${pertemuanPertama}`,
      { tanggal: hariIni(1), jenjang: ['pra_remaja', 'remaja', 'remaja'] },
      kelompokCookie
    );
    assert.equal(result.response.status, 200);
    assert.equal(result.data.pertemuan.tanggal.slice(0, 10), hariIni(1));
    assert.deepEqual(result.data.pertemuan.jenjang_target, ['pra_remaja', 'remaja']);
  });

  await check('PATCH menolak jenjang kosong', async () => {
    const result = await request(
      'PATCH',
      `/api/pertemuan/${pertemuanPertama}`,
      { jenjang: [] },
      kelompokCookie
    );
    assert.equal(result.response.status, 400);
    assert.equal(result.data.error, 'Jenjang pertemuan tidak valid.');
  });

  await check('Desa lain tidak boleh mengubah pertemuan kelompok C', async () => {
    const account = await createAndLogin('desa', { desa_id: desa1Id });
    desaLainCookie = account.cookie;

    const result = await request(
      'PATCH',
      `/api/pertemuan/${pertemuanPertama}`,
      { tanggal: hariIni() },
      desaLainCookie
    );
    assert.equal(result.response.status, 403);
  });

  await check('Admin boleh mengubah dan mengembalikan tanggal ke hari ini', async () => {
    const result = await request(
      'PATCH',
      `/api/pertemuan/${pertemuanPertama}`,
      { tanggal: hariIni() },
      adminCookie
    );
    assert.equal(result.response.status, 200);
    assert.equal(result.data.pertemuan.tanggal.slice(0, 10), hariIni());
    assert.deepEqual(result.data.pertemuan.jenjang_target, ['pra_remaja', 'remaja']);
  });

  await check('Pertemuan tanpa absensi dapat dihapus', async () => {
    const result = await request(
      'DELETE',
      `/api/pertemuan/${pertemuanPertama}`,
      undefined,
      kelompokCookie
    );
    assert.equal(result.response.status, 200);
    assert.equal(result.data.ok, true);

    const after = await request(
      'GET',
      `/api/pertemuan/${pertemuanPertama}`,
      undefined,
      kelompokCookie
    );
    assert.equal(after.response.status, 404);
  });

  await check('Pertemuan dengan absensi tidak dapat dihapus', async () => {
    const pertemuan = await buatPertemuan(kelompokCookie);
    pertemuanAbsensi = pertemuan.id;

    const created = await request(
      'POST',
      '/api/generus',
      dataGenerus('D', 'sd'),
      kelompokCookie
    );
    assert.equal(created.response.status, 201);
    assert.equal(created.data.generus.status, 'pending');
    generus.D = created.data.generus;

    const approved = await request(
      'POST',
      `/api/generus/${generus.D.id}/approve`,
      {},
      adminCookie
    );
    assert.equal(approved.response.status, 200);
    generus.D = approved.data.generus;

    const absen = await request(
      'POST',
      `/api/pertemuan/${pertemuanAbsensi}/absen-manual`,
      { generus_id: generus.D.id, status: 'hadir' },
      kelompokCookie
    );
    assert.equal(absen.response.status, 200);
    assert.equal(absen.data.absensi.status, 'hadir');

    const hapus = await request(
      'DELETE',
      `/api/pertemuan/${pertemuanAbsensi}`,
      undefined,
      kelompokCookie
    );
    assert.equal(hapus.response.status, 409);
    assert.equal(hapus.data.error, 'Pertemuan sudah memiliki absensi.');

    const masihAda = await request(
      'GET',
      `/api/pertemuan/${pertemuanAbsensi}`,
      undefined,
      kelompokCookie
    );
    assert.equal(masihAda.response.status, 200);
    assert.equal(masihAda.data.ringkasan.hadir, 1);
  });

  await check('Pertemuan selesai tidak dapat diubah atau dihapus', async () => {
    const pertemuan = await buatPertemuan(kelompokCookie);
    pertemuanSelesai = pertemuan.id;

    const tutup = await request(
      'POST',
      `/api/pertemuan/${pertemuanSelesai}/selesai`,
      {},
      kelompokCookie
    );
    assert.equal(tutup.response.status, 200);

    const ubah = await request(
      'PATCH',
      `/api/pertemuan/${pertemuanSelesai}`,
      { tanggal: hariIni(1) },
      kelompokCookie
    );
    assert.equal(ubah.response.status, 409);
    assert.equal(ubah.data.error, 'Pertemuan sudah selesai.');

    const hapus = await request(
      'DELETE',
      `/api/pertemuan/${pertemuanSelesai}`,
      undefined,
      kelompokCookie
    );
    assert.equal(hapus.response.status, 409);
    assert.equal(hapus.data.error, 'Pertemuan sudah selesai.');
  });

  await check('Daftar kelompok memuat pertemuan dan mengikuti wilayah', async () => {
    const result = await request(
      'GET',
      '/api/pertemuan?tingkat=kelompok',
      undefined,
      kelompokCookie
    );
    assert.equal(result.response.status, 200);
    assert.ok(Array.isArray(result.data.pertemuan));
    assert.ok(result.data.pertemuan.some((item) => item.id === pertemuanAbsensi));
    assert.ok(result.data.pertemuan.some((item) => item.id === pertemuanSelesai));
    assert.ok(!result.data.pertemuan.some((item) => item.id === pertemuanPertama));
    assert.ok(result.data.pertemuan.every((item) =>
      item.tingkat === 'kelompok' && item.kelompok_id === kelompokId
    ));

    const luar = await request(
      'GET',
      '/api/pertemuan?tingkat=kelompok',
      undefined,
      desaLainCookie
    );
    assert.equal(luar.response.status, 200);
    assert.ok(Array.isArray(luar.data.pertemuan));
    assert.ok(!luar.data.pertemuan.some((item) => item.kelompok_id === kelompokId));
  });

  await check('Halaman jadwal tersedia sebagai HTML', async () => {
    const result = await request('GET', '/jadwal.html', undefined, kelompokCookie);
    assert.equal(result.response.status, 200);
    assert.match(result.response.headers.get('content-type') || '', /text\/html/i);
    assert.match(result.text, /Jadwal Pengajian/);
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
