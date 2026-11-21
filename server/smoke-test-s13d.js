'use strict';

// Smoke test Sesi 13D — Email reset via SMTP (M4) + tanpa tautan reset
// di console bila SMTP sudah diatur (R4) + Admin ubah nilai tanpa
// reset count (D2). Menguji: GET /api/sistem (admin saja) melaporkan
// status SMTP/Google; tanpa SMTP, reset password tetap jalan
// (tautan di log server — diverifikasi manual dari log); D2: Admin
// mengubah nilai tanpa me-reset diubah_count dan menandai
// diubah_oleh_admin; halaman akun memuat peringatan SMTP dan materi
// memuat penanda "(diubah Admin)".
//
// CATATAN: jalankan dengan server yang baru dinyalakan TANPA env SMTP
// (perilaku fallback). Pengiriman email asli TIDAK diuji di sini —
// butuh kredensial SMTP pemilik. Tes ini memakai 7 dari 10 jatah
// reset per jam per IP (13G) — jangan jalankan berurutan dengan S7
// tanpa restart server (S7 memakai 1 lagi, total 8 — masih aman
// untuk satu putaran).

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
let kelompokId;
let desaId;

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

  const created = await queryDb(
    'INSERT INTO kelompok (nama, desa_id) VALUES ($1, $2) RETURNING id',
    [`Kelompok S13D ${suffix}`, desaId]
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

async function main() {
  if (!ADMIN_PASSWORD || !ADMIN_PASSWORD.trim()) {
    console.error('FAIL: ADMIN_PASSWORD wajib diisi.');
    process.exitCode = 1;
    return;
  }

  await check('Admin masuk dan membuat akun S13D', async () => {
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
  });

  await check('M4: /api/sistem melaporkan SMTP belum dikonfigurasi (admin saja)', async () => {
    const sistem = await request('GET', '/api/sistem', undefined, adminCookie);
    assert.equal(sistem.response.status, 200);
    assert.equal(sistem.data.smtp_terkonfigurasi, false,
      'Tanpa env SMTP, status harus false.');
    assert.equal(typeof sistem.data.google_terkonfigurasi, 'boolean');

    const tolak = await request('GET', '/api/sistem', undefined, kelompokCookie);
    assert.equal(tolak.response.status, 403);

    const tanpaLogin = await request('GET', '/api/sistem');
    assert.equal(tanpaLogin.response.status, 401);
  });

  await check('M4: tanpa SMTP, reset password tetap jalan (tautan di log)', async () => {
    const reset = await request('POST', '/api/reset-password', {
      email: ADMIN_EMAIL,
    });
    assert.equal(reset.response.status, 200);
    assert.equal(reset.data.ok, true);
    assert.equal(
      reset.data.message,
      'Jika akun tersedia, petunjuk reset akan disiapkan.'
    );
  });

  await check('D2: Admin ubah nilai tanpa reset count + penanda diubah_oleh_admin', async () => {
    const dibuat = await request(
      'POST',
      '/api/generus',
      dataGenerus('NilaiD2', 'sd', 'perempuan'),
      kelompokCookie
    );
    assert.equal(dibuat.response.status, 201);
    const generusId = dibuat.data.generus.id;

    const setuju = await request(
      'POST',
      `/api/generus/${generusId}/approve`,
      {},
      adminCookie
    );
    assert.equal(setuju.response.status, 200);

    const tugas = await request('POST', '/api/tugas', {
      judul: `Doa Tes S13D ${suffix}`,
      kategori: 'doa_surat',
    }, kelompokCookie);
    assert.equal(tugas.response.status, 201);
    const tugasId = tugas.data.tugas.id;

    async function nilai(nilaiBaru, cookie) {
      return request('POST', '/api/penilaian', {
        generus_id: generusId,
        tugas_id: tugasId,
        nilai: nilaiBaru,
      }, cookie);
    }

    const awal = await nilai('hafal', kelompokCookie);
    assert.equal(awal.response.status, 200);
    assert.equal(awal.data.penilaian.diubah_count, 0);
    assert.equal(awal.data.penilaian.diubah_oleh_admin, false);

    const ubah1 = await nilai('belum', kelompokCookie);
    assert.equal(ubah1.response.status, 200);
    assert.equal(ubah1.data.penilaian.diubah_count, 1);
    assert.equal(ubah1.data.penilaian.diubah_oleh_admin, false);

    const ubah2 = await nilai('hafal', kelompokCookie);
    assert.equal(ubah2.response.status, 200);
    assert.equal(ubah2.data.penilaian.diubah_count, 2);

    const ubah3 = await nilai('belum', kelompokCookie);
    assert.equal(ubah3.response.status, 403);

    const olehAdmin = await nilai('belum', adminCookie);
    assert.equal(olehAdmin.response.status, 200);
    assert.equal(olehAdmin.data.penilaian.diubah_count, 2,
      'D2: Admin tidak boleh me-reset diubah_count.');
    assert.equal(olehAdmin.data.penilaian.diubah_oleh_admin, true);
    assert.equal(olehAdmin.data.penilaian.nilai, 'belum');

    const daftar = await request(
      'GET',
      `/api/penilaian?kelompok_id=${kelompokId}`,
      undefined,
      kelompokCookie
    );
    assert.equal(daftar.response.status, 200);
    const baris = daftar.data.penilaian.find(
      (row) => row.generus_id === generusId && row.tugas_id === tugasId
    );
    assert.ok(baris, 'Penilaian harus ada di daftar.');
    assert.equal(baris.diubah_oleh_admin, true);
    assert.equal(baris.diubah_count, 2);
  });

  await check('13G: reset password dibatasi 5/jam per email', async () => {
    const emailTes = `reset-${suffix}@tes.gensa.local`;
    const status = [];

    for (let i = 0; i < 6; i += 1) {
      const hasil = await request('POST', '/api/reset-password', {
        email: emailTes,
      });
      status.push(hasil.response.status);
    }

    assert.deepEqual(
      status.slice(0, 5),
      [200, 200, 200, 200, 200],
      'Lima permintaan pertama harus 200 (respons selalu ok:true).'
    );
    assert.equal(status[5], 429, 'Permintaan ke-6 untuk email yang sama harus 429.');
  });

  await check('Halaman: akun memuat peringatan SMTP, materi memuat penanda Admin', async () => {
    const akun = await request('GET', '/akun.html', undefined, adminCookie);
    assert.equal(akun.response.status, 200);
    assert.ok(akun.text.includes('id="smtpWarning"'),
      'akun.html harus memuat peringatan SMTP.');
    assert.ok(akun.text.includes('/api/sistem'),
      'akun.html harus memeriksa status sistem.');

    const materi = await request('GET', '/materi.html', undefined, kelompokCookie);
    assert.equal(materi.response.status, 200);
    assert.ok(materi.text.includes('(diubah Admin)'),
      'materi.html harus memuat penanda diubah Admin.');
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
