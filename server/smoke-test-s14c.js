'use strict';

// Smoke test Sesi 14C — Ekspor Excel kehadiran dan nilai.
// Jalankan dengan server yang baru dinyalakan.
// Tidak memakai POST /api/izin. Pertemuan uji tingkat kelompok.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const ExcelJS = require('exceljs');

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
const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const suffix = crypto.randomBytes(8).toString('hex');
const kelompokNama = `Kelompok S14C ${suffix}`;

let failures = 0;
let adminCookie;
let kelompokCookie;
let kelompokId;
let desaId;
let pertemuanId;
let tugasId;
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

  const buffer = Buffer.from(await response.arrayBuffer());
  const text = buffer.toString('utf8');
  let data = {};

  try {
    data = JSON.parse(text);
  } catch {
    // Respons non-JSON tetap tersedia sebagai text dan buffer.
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
    'SELECT id, nama FROM desa WHERE nama = $1',
    ['Desa Contoh 3']
  );
  assert.equal(desa.rowCount, 1, 'Desa Contoh 3 harus tersedia.');
  desaId = desa.rows[0].id;

  const created = await queryDb(
    'INSERT INTO kelompok (nama, desa_id) VALUES ($1, $2) RETURNING id',
    [kelompokNama, desaId]
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

async function bacaExcel(result) {
  assert.equal(result.response.status, 200);
  assert.equal(result.response.headers.get('content-type'), XLSX_TYPE);
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
  assert.equal(
    result.response.headers.get('content-length'),
    String(result.buffer.length)
  );
  assert.equal(result.buffer.subarray(0, 2).toString('ascii'), 'PK');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(result.buffer);
  return workbook;
}

function cariBaris(sheet, cocok) {
  assert.ok(sheet, 'Sheet Excel harus tersedia.');
  let found;

  sheet.eachRow((row) => {
    if (cocok(row)) found = row;
  });

  assert.ok(found, 'Baris data uji harus tersedia di sheet Excel.');
  return found;
}

async function main() {
  const dari = hariIni(-1);
  const sampai = hariIni();
  const periode = new URLSearchParams({ dari, sampai }).toString();
  let siap = false;

  try {
    await check('Admin login', async () => {
      assert.ok(ADMIN_PASSWORD, 'ADMIN_PASSWORD wajib diisi.');

      await queryDb(
        'UPDATE users SET must_change_password = false WHERE email = $1',
        [ADMIN_EMAIL]
      );

      const login = await request('POST', '/api/login', {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
      });

      assert.equal(login.response.status, 200);
      assert.ok(login.cookie);
      adminCookie = login.cookie;
    });

    if (!adminCookie) return;

    await check('Menyiapkan kelompok, kehadiran, dan penilaian', async () => {
      await setupKelompok();

      const akun = await createAndLogin('kelompok', {
        kelompok_id: kelompokId,
      });
      kelompokCookie = akun.cookie;

      for (const nama of ['A', 'B']) {
        const pending = await buatGenerus(nama, 'sd', kelompokCookie);
        generus[nama] = await setujuiGenerus(pending.id);
      }

      const pertemuan = await request('POST', '/api/pertemuan', {
        tingkat: 'kelompok',
        kelompok_id: kelompokId,
        jenjang: ['caberawit'],
        tanggal: sampai,
      }, kelompokCookie);

      assert.equal(pertemuan.response.status, 201);
      assert.ok(pertemuan.data.pertemuan.id);
      pertemuanId = pertemuan.data.pertemuan.id;

      assert.ok(generus.A.kode_manual);
      const absen = await request(
        'POST',
        `/api/pertemuan/${pertemuanId}/absen`,
        { kode: generus.A.kode_manual },
        kelompokCookie
      );
      assert.equal(absen.response.status, 200);
      assert.equal(absen.data.absensi.status, 'hadir');

      const selesai = await request(
        'POST',
        `/api/pertemuan/${pertemuanId}/selesai`,
        undefined,
        kelompokCookie
      );
      assert.equal(selesai.response.status, 200);

      const tugas = await request('POST', '/api/tugas', {
        judul: 'Doa Harian',
        kategori: 'doa_surat',
      }, kelompokCookie);
      assert.equal(tugas.response.status, 201);

      const daftar = await request(
        'GET',
        '/api/penilaian',
        undefined,
        kelompokCookie
      );
      assert.equal(daftar.response.status, 200);
      assert.ok(Array.isArray(daftar.data.tugas));

      const tugasUji = daftar.data.tugas.find(
        (row) =>
          row.judul === 'Doa Harian' &&
          row.kategori === 'doa_surat' &&
          String(row.kelompok_id) === String(kelompokId)
      );
      assert.ok(tugasUji, 'Tugas Doa Harian kelompok uji harus tersedia.');
      tugasId = tugasUji.id;

      const penilaian = await request('POST', '/api/penilaian', {
        generus_id: generus.A.id,
        tugas_id: tugasId,
        nilai: 'hafal',
      }, kelompokCookie);
      assert.ok(
        [200, 201].includes(penilaian.response.status),
        `Pencatatan nilai harus berhasil, mendapat ${penilaian.response.status}.`
      );

      siap = true;
    });

    if (!siap) return;

    await check('Excel kehadiran memuat Rekap dan Rincian', async () => {
      const result = await request(
        'GET',
        `/api/laporan.xlsx?${periode}&rincian=1`,
        undefined,
        kelompokCookie
      );
      const workbook = await bacaExcel(result);

      assert.equal(
        result.response.headers.get('content-disposition'),
        `attachment; filename="laporan-kehadiran-${dari}_sd_${sampai}.xlsx"`
      );
      assert.deepEqual(
        workbook.worksheets.map((sheet) => sheet.name),
        ['Rekap', 'Rincian']
      );

      const rekap = workbook.getWorksheet('Rekap');
      assert.equal(rekap.getCell('A1').value, 'Laporan Kehadiran Generus');
      assert.equal(rekap.getCell('A1').font.bold, true);
      assert.deepEqual(rekap.getRow(4).values.slice(1), [
        'Kelompok',
        'Desa',
        'Generus',
        'Pertemuan',
        'Rata-rata % Hadir',
      ]);

      const kelompok = cariBaris(
        rekap,
        (row) => row.getCell(1).value === kelompokNama
      );
      assert.equal(kelompok.getCell(3).value, 2);
      assert.equal(kelompok.getCell(4).value, 1);

      const rincian = workbook.getWorksheet('Rincian');
      assert.deepEqual(rincian.getRow(1).values.slice(1), [
        'Nama',
        'Kelompok',
        'Kelas',
        'Jenjang',
        'Hadir',
        'Izin',
        'Alfa',
        'Wajib',
        '% Hadir',
      ]);

      const hadir = cariBaris(
        rincian,
        (row) => row.getCell(1).value === generus.A.nama
      );
      assert.equal(hadir.getCell(2).value, kelompokNama);
      assert.equal(hadir.getCell(4).value, 'Caberawit');
      assert.equal(hadir.getCell(5).value, 1);

      cariBaris(
        rincian,
        (row) => row.getCell(1).value === generus.B.nama
      );
    });

    await check('Excel kehadiran rincian=0 hanya memuat Rekap', async () => {
      const result = await request(
        'GET',
        `/api/laporan.xlsx?${periode}&rincian=0`,
        undefined,
        kelompokCookie
      );
      const workbook = await bacaExcel(result);
      assert.deepEqual(
        workbook.worksheets.map((sheet) => sheet.name),
        ['Rekap']
      );
      assert.equal(workbook.getWorksheet('Rincian'), undefined);
    });

    await check('Excel kehadiran tanpa tanggal ditolak', async () => {
      const result = await request(
        'GET',
        '/api/laporan.xlsx',
        undefined,
        kelompokCookie
      );
      assert.equal(result.response.status, 400);
    });

    await check('Excel kehadiran tanpa login ditolak', async () => {
      const result = await request(
        'GET',
        `/api/laporan.xlsx?${periode}&rincian=1`
      );
      assert.equal(result.response.status, 401);
    });

    await check('Excel kehadiran menolak rincian yang tidak valid', async () => {
      const result = await request(
        'GET',
        `/api/laporan.xlsx?${periode}&rincian=2`,
        undefined,
        kelompokCookie
      );
      assert.equal(result.response.status, 400);
    });

    await check('Excel nilai memuat Hasil dan Penilaian', async () => {
      const result = await request(
        'GET',
        '/api/nilai.xlsx',
        undefined,
        kelompokCookie
      );
      const workbook = await bacaExcel(result);

      assert.equal(
        result.response.headers.get('content-disposition'),
        'attachment; filename="rekap-nilai.xlsx"'
      );
      assert.deepEqual(
        workbook.worksheets.map((sheet) => sheet.name),
        ['Hasil', 'Penilaian']
      );

      const hasil = workbook.getWorksheet('Hasil');
      assert.deepEqual(hasil.getRow(1).values.slice(1), [
        'Nama',
        'Kelompok',
        'Kelas',
        'Jenjang',
        'Hafal',
        'Total',
        '% Hasil',
      ]);

      const hafalan = cariBaris(
        hasil,
        (row) => row.getCell(1).value === generus.A.nama
      );
      assert.equal(hafalan.getCell(2).value, kelompokNama);
      assert.equal(hafalan.getCell(5).value, 1);
      assert.equal(hafalan.getCell(6).value, 1);
      assert.equal(hafalan.getCell(7).value, 100);

      const penilaian = workbook.getWorksheet('Penilaian');
      assert.deepEqual(penilaian.getRow(1).values.slice(1), [
        'Nama Generus',
        'Tugas',
        'Kategori',
        'Nilai',
      ]);

      const nilai = cariBaris(
        penilaian,
        (row) =>
          row.getCell(1).value === generus.A.nama &&
          row.getCell(2).value === 'Doa Harian'
      );
      assert.equal(nilai.getCell(3).value, 'doa_surat');
      assert.equal(nilai.getCell(4).value, 'hafal');
    });

    await check('Excel nilai tanpa login ditolak', async () => {
      const result = await request('GET', '/api/nilai.xlsx');
      assert.equal(result.response.status, 401);
    });

    await check('JSON penilaian tetap memiliki bentuk dan isi yang sama', async () => {
      const result = await request(
        'GET',
        '/api/penilaian',
        undefined,
        kelompokCookie
      );
      assert.equal(result.response.status, 200);
      assert.deepEqual(
        Object.keys(result.data).sort(),
        ['hasil', 'penilaian', 'tugas']
      );
      assert.ok(Array.isArray(result.data.tugas));
      assert.ok(Array.isArray(result.data.penilaian));
      assert.ok(Array.isArray(result.data.hasil));

      const tugas = result.data.tugas.find(
        (row) => String(row.id) === String(tugasId)
      );
      assert.ok(tugas);
      assert.equal(tugas.judul, 'Doa Harian');
      assert.equal(tugas.kategori, 'doa_surat');

      const nilai = result.data.penilaian.find(
        (row) =>
          String(row.generus_id) === String(generus.A.id) &&
          String(row.tugas_id) === String(tugasId)
      );
      assert.ok(nilai);
      assert.deepEqual(Object.keys(nilai).sort(), [
        'id',
        'generus_id',
        'tugas_id',
        'nilai',
        'diubah_count',
        'diubah_oleh_admin',
        'dicatat_oleh',
        'created_at',
        'updated_at',
      ].sort());
      assert.equal(nilai.nilai, 'hafal');

      const hasil = result.data.hasil.find(
        (row) => String(row.generus_id) === String(generus.A.id)
      );
      assert.ok(hasil);
      assert.deepEqual(Object.keys(hasil).sort(), [
        'generus_id',
        'nama',
        'kelas_sekolah',
        'jenjang',
        'kelompok',
        'ortu_nama',
        'ortu_hp',
        'hafal',
        'total_hafalan',
        'persen',
      ].sort());
      assert.equal(hasil.nama, generus.A.nama);
      assert.equal(hasil.hafal, 1);
      assert.equal(hasil.total_hafalan, 1);
      assert.equal(hasil.persen, 100);
    });

    await check('Halaman laporan dan materi memuat tombol Unduh Excel', async () => {
      const laporan = await request(
        'GET',
        '/laporan.html',
        undefined,
        kelompokCookie
      );
      assert.equal(laporan.response.status, 200);
      assert.ok(laporan.text.includes('Unduh Excel'));
      assert.ok(laporan.text.includes('id="unduh-excel"'));

      const materi = await request(
        'GET',
        '/materi.html',
        undefined,
        kelompokCookie
      );
      assert.equal(materi.response.status, 200);
      assert.ok(materi.text.includes('Unduh Excel'));
      assert.ok(materi.text.includes('id="unduh-nilai-excel"'));
    });
  } finally {
    try {
      await restoreAdminFlag();
    } catch (error) {
      failures += 1;
      console.error(`FAIL: Memulihkan flag admin — ${error.message}`);
    }

    process.exitCode = failures > 0 ? 1 : 0;
  }
}

main().catch((error) => {
  console.error(`FAIL: Smoke test S14C — ${error.message}`);
  process.exitCode = 1;
});
