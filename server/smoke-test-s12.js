'use strict';

// Smoke test Sesi 12 — Perbaikan pasca-review (R8, M6, D1, R2 + endpoint
// dashboard/akun). Menguji: hapus generus ber-riwayat berhasil + riwayat
// ikut hilang (R8), kolom jenis_kelamin wajib di pengajuan baru (M6),
// Desa boleh mengajukan hapus generus di desanya (D1), ajukan ulang
// generus yang ditolak (PRD §5), GET /api/users + /api/wilayah +
// /api/ringkasan, dan rate limit POST /api/izin publik (R2, dicek
// TERAKHIR karena menghabiskan jatah percobaan per IP).
//
// CATATAN: jalankan dengan server yang baru dinyalakan — cek R2 memakai
// jatah 10 percobaan per menit per IP, jadi putaran ke-2 tanpa restart
// server akan langsung 429.

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
let pertemuanId;

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
    [`Kelompok S12 ${suffix}`, desaId]
  );
  kelompokId = created.rows[0].id;

  const createdLain = await queryDb(
    'INSERT INTO kelompok (nama, desa_id) VALUES ($1, $2) RETURNING id',
    [`Kelompok S12-lain ${suffix}`, desa1Id]
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
  if (!ADMIN_PASSWORD || !ADMIN_PASSWORD.trim()) {
    console.error('FAIL: ADMIN_PASSWORD wajib diisi.');
    process.exitCode = 1;
    return;
  }

  await check('Admin masuk dan membuat akun S12', async () => {
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

  await check('M6: jenis_kelamin tampil di daftar, nilai salah ditolak', async () => {
    // Tanpa jenis_kelamin tetap diterima (baris lama/klien lama) — nilainya null.
    const bodyTanpa = dataGenerus('TanpaJK', 'sd');
    delete bodyTanpa.jenis_kelamin;
    const tanpa = await request(
      'POST',
      '/api/generus',
      bodyTanpa,
      kelompokCookie
    );
    assert.equal(tanpa.response.status, 201);
    assert.equal(tanpa.data.generus.jenis_kelamin, null);

    const salah = await request(
      'POST',
      '/api/generus',
      dataGenerus('SalahJK', 'sd', 'tidak-dikenal'),
      kelompokCookie
    );
    assert.equal(salah.response.status, 400);

    const dibuat = await buatGenerus('JK', 'sd', kelompokCookie, 'laki-laki');
    assert.equal(dibuat.jenis_kelamin, 'laki-laki');
    generus.JK = await setujuiGenerus(dibuat.id);

    const daftar = await request(
      'GET',
      '/api/generus?status=approved',
      undefined,
      kelompokCookie
    );
    assert.equal(daftar.response.status, 200);
    const baris = daftar.data.generus.find((row) => row.id === generus.JK.id);
    assert.ok(baris, 'Generus JK harus ada di daftar.');
    assert.equal(baris.jenis_kelamin, 'laki-laki');
  });

  await check('Ajukan ulang: ditolak lalu diperbaiki dan disetujui', async () => {
    const dibuat = await buatGenerus('Ulang', 'sd', kelompokCookie, 'perempuan');

    const tolak = await request(
      'POST',
      `/api/generus/${dibuat.id}/reject`,
      { catatan: 'Tanggal lahir belum lengkap.' },
      adminCookie
    );
    assert.equal(tolak.response.status, 200);
    assert.equal(tolak.data.generus.status, 'rejected');

    const ulang = await request(
      'POST',
      `/api/generus/${dibuat.id}/ajukan-ulang`,
      { ...dataGenerus('Ulang', 'sd', 'perempuan'), tanggal_lahir: '2014-03-02' },
      kelompokCookie
    );
    assert.equal(ulang.response.status, 200);
    assert.equal(ulang.data.generus.status, 'pending');
    assert.equal(ulang.data.generus.tanggal_lahir.slice(0, 10), '2014-03-02');

    generus.Ulang = await setujuiGenerus(dibuat.id);
  });

  await check('R8: hapus generus ber-riwayat berhasil, riwayat ikut hilang', async () => {
    const dibuat = await buatGenerus('Riwayat', 'sd', kelompokCookie, 'perempuan');
    generus.Riwayat = await setujuiGenerus(dibuat.id);

    const pertemuan = await request('POST', '/api/pertemuan', {
      tingkat: 'kelompok',
      kelompok_id: kelompokId,
      jenjang: ['caberawit'],
      tanggal: hariIni(1),
    }, kelompokCookie);
    assert.equal(pertemuan.response.status, 201);
    pertemuanId = pertemuan.data.pertemuan.id;

    const absen = await request(
      'POST',
      `/api/pertemuan/${pertemuanId}/absen`,
      { kode: generus.Riwayat.kode_manual },
      kelompokCookie
    );
    assert.equal(absen.response.status, 200);
    assert.equal(absen.data.absensi.status, 'hadir');

    const tugas = await request('POST', '/api/tugas', {
      judul: `Doa Tes S12 ${suffix}`,
      kategori: 'doa_surat',
    }, kelompokCookie);
    assert.equal(tugas.response.status, 201);

    const nilai = await request('POST', '/api/penilaian', {
      generus_id: generus.Riwayat.id,
      tugas_id: tugas.data.tugas.id,
      nilai: 'hafal',
    }, kelompokCookie);
    assert.equal(nilai.response.status, 200);

    const minta = await request(
      'POST',
      `/api/generus/${generus.Riwayat.id}/delete-request`,
      { alasan: 'Pindah ke luar kota.' },
      kelompokCookie
    );
    assert.equal(minta.response.status, 200);
    assert.equal(minta.data.generus.status, 'delete_pending');

    // Sebelum perbaikan R8, langkah ini gagal FK 23503 → 500.
    const hapus = await request(
      'POST',
      `/api/generus/${generus.Riwayat.id}/delete-approve`,
      {},
      adminCookie
    );
    assert.equal(hapus.response.status, 200);

    const daftar = await request('GET', '/api/generus', undefined, adminCookie);
    assert.equal(daftar.response.status, 200);
    assert.ok(!daftar.data.generus.some((row) => row.id === generus.Riwayat.id),
      'Generus yang dihapus tidak boleh ada di daftar.');

    const absensi = await queryDb(
      'SELECT COUNT(*)::int AS n FROM absensi WHERE generus_id = $1',
      [generus.Riwayat.id]
    );
    assert.equal(absensi.rows[0].n, 0, 'Riwayat absensi harus ikut hilang.');

    const penilaian = await queryDb(
      'SELECT COUNT(*)::int AS n FROM penilaian WHERE generus_id = $1',
      [generus.Riwayat.id]
    );
    assert.equal(penilaian.rows[0].n, 0, 'Riwayat penilaian harus ikut hilang.');
  });

  await check('D1: Desa boleh ajukan hapus di desanya, tidak di desa lain', async () => {
    const dibuat = await buatGenerus('DesaHapus', 'sd', kelompokCookie, 'perempuan');
    const disetujui = await setujuiGenerus(dibuat.id);

    const lain = await request(
      'POST',
      `/api/generus/${disetujui.id}/delete-request`,
      { alasan: 'Bukan wilayah saya.' },
      kelompokLainCookie
    );
    assert.equal(lain.response.status, 409);

    const minta = await request(
      'POST',
      `/api/generus/${disetujui.id}/delete-request`,
      { alasan: 'Sudah tidak aktif mengaji.' },
      desaCookie
    );
    assert.equal(minta.response.status, 200);
    assert.equal(minta.data.generus.status, 'delete_pending');

    // Bersihkan: Admin menyetujui penghapusan.
    const hapus = await request(
      'POST',
      `/api/generus/${disetujui.id}/delete-approve`,
      {},
      adminCookie
    );
    assert.equal(hapus.response.status, 200);
  });

  await check('D1: Desa tidak boleh ajukan hapus generus desa lain', async () => {
    const dibuatLain = await buatGenerus('DesaLain', 'sd', kelompokLainCookie, 'perempuan');
    const disetujuiLain = await setujuiGenerus(dibuatLain.id);

    const minta = await request(
      'POST',
      `/api/generus/${disetujuiLain.id}/delete-request`,
      { alasan: 'Coba ajukan.' },
      desaCookie
    );
    assert.equal(minta.response.status, 409);
  });

  await check('GET /api/users, /api/wilayah, /api/ringkasan', async () => {
    const users = await request('GET', '/api/users', undefined, adminCookie);
    assert.equal(users.response.status, 200);
    assert.ok(Array.isArray(users.data.users));
    assert.ok(users.data.users.length >= 4);
    assert.ok(!JSON.stringify(users.data.users).includes('password_hash'),
      'password_hash tidak boleh bocor.');

    const usersTolak = await request('GET', '/api/users', undefined, kelompokCookie);
    assert.equal(usersTolak.response.status, 403);

    const wilayah = await request('GET', '/api/wilayah', undefined, adminCookie);
    assert.equal(wilayah.response.status, 200);
    assert.ok(wilayah.data.desa.some((row) => row.id === desaId));
    assert.ok(wilayah.data.kelompok.some((row) => row.id === kelompokId));

    const ringkasan = await request('GET', '/api/ringkasan', undefined, adminCookie);
    assert.equal(ringkasan.response.status, 200);
    assert.equal(typeof ringkasan.data.generus.total, 'number');
    assert.equal(typeof ringkasan.data.generus.pending, 'number');
    assert.equal(typeof ringkasan.data.pertemuan_mendatang, 'number');
    assert.equal(typeof ringkasan.data.izin_menunggu, 'number');
    assert.ok(ringkasan.data.generus.total >= 2);

    const ringkasanKelompok = await request(
      'GET', '/api/ringkasan', undefined, kelompokCookie
    );
    assert.equal(ringkasanKelompok.response.status, 200);
    assert.ok(ringkasanKelompok.data.generus.total >= 1);
  });

  await check('R2: POST /api/izin dibatasi 10 percobaan per menit per IP', async () => {
    const tokenPalsu = crypto.randomBytes(16).toString('hex');
    const statuses = [];

    for (let i = 0; i < 11; i += 1) {
      const result = await request('POST', `/api/izin?t=${tokenPalsu}`, {
        generus_id: 1,
        kode: 'AAAAAA',
        alasan: 'sakit',
        keterangan: null,
      });
      statuses.push(result.response.status);
    }

    assert.deepEqual(
      statuses.slice(0, 10),
      Array(10).fill(404),
      'Sepuluh percobaan pertama harus 404 (token tidak ada).'
    );
    assert.equal(statuses[10], 429, 'Percobaan ke-11 harus 429.');
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
