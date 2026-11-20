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
let desa1Id;
const generus = {};
const tugas = {};

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

async function setupKelompokS6() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL wajib diisi untuk menyiapkan kelompok tes.');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const desa = await client.query(
      "SELECT id, nama FROM desa WHERE nama IN ('Desa Contoh 3', 'Desa Contoh 1')"
    );
    assert.equal(desa.rowCount, 2, 'Desa Contoh 3 dan Desa Contoh 1 harus tersedia.');
    const desa3Id = desa.rows.find((row) => row.nama === 'Desa Contoh 3').id;
    desa1Id = desa.rows.find((row) => row.nama === 'Desa Contoh 1').id;

    const kelompokNama = `Kelompok S6 ${suffix}`;
    const created = await client.query(
      'INSERT INTO kelompok (nama, desa_id) VALUES ($1, $2) RETURNING id',
      [kelompokNama, desa3Id]
    );
    kelompokId = created.rows[0].id;
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

async function buatGenerusDisetujui(nama, tingkat) {
  const created = await request(
    'POST',
    '/api/generus',
    dataGenerus(nama, tingkat),
    kelompokCookie
  );
  assert.equal(created.response.status, 201);

  const approved = await request(
    'POST',
    `/api/generus/${created.data.generus.id}/approve`,
    {},
    adminCookie
  );
  assert.equal(approved.response.status, 200);
  generus[nama] = approved.data.generus;
}

async function buatTugas(judul, kategori, cookie = kelompokCookie) {
  const result = await request(
    'POST',
    '/api/tugas',
    { judul: `${judul} ${suffix}`, kategori },
    cookie
  );
  assert.equal(result.response.status, 201);
  assert.ok(result.data.tugas.id);
  return result.data.tugas;
}

async function nilai(generusId, tugasId, nilaiValue, cookie = kelompokCookie) {
  return request(
    'POST',
    '/api/penilaian',
    { generus_id: generusId, tugas_id: tugasId, nilai: nilaiValue },
    cookie
  );
}

async function main() {
  if (!ADMIN_PASSWORD || !ADMIN_PASSWORD.trim()) {
    console.error('FAIL: ADMIN_PASSWORD wajib diisi.');
    process.exitCode = 1;
    return;
  }

  await check('Admin masuk dan membuat akun kelompok S6', async () => {
    await setupKelompokS6();

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

    await buatGenerusDisetujui('E', 'sd');
    await buatGenerusDisetujui('F', 'sd');
    await buatGenerusDisetujui('G', 'smp');
  });

  await check('Kelompok membuat tugas, desa tidak boleh', async () => {
    tugas.doa1 = await buatTugas('Doa Harian', 'doa_surat');
    tugas.doa2 = await buatTugas('Surat Pendek', 'doa_surat');
    tugas.pegon = await buatTugas('Makna Pegon', 'makna_pegon');
    tugas.solat = await buatTugas('Praktik Solat', 'praktik_solat');

    const salah = await request(
      'POST',
      '/api/tugas',
      { judul: 'Salah', kategori: 'salah' },
      kelompokCookie
    );
    assert.equal(salah.response.status, 400);

    const desaLain = await createAndLogin('desa', { desa_id: desa1Id });
    desaLainCookie = desaLain.cookie;

    const olehDesa = await request(
      'POST',
      '/api/tugas',
      { judul: 'Oleh Desa', kategori: 'doa_surat' },
      desaLainCookie
    );
    assert.equal(olehDesa.response.status, 403);

    // Tugas global Admin (makna_pegon supaya total hafalan tetap 2).
    tugas.global = await buatTugas('Pegon Admin', 'makna_pegon', adminCookie);
    assert.equal(tugas.global.kelompok_id, null);

    const daftar = await request('GET', '/api/tugas', undefined, kelompokCookie);
    assert.equal(daftar.response.status, 200);
    for (const key of ['doa1', 'doa2', 'pegon', 'solat', 'global']) {
      assert.ok(
        daftar.data.tugas.some((row) => row.id === tugas[key].id),
        `Tugas ${key} tidak terlihat.`
      );
    }
  });

  await check('Penilaian dicatat dan % hasil dihitung', async () => {
    const r1 = await nilai(generus.E.id, tugas.doa1.id, 'hafal');
    assert.equal(r1.response.status, 200);
    assert.equal(r1.data.penilaian.nilai, 'hafal');
    assert.equal(r1.data.penilaian.diubah_count, 0);

    const r2 = await nilai(generus.E.id, tugas.doa2.id, 'hafal');
    assert.equal(r2.response.status, 200);

    const r3 = await nilai(generus.F.id, tugas.doa1.id, 'belum');
    assert.equal(r3.response.status, 200);

    const r4 = await nilai(generus.G.id, tugas.pegon.id, 'bisa');
    assert.equal(r4.response.status, 200);

    const hasil = await request(
      'GET',
      '/api/penilaian',
      undefined,
      kelompokCookie
    );
    assert.equal(hasil.response.status, 200);
    assert.ok(Array.isArray(hasil.data.tugas));
    assert.ok(Array.isArray(hasil.data.penilaian));
    assert.ok(Array.isArray(hasil.data.hasil));

    const rowE = hasil.data.hasil.find((row) => row.generus_id === generus.E.id);
    assert.deepEqual([rowE.hafal, rowE.total_hafalan, rowE.persen], [2, 2, 100]);

    const rowF = hasil.data.hasil.find((row) => row.generus_id === generus.F.id);
    assert.deepEqual([rowF.hafal, rowF.total_hafalan, rowF.persen], [0, 2, 0]);

    const rowG = hasil.data.hasil.find((row) => row.generus_id === generus.G.id);
    assert.deepEqual([rowG.hafal, rowG.total_hafalan, rowG.persen], [0, 2, 0]);
    assert.equal(rowG.ortu_hp, '081234567890');
  });

  await check('Nilai tidak cocok dengan kategori ditolak', async () => {
    const r1 = await nilai(generus.E.id, tugas.doa1.id, 'bisa');
    assert.equal(r1.response.status, 400);

    const r2 = await nilai(generus.E.id, tugas.pegon.id, 'hafal');
    assert.equal(r2.response.status, 400);
  });

  await check('Nilai boleh diubah 2 kali, ke-3 ditolak, Admin membuka lagi', async () => {
    const c1 = await nilai(generus.E.id, tugas.doa1.id, 'belum');
    assert.equal(c1.response.status, 200);
    assert.equal(c1.data.penilaian.diubah_count, 1);

    const c2 = await nilai(generus.E.id, tugas.doa1.id, 'hafal');
    assert.equal(c2.response.status, 200);
    assert.equal(c2.data.penilaian.diubah_count, 2);

    const c3 = await nilai(generus.E.id, tugas.doa1.id, 'belum');
    assert.equal(c3.response.status, 403);

    const olehAdmin = await nilai(
      generus.E.id, tugas.doa1.id, 'belum', adminCookie
    );
    assert.equal(olehAdmin.response.status, 200);
    assert.equal(olehAdmin.data.penilaian.diubah_count, 0);
    assert.equal(olehAdmin.data.penilaian.nilai, 'belum');

    const desa = await nilai(
      generus.E.id, tugas.doa1.id, 'hafal', desaLainCookie
    );
    assert.equal(desa.response.status, 403);
  });

  await check('Tugas berpenilaian tidak bisa dihapus', async () => {
    const hapusAda = await request(
      'DELETE',
      `/api/tugas/${tugas.doa1.id}`,
      undefined,
      kelompokCookie
    );
    assert.equal(hapusAda.response.status, 409);

    const hapusKosong = await request(
      'DELETE',
      `/api/tugas/${tugas.solat.id}`,
      undefined,
      kelompokCookie
    );
    assert.equal(hapusKosong.response.status, 200);
    assert.equal(hapusKosong.data.ok, true);

    const daftar = await request('GET', '/api/tugas', undefined, kelompokCookie);
    assert.ok(!daftar.data.tugas.some((row) => row.id === tugas.solat.id));
  });

  await check('Halaman materi tersedia sebagai HTML', async () => {
    const result = await request('GET', '/materi.html', undefined, kelompokCookie);
    assert.equal(result.response.status, 200);
    assert.match(result.response.headers.get('content-type') || '', /text\/html/i);
    assert.match(result.text, /Materi &amp; Penilaian/);
    assert.match(result.text, /\/api\/penilaian/);
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
