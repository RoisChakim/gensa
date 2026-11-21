'use strict';

// Smoke test Sesi 10 — Link izin (GENSA).
// Menguji: GET /api/izin publik (berjenjang, tanpa bocor kode),
// POST /api/izin (verifikasi kode, duplikat, alasan izin wajib),
// GET /api/pertemuan/:id/link-izin, GET /api/pertemuan/:id/izin,
// POST .../izin/:id/setujui (masuk absensi) dan .../tolak,
// 409 bila pertemuan sudah selesai, serta halaman izin.html,
// izin-kelola.html, dan tombol di jadwal.html.

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
let desaCookie;
let kelompokId;
let kelompokLainId;
let desaId;
const generus = {};
let pertemuanKelompok;
let pertemuanDesa;
let tokenKelompok;
let tokenDesa;
let izinA;
let izinB;

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
  desaId = desa.rows.find((row) => row.nama === 'Desa Contoh 3').id;
  const desa1Id = desa.rows.find((row) => row.nama === 'Desa Contoh 1').id;

  const created = await queryDb(
    'INSERT INTO kelompok (nama, desa_id) VALUES ($1, $2) RETURNING id',
    [`Kelompok S10 ${suffix}`, desaId]
  );
  kelompokId = created.rows[0].id;

  const createdLain = await queryDb(
    'INSERT INTO kelompok (nama, desa_id) VALUES ($1, $2) RETURNING id',
    [`Kelompok S10-lain ${suffix}`, desa1Id]
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

async function buatPertemuanKelompok(tanggal, jenjang) {
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

async function buatPertemuanDesa(tanggal, jenjang) {
  const result = await request('POST', '/api/pertemuan', {
    tingkat: 'desa',
    desa_id: desaId,
    jenjang,
    tanggal,
  }, desaCookie);

  assert.equal(result.response.status, 201);
  assert.ok(result.data.pertemuan.id);
  return result.data.pertemuan;
}

async function ambilToken(pertemuanId, cookie) {
  const result = await request(
    'GET',
    `/api/pertemuan/${pertemuanId}/link-izin`,
    undefined,
    cookie
  );
  assert.equal(result.response.status, 200);
  assert.match(result.data.url, /^\/izin\.html\?t=[a-f0-9]{32}$/);
  return result.data.url.split('t=')[1];
}

async function kirimIzinPublik(token, body) {
  return request(
    'POST',
    `/api/izin?t=${token}`,
    body
  );
}

async function main() {
  if (!ADMIN_PASSWORD || !ADMIN_PASSWORD.trim()) {
    console.error('FAIL: ADMIN_PASSWORD wajib diisi.');
    process.exitCode = 1;
    return;
  }

  await check('Admin masuk dan membuat akun S10', async () => {
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

    const accountDesa = await createAndLogin('desa', {
      desa_id: desaId,
    });
    desaCookie = accountDesa.cookie;
  });

  await check('Siapkan generus dan pertemuan S10', async () => {
    await buatGenerusDisetujui('A', 'sd', kelompokCookie);
    await buatGenerusDisetujui('B', 'sd', kelompokCookie);
    await buatGenerusDisetujui('C', 'sd', kelompokCookie);

    pertemuanKelompok = (await buatPertemuanKelompok(hariIni(1), ['caberawit'])).id;
    pertemuanDesa = (await buatPertemuanDesa(hariIni(1), ['caberawit'])).id;

    tokenKelompok = await ambilToken(pertemuanKelompok, kelompokCookie);
    tokenDesa = await ambilToken(pertemuanDesa, desaCookie);
  });

  await check('GET /api/izin tanpa token dan token salah ditolak 404', async () => {
    const tanpa = await request('GET', '/api/izin');
    assert.equal(tanpa.response.status, 404);

    const salah = await request(
      'GET',
      `/api/izin?t=${crypto.randomBytes(16).toString('hex')}`
    );
    assert.equal(salah.response.status, 404);
  });

  // R3 (13C): GET /api/izin tidak lagi memuat nama — nama hanya muncul
  // setelah verifikasi kode lewat POST /api/izin/verifikasi.
  await check('GET /api/izin pertemuan kelompok tanpa nama sebelum verifikasi', async () => {
    const result = await request('GET', `/api/izin?t=${tokenKelompok}`);
    assert.equal(result.response.status, 200);
    assert.equal(result.data.pertemuan.id, pertemuanKelompok);
    assert.equal(result.data.pertemuan.tanggal.slice(0, 10), hariIni(1));
    assert.equal(result.data.pertemuan.tingkat, 'kelompok');
    assert.equal(result.data.generus, undefined);
    assert.ok(!JSON.stringify(result.data).includes(generus.A.kode_manual),
      'kode_manual tidak boleh bocor ke publik.');
    assert.ok(!JSON.stringify(result.data).includes(generus.A.qr_token),
      'qr_token tidak boleh bocor ke publik.');
    assert.ok(!JSON.stringify(result.data).includes(generus.A.nama),
      'nama tidak boleh bocor sebelum verifikasi kode.');
  });

  // R3 (13C): tidak ada daftar kelompok/nama sebelum verifikasi kode;
  // alur baru: masukkan kode dulu lewat POST /api/izin/verifikasi.
  await check('GET /api/izin pertemuan desa tanpa daftar sebelum verifikasi', async () => {
    const awal = await request('GET', `/api/izin?t=${tokenDesa}`);
    assert.equal(awal.response.status, 200);
    assert.equal(awal.data.pertemuan.tingkat, 'desa');
    assert.equal(awal.data.generus, undefined);
    assert.equal(awal.data.kelompok, null);

    const lanjut = await request(
      'GET',
      `/api/izin?t=${tokenDesa}&kelompok_id=${kelompokId}`
    );
    assert.equal(lanjut.response.status, 200);
    assert.equal(lanjut.data.generus, undefined);
  });

  await check('POST /api/izin dengan kode salah ditolak 404', async () => {
    const result = await kirimIzinPublik(tokenKelompok, {
      generus_id: generus.A.id,
      kode: 'ZZZZZZ',
      alasan: 'sakit',
      keterangan: null,
    });
    assert.equal(result.response.status, 404);
  });

  await check('POST /api/izin sakit dengan kode benar masuk menunggu', async () => {
    const result = await kirimIzinPublik(tokenKelompok, {
      generus_id: generus.A.id,
      kode: generus.A.kode_manual,
      alasan: 'sakit',
      keterangan: null,
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.data.izin.status, 'menunggu');
    assert.equal(result.data.izin.alasan, 'sakit');
    izinA = result.data.izin.id;
  });

  await check('POST /api/izin duplikat ditolak 409', async () => {
    const result = await kirimIzinPublik(tokenKelompok, {
      generus_id: generus.A.id,
      kode: generus.A.kode_manual,
      alasan: 'sakit',
      keterangan: null,
    });
    assert.equal(result.response.status, 409);
  });

  await check('Alasan izin tanpa keterangan 400, dengan keterangan 201', async () => {
    const kosong = await kirimIzinPublik(tokenKelompok, {
      generus_id: generus.B.id,
      kode: generus.B.kode_manual,
      alasan: 'izin',
      keterangan: '',
    });
    assert.equal(kosong.response.status, 400);

    const isi = await kirimIzinPublik(tokenKelompok, {
      generus_id: generus.B.id,
      kode: generus.B.kode_manual,
      alasan: 'izin',
      keterangan: 'Ada keperluan keluarga',
    });
    assert.equal(isi.response.status, 201);
    assert.equal(isi.data.izin.status, 'menunggu');
    assert.equal(isi.data.izin.keterangan, 'Ada keperluan keluarga');
    izinB = isi.data.izin.id;
  });

  await check('Pengurus melihat 2 pengajuan menunggu', async () => {
    const result = await request(
      'GET',
      `/api/pertemuan/${pertemuanKelompok}/izin`,
      undefined,
      kelompokCookie
    );
    assert.equal(result.response.status, 200);
    assert.equal(result.data.izin.length, 2);
    assert.ok(result.data.izin.every((row) => row.status === 'menunggu'));
  });

  await check('Setujui izin masuk absensi sebagai sakit', async () => {
    const result = await request(
      'POST',
      `/api/pertemuan/${pertemuanKelompok}/izin/${izinA}/setujui`,
      {},
      kelompokCookie
    );
    assert.equal(result.response.status, 200);
    assert.equal(result.data.izin.status, 'disetujui');
    assert.equal(result.data.absensi.status, 'sakit');

    const absensi = await request(
      'GET',
      `/api/pertemuan/${pertemuanKelompok}/absensi`,
      undefined,
      kelompokCookie
    );
    assert.equal(absensi.response.status, 200);
    const baris = absensi.data.absensi.find(
      (row) => row.generus_id === generus.A.id
    );
    assert.ok(baris, 'Baris absensi generus A harus ada.');
    assert.equal(baris.status, 'sakit');
  });

  await check('Tolak izin dengan catatan', async () => {
    const result = await request(
      'POST',
      `/api/pertemuan/${pertemuanKelompok}/izin/${izinB}/tolak`,
      { catatan: 'Bukti tidak jelas' },
      kelompokCookie
    );
    assert.equal(result.response.status, 200);
    assert.equal(result.data.izin.status, 'ditolak');
    assert.equal(result.data.izin.catatan_penolakan, 'Bukti tidak jelas');
  });

  await check('Putusan kedua pada izin yang sama ditolak 409', async () => {
    const result = await request(
      'POST',
      `/api/pertemuan/${pertemuanKelompok}/izin/${izinB}/setujui`,
      {},
      kelompokCookie
    );
    assert.equal(result.response.status, 409);
  });

  await check('Halaman izin dan tombol jadwal tersedia', async () => {
    const izin = await request('GET', '/izin.html');
    assert.equal(izin.response.status, 200);
    assert.ok(izin.text.includes('Kirim izin'));
    assert.ok(izin.text.includes('Scan barcode'));

    const kelola = await request('GET', '/izin-kelola.html');
    assert.equal(kelola.response.status, 200);
    assert.ok(kelola.text.includes('Kelola izin'));

    const jadwal = await request('GET', '/jadwal.html');
    assert.equal(jadwal.response.status, 200);
    assert.ok(jadwal.text.includes('Salin link izin'));
    assert.ok(jadwal.text.includes('Kelola izin'));
  });

  await check('Kelompok lain tidak boleh ambil link izin', async () => {
    const result = await request(
      'GET',
      `/api/pertemuan/${pertemuanKelompok}/link-izin`,
      undefined,
      kelompokLainCookie
    );
    assert.ok([403, 404].includes(result.response.status));
  });

  await check('Izin ke pertemuan yang sudah selesai ditolak 409', async () => {
    const tutup = await request(
      'POST',
      `/api/pertemuan/${pertemuanKelompok}/selesai`,
      {},
      kelompokCookie
    );
    assert.equal(tutup.response.status, 200);

    const result = await kirimIzinPublik(tokenKelompok, {
      generus_id: generus.C.id,
      kode: generus.C.kode_manual,
      alasan: 'sakit',
      keterangan: null,
    });
    assert.equal(result.response.status, 409);
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
