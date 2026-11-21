'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const zlib = require('node:zlib');

function bacaDocumentXml(buffer) {
  const signature = Buffer.from('PK\x03\x04');
  let offset = buffer.indexOf(signature);

  while (offset !== -1) {
    assert.ok(offset + 30 <= buffer.length, 'Header ZIP tidak lengkap.');
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    assert.ok(dataEnd <= buffer.length, 'Isi ZIP tidak lengkap.');

    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
    if (name === 'word/document.xml') {
      const data = buffer.subarray(dataStart, dataEnd);
      if (method === 8) return zlib.inflateRawSync(data).toString('utf8');
      if (method === 0) return data.toString('utf8');
      throw new Error('Metode kompresi word/document.xml tidak didukung.');
    }

    offset = buffer.indexOf(signature, dataEnd);
  }

  throw new Error('word/document.xml tidak ditemukan.');
}
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
let kelompokNama;
let desa3Id;
let desa1Id;
const generus = {};
let pertemuan1;
let pertemuan2;
let pertemuan4;

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

  const arrayBuffer = await response.arrayBuffer();
  const text = Buffer.from(arrayBuffer).toString('utf8');
  let data = {};

  try {
    data = JSON.parse(text);
  } catch {
    // Respons non-JSON tetap tersedia sebagai text.
  }

  const setCookie = response.headers.get('set-cookie');
  let buffer = null;
  if (response.headers.get('content-type')?.includes('wordprocessingml')) {
    buffer = Buffer.from(arrayBuffer);
  }

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

async function setupKelompokS4() {
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
    desa3Id = desa.rows.find((row) => row.nama === 'Desa Contoh 3').id;
    desa1Id = desa.rows.find((row) => row.nama === 'Desa Contoh 1').id;

    kelompokNama = `Kelompok S4 ${suffix}`;
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

async function tutupPertemuan(id) {
  const result = await request(
    'POST',
    `/api/pertemuan/${id}/selesai`,
    {},
    kelompokCookie
  );
  assert.equal(result.response.status, 200);
}

async function absenManual(pertemuanId, generusId, status) {
  const result = await request(
    'POST',
    `/api/pertemuan/${pertemuanId}/absen-manual`,
    { generus_id: generusId, status },
    kelompokCookie
  );
  assert.equal(result.response.status, 200);
  return result;
}

async function main() {
  if (!ADMIN_PASSWORD || !ADMIN_PASSWORD.trim()) {
    console.error('FAIL: ADMIN_PASSWORD wajib diisi.');
    process.exitCode = 1;
    return;
  }

  const dari = hariIni(-1);
  const sampai = hariIni();
  const params = (rincian) =>
    `dari=${dari}&sampai=${sampai}&rincian=${rincian}`;

  await check('Admin masuk dan membuat akun kelompok S4', async () => {
    await setupKelompokS4();

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

  await check('Dua pertemuan selesai dengan pola hadir/alfa', async () => {
    await buatGenerusDisetujui('A', 'sd');
    await buatGenerusDisetujui('B', 'smp');

    const pertama = await buatPertemuan(sampai, ['caberawit', 'pra_remaja']);
    pertemuan1 = pertama.id;
    await absenManual(pertemuan1, generus.A.id, 'hadir');
    await tutupPertemuan(pertemuan1);

    const kedua = await buatPertemuan(sampai, ['caberawit', 'pra_remaja']);
    pertemuan2 = kedua.id;
    await tutupPertemuan(pertemuan2);

    const absensi1 = await request(
      'GET',
      `/api/pertemuan/${pertemuan1}/absensi`,
      undefined,
      kelompokCookie
    );
    assert.equal(absensi1.response.status, 200);
    assert.equal(absensi1.data.absensi.length, 2);
  });

  await check('Laporan JSON menghitung hadir/alfa dengan benar', async () => {
    const result = await request(
      'GET',
      `/api/laporan?${params(1)}`,
      undefined,
      kelompokCookie
    );
    assert.equal(result.response.status, 200);
    assert.equal(result.data.periode.dari, dari);
    assert.equal(result.data.periode.sampai, sampai);
    assert.equal(result.data.wilayah, kelompokNama);
    assert.ok(Array.isArray(result.data.rekap));
    assert.ok(Array.isArray(result.data.rincian));

    const rekap = result.data.rekap.find((row) => row.kelompok === kelompokNama);
    assert.ok(rekap, 'Rekap Kelompok S4 tidak ditemukan.');
    assert.equal(rekap.generus, 2);
    assert.equal(rekap.pertemuan, 2);
    assert.equal(rekap.rata_persen, 25);

    const rowA = result.data.rincian.find((row) => row.id === generus.A.id);
    assert.deepEqual(
      [rowA.hadir, rowA.izin, rowA.alfa, rowA.wajib, rowA.persen],
      [1, 0, 1, 2, 50]
    );

    const rowB = result.data.rincian.find((row) => row.id === generus.B.id);
    assert.deepEqual(
      [rowB.hadir, rowB.izin, rowB.alfa, rowB.wajib, rowB.persen],
      [0, 0, 2, 2, 0]
    );
  });

  await check('Generus baru tidak dihitung wajib sebelum disetujui', async () => {
    await buatGenerusDisetujui('C', 'sd');

    // Pertemuan tanggal kemarin, C dicatat hadir, lalu ditutup.
    // Karena tanggal pertemuan < tanggal persetujuan C, laporan
    // harus mengabaikannya (wajib C tetap 0).
    const keempat = await buatPertemuan(dari, ['caberawit']);
    pertemuan4 = keempat.id;
    await absenManual(pertemuan4, generus.C.id, 'hadir');
    await tutupPertemuan(pertemuan4);

    const result = await request(
      'GET',
      `/api/laporan?${params(1)}`,
      undefined,
      kelompokCookie
    );
    assert.equal(result.response.status, 200);

    const rowC = result.data.rincian.find((row) => row.id === generus.C.id);
    assert.deepEqual(
      [rowC.hadir, rowC.izin, rowC.alfa, rowC.wajib, rowC.persen],
      [0, 0, 0, 0, null]
    );

    const rekap = result.data.rekap.find((row) => row.kelompok === kelompokNama);
    assert.equal(rekap.generus, 3);
    assert.equal(rekap.pertemuan, 3);
    assert.equal(rekap.rata_persen, 25);
  });

  await check('Laporan Word terunduh sebagai berkas docx', async () => {
    const result = await request(
      'GET',
      `/api/laporan.docx?${params(1)}`,
      undefined,
      kelompokCookie
    );
    assert.equal(result.response.status, 200);
    assert.match(
      result.response.headers.get('content-type') || '',
      /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/i
    );
    assert.match(
      result.response.headers.get('content-disposition') || '',
      /\.docx/
    );
    assert.ok(result.buffer, 'Isi docx tidak terbaca.');
    assert.equal(result.buffer.subarray(0, 2).toString(), 'PK');
    assert.ok(result.buffer.length > 1000, 'Berkas docx terlalu kecil.');

    const documentXml = bacaDocumentXml(result.buffer);
    assert.match(documentXml, /Laporan Kehadiran Generus/);
    assert.match(documentXml, /Periode:/);
    assert.match(documentXml, /Tanggal:/);
    assert.doesNotMatch(documentXml, /Wilayah:/);
    assert.doesNotMatch(documentXml, /Rekap Kehadiran/);
    assert.doesNotMatch(documentXml, /Rincian per Generus/);
  });

  await check('Validasi parameter laporan ditolak dengan 400', async () => {
    const terbalik = await request(
      'GET',
      `/api/laporan?dari=${sampai}&sampai=${dari}&rincian=0`,
      undefined,
      kelompokCookie
    );
    assert.equal(terbalik.response.status, 400);

    const terlaluPanjang = await request(
      'GET',
      `/api/laporan?dari=2026-01-01&sampai=2026-03-05&rincian=0`,
      undefined,
      kelompokCookie
    );
    assert.equal(terlaluPanjang.response.status, 400);

    const tanggalSalah = await request(
      'GET',
      '/api/laporan?dari=2026-13-01&sampai=2026-11-21&rincian=0',
      undefined,
      kelompokCookie
    );
    assert.equal(tanggalSalah.response.status, 400);

    const rincianSalah = await request(
      'GET',
      `/api/laporan?${params(2)}`,
      undefined,
      kelompokCookie
    );
    assert.equal(rincianSalah.response.status, 400);

    const tanpaLogin = await request('GET', `/api/laporan?${params(0)}`);
    assert.equal(tanpaLogin.response.status, 401);
  });

  await check('Wilayah laporan mengikuti peran', async () => {
    const sendiri = await request(
      'GET',
      `/api/laporan?${params(0)}`,
      undefined,
      kelompokCookie
    );
    assert.equal(sendiri.response.status, 200);
    assert.equal(sendiri.data.rekap.length, 1);
    assert.equal(sendiri.data.rekap[0].kelompok, kelompokNama);
    assert.equal(sendiri.data.rincian, undefined);

    const desaLain = await createAndLogin('desa', { desa_id: desa1Id });
    desaLainCookie = desaLain.cookie;

    const luar = await request(
      'GET',
      `/api/laporan?${params(0)}`,
      undefined,
      desaLainCookie
    );
    assert.equal(luar.response.status, 200);
    assert.ok(!luar.data.rekap.some((row) => row.kelompok === kelompokNama));

    const admin = await request(
      'GET',
      `/api/laporan?${params(0)}`,
      undefined,
      adminCookie
    );
    assert.equal(admin.response.status, 200);
    assert.equal(admin.data.wilayah, 'Seluruh Daerah');
    assert.ok(admin.data.rekap.some((row) => row.kelompok === kelompokNama));
  });

  await check('Halaman laporan tersedia sebagai HTML', async () => {
    const result = await request('GET', '/laporan.html', undefined, kelompokCookie);
    assert.equal(result.response.status, 200);
    assert.match(result.response.headers.get('content-type') || '', /text\/html/i);
    assert.match(result.text, /Laporan Kehadiran/);
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
