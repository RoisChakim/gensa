'use strict';

// Smoke test Sesi 14A — batas akses peran Daerah.
// Tidak memakai endpoint izin publik.

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
let daerahCookie;
let kelompokCookie;
let kelompokId;
let desaId;
let generusUji;
let pertemuanId;
let adminFlagChanged = false;

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
    'SELECT id FROM desa WHERE nama = $1',
    ['Desa Contoh 3']
  );
  assert.equal(desa.rowCount, 1, 'Desa Contoh 3 harus tersedia.');
  desaId = desa.rows[0].id;

  const created = await queryDb(
    'INSERT INTO kelompok (nama, desa_id) VALUES ($1, $2) RETURNING id',
    [`Kelompok S14A ${suffix}`, desaId]
  );
  kelompokId = created.rows[0].id;
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

function dataGenerus(nama, tingkat, jenisKelamin = 'perempuan') {
  return {
    nama: `Generus ${nama} ${suffix}`,
    tanggal_lahir: '2015-05-10',
    kelas_sekolah: tingkat === 'sd' ? 'Kelas 4' : 'Kelas 7',
    tingkat,
    jenis_kelamin: jenisKelamin,
    ortu_nama: 'Orang Tua Tes',
    ortu_hubungan: 'Ibu',
    ortu_hp: '081234567890',
  };
}

async function buatGenerus(nama, tingkat, cookie, jenisKelamin) {
  const created = await request(
    'POST',
    '/api/generus',
    dataGenerus(nama, tingkat, jenisKelamin),
    cookie
  );
  assert.equal(created.response.status, 201);
  assert.equal(created.data.generus.status, 'pending');
  return created.data.generus;
}

async function setujuiGenerus(id) {
  const approved = await request(
    'POST',
    `/api/generus/${id}/approve`,
    {},
    adminCookie
  );
  assert.equal(approved.response.status, 200);
  assert.equal(approved.data.generus.status, 'approved');
  return approved.data.generus;
}

async function main() {
  try {
    await check('Admin login menggunakan kredensial .env', async () => {
      assert.ok(ADMIN_PASSWORD, 'ADMIN_PASSWORD wajib diisi.');

      const updated = await queryDb(
        `UPDATE users
         SET must_change_password = false
         WHERE email = $1 AND role = $2`,
        [ADMIN_EMAIL, 'admin']
      );
      adminFlagChanged = updated.rowCount > 0;
      assert.equal(updated.rowCount, 1, 'Akun Admin harus tersedia.');

      const login = await request('POST', '/api/login', {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
      });

      assert.equal(login.response.status, 200);
      assert.ok(login.cookie);
      adminCookie = login.cookie;
    });
    if (!adminCookie) return;

    await check('Menyiapkan satu kelompok uji', setupKelompok);
    if (!kelompokId || !desaId) return;

    await check('Admin membuat akun Daerah, lalu login dan ganti password', async () => {
      const result = await createAndLogin('daerah', {});
      daerahCookie = result.cookie;
    });

    await check('Admin membuat akun Kelompok, lalu login dan ganti password', async () => {
      const result = await createAndLogin('kelompok', {
        kelompok_id: kelompokId,
      });
      kelompokCookie = result.cookie;
    });
    if (!daerahCookie || !kelompokCookie) return;

    await check('Kelompok mengajukan generus SD/caberawit dan Admin menyetujui', async () => {
      const pending = await buatGenerus('S14A', 'sd', kelompokCookie);
      const approved = await setujuiGenerus(pending.id);
      assert.ok(approved.id);
      assert.equal(typeof approved.qr_token, 'string');
      assert.ok(approved.qr_token);
      generusUji = approved;
    });
    if (!generusUji) return;

    const tanggalHariIni = hariIni();
    const tanggalBesok = hariIni(1);

    await check('Daerah tidak boleh menambah generus: 403', async () => {
      const result = await request(
        'POST',
        '/api/generus',
        dataGenerus('Ditolak Daerah', 'sd'),
        daerahCookie
      );
      assert.equal(result.response.status, 403);
    });

    await check('Daerah tidak boleh mengajukan ulang generus kelompok: 403', async () => {
      const result = await request(
        'POST',
        `/api/generus/${generusUji.id}/ajukan-ulang`,
        dataGenerus('Ajukan Ulang Daerah', 'sd'),
        daerahCookie
      );
      assert.equal(result.response.status, 403);
    });

    await check('Daerah tidak boleh mengajukan hapus generus: 403', async () => {
      const result = await request(
        'POST',
        `/api/generus/${generusUji.id}/delete-request`,
        {},
        daerahCookie
      );
      assert.equal(result.response.status, 403);
    });

    // Payload kosong menguji bahwa pemeriksaan peran menolak akses
    // sebelum validasi isian untuk aksi yang tidak boleh dilakukan.
    await check('Daerah tidak boleh membuat tugas: 403', async () => {
      const result = await request(
        'POST',
        '/api/tugas',
        {},
        daerahCookie
      );
      assert.equal(result.response.status, 403);
    });

    await check('Daerah tidak boleh menyimpan penilaian: 403', async () => {
      const result = await request(
        'POST',
        '/api/penilaian',
        {},
        daerahCookie
      );
      assert.equal(result.response.status, 403);
    });

    await check('Daerah tidak boleh membuat kelas: 403', async () => {
      const result = await request(
        'POST',
        '/api/kelas',
        {},
        daerahCookie
      );
      assert.equal(result.response.status, 403);
    });

    await check('Daerah tidak boleh membuat pengguna: 403', async () => {
      const result = await request('POST', '/api/users', {
        email: `terlarang-${suffix}@tes.gensa.local`,
        role: 'kelompok',
        kelompok_id: kelompokId,
      }, daerahCookie);
      assert.equal(result.response.status, 403);
    });

    await check('Daerah tidak boleh membuat pertemuan kelompok: 403', async () => {
      const result = await request('POST', '/api/pertemuan', {
        tingkat: 'kelompok',
        kelompok_id: kelompokId,
        jenjang: ['caberawit'],
        tanggal: tanggalHariIni,
      }, daerahCookie);
      assert.equal(result.response.status, 403);
    });

    await check('Daerah tidak boleh membuat pertemuan desa: 403', async () => {
      const result = await request('POST', '/api/pertemuan', {
        tingkat: 'desa',
        desa_id: desaId,
        jenjang: ['caberawit'],
        tanggal: tanggalHariIni,
      }, daerahCookie);
      assert.equal(result.response.status, 403);
    });

    await check('POST /api/wilayah tidak tersedia: 404', async () => {
      const result = await request(
        'POST',
        '/api/wilayah',
        {},
        daerahCookie
      );
      assert.equal(result.response.status, 404);
    });

    await check('POST /api/kelompok tidak tersedia: 404', async () => {
      const result = await request(
        'POST',
        '/api/kelompok',
        {},
        daerahCookie
      );
      assert.equal(result.response.status, 404);
    });

    await check('POST /api/desa tidak tersedia: 404', async () => {
      const result = await request(
        'POST',
        '/api/desa',
        {},
        daerahCookie
      );
      assert.equal(result.response.status, 404);
    });

    await check('Daerah boleh membuat pertemuan daerah untuk besok: 201', async () => {
      const result = await request('POST', '/api/pertemuan', {
        tingkat: 'daerah',
        jenjang: ['caberawit'],
        tanggal: tanggalBesok,
      }, daerahCookie);

      assert.equal(result.response.status, 201);
      assert.ok(result.data.pertemuan.id);
      pertemuanId = result.data.pertemuan.id;
    });

    await check('Daerah boleh mengubah tanggal pertemuan menjadi hari ini: 200', async () => {
      assert.ok(pertemuanId, 'Pertemuan daerah belum berhasil dibuat.');

      const result = await request(
        'PATCH',
        `/api/pertemuan/${pertemuanId}`,
        { tanggal: tanggalHariIni },
        daerahCookie
      );
      assert.equal(result.response.status, 200);
    });

    await check('Daerah boleh membaca daftar absensi pertemuan daerah: 200', async () => {
      assert.ok(pertemuanId, 'Pertemuan daerah belum berhasil dibuat.');

      const result = await request(
        'GET',
        `/api/pertemuan/${pertemuanId}/absensi`,
        undefined,
        daerahCookie
      );
      assert.equal(result.response.status, 200);
      assert.ok(Array.isArray(result.data.absensi));
    });

    await check('Daerah boleh mencatat hadir generus caberawit: 200/201', async () => {
      assert.ok(pertemuanId, 'Pertemuan daerah belum berhasil dibuat.');

      const result = await request(
        'POST',
        `/api/pertemuan/${pertemuanId}/absen`,
        { kode: generusUji.qr_token },
        daerahCookie
      );
      assert.ok(
        [200, 201].includes(result.response.status),
        `Status absen seharusnya 200/201, diterima ${result.response.status}.`
      );
      assert.equal(result.data.absensi.status, 'hadir');
    });

    await check('Generus yang diabsen masuk daftar absensi pertemuan daerah', async () => {
      assert.ok(pertemuanId, 'Pertemuan daerah belum berhasil dibuat.');

      const result = await request(
        'GET',
        `/api/pertemuan/${pertemuanId}/absensi`,
        undefined,
        daerahCookie
      );
      assert.equal(result.response.status, 200);
      assert.ok(Array.isArray(result.data.absensi));

      // Mengikuti pemeriksaan S2: pertemuan baru berisi satu absensi
      // setelah satu kode generus dicatat.
      assert.equal(result.data.absensi.length, 1);
      assert.equal(result.data.absensi[0].status, 'hadir');
    });

    await check('Daerah boleh menyelesaikan pertemuan daerah: 200', async () => {
      assert.ok(pertemuanId, 'Pertemuan daerah belum berhasil dibuat.');

      const result = await request(
        'POST',
        `/api/pertemuan/${pertemuanId}/selesai`,
        {},
        daerahCookie
      );
      assert.equal(result.response.status, 200);
    });

    await check('Daerah boleh membaca laporan: 200', async () => {
      const params = new URLSearchParams({
        dari: tanggalHariIni,
        sampai: tanggalHariIni,
        rincian: '0',
      });
      const result = await request(
        'GET',
        `/api/laporan?${params}`,
        undefined,
        daerahCookie
      );
      assert.equal(result.response.status, 200);
    });

    await check('Daerah boleh membaca daftar generus: 200', async () => {
      const result = await request(
        'GET',
        '/api/generus',
        undefined,
        daerahCookie
      );
      assert.equal(result.response.status, 200);
    });

    await check('Daerah boleh membaca arsip: 200', async () => {
      const result = await request(
        'GET',
        '/api/arsip',
        undefined,
        daerahCookie
      );
      assert.equal(result.response.status, 200);
    });
  } catch (error) {
    failures += 1;
    console.error(`FAIL: Kesalahan di luar pemeriksaan — ${error.message}`);
  } finally {
    if (adminFlagChanged) {
      await check('Memulihkan flag password Admin', restoreAdminFlag);
    }

    console.log(`\nSelesai S14A. Jumlah gagal: ${failures}.`);
    process.exitCode = failures > 0 ? 1 : 0;
  }
}

main();
