'use strict';

// Smoke test Sesi 9 — Absen offline (GENSA).
// Menguji: GET /api/pertemuan/:id/daftar, POST /api/pertemuan/:id/sync
// (idempotensi client_id, aturan "hadir yang menang", penolakan per
// item, 409 bila pertemuan selesai), dan halaman scan.html memuat
// antrean offline. Alur offline di browser (localStorage) tidak bisa
// diuji dari sini — yang diuji adalah kontrak server + keberadaan
// kode halaman.

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
const suffix = crypto.randomBytes(8).toString('hex');

let failures = 0;
let adminCookie;
let kelompokCookie;
let kelompokLainCookie;
let kelompokId;
let kelompokLainId;
const generus = {};
let pertemuan1;
let pertemuan2;

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

  let data = {};
  let text = '';
  try {
    text = await response.text();
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

async function queryDb(sql, params = []) {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL wajib diisi.');
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}

async function setupKelompok() {
  const desa = await queryDb(
    "SELECT id, nama FROM desa WHERE nama IN ('Desa Contoh 3', 'Desa Contoh 1')"
  );
  assert.equal(desa.rowCount, 2, 'Desa Contoh 3 dan Desa Contoh 1 harus tersedia.');
  const desa3Id = desa.rows.find((row) => row.nama === 'Desa Contoh 3').id;
  const desa1Id = desa.rows.find((row) => row.nama === 'Desa Contoh 1').id;

  const created = await queryDb(
    'INSERT INTO kelompok (nama, desa_id) VALUES ($1, $2) RETURNING id',
    [`Kelompok S9 ${suffix}`, desa3Id]
  );
  kelompokId = created.rows[0].id;

  const createdLain = await queryDb(
    'INSERT INTO kelompok (nama, desa_id) VALUES ($1, $2) RETURNING id',
    [`Kelompok S9-lain ${suffix}`, desa1Id]
  );
  kelompokLainId = createdLain.rows[0].id;
}

async function restoreAdminFlag() {
  if (!process.env.DATABASE_URL) return;
  await queryDb(
    'UPDATE users SET must_change_password = true WHERE email = $1',
    [ADMIN_EMAIL]
  );
}

async function createAndLogin(role, scope) {
  const email = `${role}-${suffix}-${Math.floor(Math.random() * 100000)}@tes.gensa.local`;
  const created = await request('POST', '/api/users', {
    email,
    role,
    ...scope,
  }, adminCookie);

  assert.equal(created.response.status, 201);
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

async function buatGenerusDisetujui(nama, tingkat, cookie) {
  const created = await request(
    'POST',
    '/api/generus',
    dataGenerus(nama, tingkat),
    cookie
  );
  assert.equal(created.response.status, 201);
  assert.equal(created.data.generus.status, 'pending');

  const approved = await request(
    'POST',
    `/api/generus/${created.data.generus.id}/approve`,
    {},
    adminCookie
  );
  assert.equal(approved.response.status, 200);
  assert.equal(approved.data.generus.status, 'approved');
  generus[nama] = approved.data.generus;
}

async function buatPertemuan(tanggal, jenjang) {
  const result = await request('POST', '/api/pertemuan', {
    tingkat: 'kelompok',
    kelompok_id: kelompokId,
    jenjang,
    tanggal,
  }, kelompokCookie);

  assert.equal(result.response.status, 201);
  assert.ok(result.data.pertemuan.id);
  return result.data.pertemuan;
}

async function sync(pertemuanId, items, cookie) {
  return request(
    'POST',
    `/api/pertemuan/${pertemuanId}/sync`,
    { items },
    cookie || kelompokCookie
  );
}

async function statusAbsensi(pertemuanId, generusId) {
  const result = await queryDb(
    'SELECT status, dicatat_pada FROM absensi WHERE pertemuan_id = $1 AND generus_id = $2',
    [pertemuanId, generusId]
  );
  return result.rows[0] || null;
}

async function main() {
  if (!ADMIN_PASSWORD || !ADMIN_PASSWORD.trim()) {
    console.error('FAIL: ADMIN_PASSWORD wajib diisi.');
    process.exitCode = 1;
    return;
  }

  await check('Admin masuk dan membuat akun kelompok S9', async () => {
    await setupKelompok();

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
    kelompokCookie = account.cookie;

    const accountLain = await createAndLogin('kelompok', {
      kelompok_id: kelompokLainId,
    });
    kelompokLainCookie = accountLain.cookie;
  });

  await check('Daftar generus pertemuan memuat kode untuk offline', async () => {
    await buatGenerusDisetujui('A', 'sd', kelompokCookie);
    await buatGenerusDisetujui('B', 'smp', kelompokCookie);
    await buatGenerusDisetujui('C', 'sd', kelompokCookie);
    await buatGenerusDisetujui('D', 'sd', kelompokLainCookie);

    const pertemuan = await buatPertemuan(hariIni(), ['caberawit', 'pra_remaja']);
    pertemuan1 = pertemuan.id;

    const daftar = await request(
      'GET',
      `/api/pertemuan/${pertemuan1}/daftar`,
      undefined,
      kelompokCookie
    );
    assert.equal(daftar.response.status, 200);
    assert.equal(daftar.data.pertemuan.id, pertemuan1);
    assert.equal(daftar.data.generus.length, 3);
    for (const row of daftar.data.generus) {
      assert.equal(typeof row.kode_manual, 'string');
      assert.equal(row.kode_manual.length, 6);
      assert.equal(typeof row.qr_token, 'string');
      assert.equal(row.qr_token.length, 32);
    }
    const nama = daftar.data.generus.map((row) => row.nama);
    assert.ok(!nama.includes(generus.D.nama), 'Generus kelompok lain tidak boleh ikut.');
  });

  await check('Kelompok lain tidak boleh mengunduh daftar', async () => {
    const daftar = await request(
      'GET',
      `/api/pertemuan/${pertemuan1}/daftar`,
      undefined,
      kelompokLainCookie
    );
    assert.equal(daftar.response.status, 404);
  });

  await check('Sync mencatat hadir dan izin, dicatat_pada tersimpan', async () => {
    const result = await sync(pertemuan1, [
      {
        generus_id: generus.A.id,
        status: 'hadir',
        client_id: `s9-${suffix}-a1`,
        dicatat_pada: '2026-11-21T03:00:00.000Z',
      },
      {
        generus_id: generus.B.id,
        status: 'izin',
        client_id: `s9-${suffix}-b1`,
        dicatat_pada: '2026-11-21T03:05:00.000Z',
      },
    ]);
    assert.equal(result.response.status, 200);
    assert.equal(result.data.hasil.length, 2);
    assert.deepEqual(
      result.data.hasil.map((row) => [row.generus_id, row.diterima, row.status]),
      [
        [generus.A.id, true, 'hadir'],
        [generus.B.id, true, 'izin'],
      ]
    );

    const rowA = await statusAbsensi(pertemuan1, generus.A.id);
    assert.equal(rowA.status, 'hadir');
    assert.equal(
      new Date(rowA.dicatat_pada).toISOString(),
      '2026-11-21T03:00:00.000Z'
    );
    const rowB = await statusAbsensi(pertemuan1, generus.B.id);
    assert.equal(rowB.status, 'izin');
  });

  await check('Kirim ulang client_id yang sama tidak double', async () => {
    const result = await sync(pertemuan1, [
      {
        generus_id: generus.A.id,
        status: 'hadir',
        client_id: `s9-${suffix}-a1`,
        dicatat_pada: '2026-11-21T03:00:00.000Z',
      },
      {
        generus_id: generus.B.id,
        status: 'izin',
        client_id: `s9-${suffix}-b1`,
        dicatat_pada: '2026-11-21T03:05:00.000Z',
      },
    ]);
    assert.equal(result.response.status, 200);
    assert.equal(result.data.hasil.length, 2);
    assert.ok(result.data.hasil.every((row) => row.sudah_ada === true));

    const jumlah = await queryDb(
      'SELECT count(*)::integer AS n FROM absensi WHERE pertemuan_id = $1',
      [pertemuan1]
    );
    assert.equal(jumlah.rows[0].n, 2);
  });

  await check('Hadir menang atas izin/sakit, bukan-hadir pertama menang', async () => {
    // B: izin -> hadir (menang), lalu hadir -> sakit (tetap hadir).
    const naik = await sync(pertemuan1, [
      {
        generus_id: generus.B.id,
        status: 'hadir',
        client_id: `s9-${suffix}-b2`,
        dicatat_pada: '2026-11-21T03:10:00.000Z',
      },
    ]);
    assert.equal(naik.response.status, 200);
    assert.equal(naik.data.hasil[0].status, 'hadir');
    assert.equal((await statusAbsensi(pertemuan1, generus.B.id)).status, 'hadir');

    const turun = await sync(pertemuan1, [
      {
        generus_id: generus.B.id,
        status: 'sakit',
        client_id: `s9-${suffix}-b3`,
        dicatat_pada: '2026-11-21T03:15:00.000Z',
      },
    ]);
    assert.equal(turun.response.status, 200);
    assert.equal(turun.data.hasil[0].status, 'hadir');
    assert.equal((await statusAbsensi(pertemuan1, generus.B.id)).status, 'hadir');

    // C: sakit dulu, lalu izin — sakit pertama menang.
    const sakit = await sync(pertemuan1, [
      {
        generus_id: generus.C.id,
        status: 'sakit',
        client_id: `s9-${suffix}-c1`,
        dicatat_pada: '2026-11-21T03:20:00.000Z',
      },
    ]);
    assert.equal(sakit.data.hasil[0].status, 'sakit');

    const izin = await sync(pertemuan1, [
      {
        generus_id: generus.C.id,
        status: 'izin',
        client_id: `s9-${suffix}-c2`,
        dicatat_pada: '2026-11-21T03:25:00.000Z',
      },
    ]);
    assert.equal(izin.data.hasil[0].status, 'sakit');
    assert.equal((await statusAbsensi(pertemuan1, generus.C.id)).status, 'sakit');
  });

  await check('Item di luar lingkup dan tidak valid ditolak per item', async () => {
    const result = await sync(pertemuan1, [
      {
        generus_id: generus.D.id,
        status: 'hadir',
        client_id: `s9-${suffix}-d1`,
      },
      {
        generus_id: generus.A.id,
        status: 'alfa',
        client_id: `s9-${suffix}-a2`,
      },
      {
        generus_id: 'bukan-id',
        status: 'hadir',
        client_id: `s9-${suffix}-x1`,
      },
    ]);
    assert.equal(result.response.status, 200);
    assert.equal(result.data.hasil.length, 3);
    assert.deepEqual(
      result.data.hasil.map((row) => row.diterima),
      [false, false, false]
    );
    assert.equal((await statusAbsensi(pertemuan1, generus.A.id)).status, 'hadir');
  });

  await check('Sync kosong dan lebih dari 200 item ditolak 400', async () => {
    const kosong = await sync(pertemuan1, []);
    assert.equal(kosong.response.status, 400);

    const banyak = await sync(
      pertemuan1,
      Array.from({ length: 201 }, (_, i) => ({
        generus_id: generus.A.id,
        status: 'hadir',
        client_id: `s9-${suffix}-m${i}`,
      }))
    );
    assert.equal(banyak.response.status, 400);
  });

  await check('Sync ke pertemuan yang sudah selesai ditolak 409', async () => {
    const pertemuan = await buatPertemuan(hariIni(), ['caberawit', 'pra_remaja']);
    pertemuan2 = pertemuan.id;
    const tutup = await request(
      'POST',
      `/api/pertemuan/${pertemuan2}/selesai`,
      {},
      kelompokCookie
    );
    assert.equal(tutup.response.status, 200);

    const result = await sync(pertemuan2, [
      {
        generus_id: generus.A.id,
        status: 'hadir',
        client_id: `s9-${suffix}-p2`,
      },
    ]);
    assert.equal(result.response.status, 409);
  });

  await check('Halaman scan memuat antrean offline', async () => {
    const halaman = await request('GET', '/scan.html', undefined, kelompokCookie);
    assert.equal(halaman.response.status, 200);
    assert.ok(halaman.text.includes('Antrean offline'));
    assert.ok(halaman.text.includes('Kirim antrean'));
    assert.ok(halaman.text.includes('kirimAntrean'));
    assert.ok(halaman.text.includes('gensa-antrean-'));
    assert.ok(halaman.text.includes('/sync'));
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
