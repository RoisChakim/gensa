'use strict';

// Smoke test Sesi 13E — Arsip/retensi 1 bulan (M10). Menguji:
// GET /api/arsip mengelompokkan data >1 bulan per bulan (rekap);
// bulan berjalan + bulan lalu belum masuk arsip; GET
// /api/arsip/bulan?bulan=YYYY-MM mengembalikan rincian laporan bulan
// itu; bulan yang belum terarsip -> 404; format bulan salah -> 400;
// lingkup peran dihormati; halaman arsip.html tersaji dan menu Arsip
// ada di semua halaman.
//
// Keputusan retensi (PRD_JAWABAN hanya menulis "Retensi 1 bulan"):
// TIDAK ada hapus otomatis — data lama hanya dikelompokkan di Arsip
// dan tetap bisa dilihat kembali.
//
// CATATAN: jalankan dengan server yang baru dinyalakan.

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
let desaId;
let pertemuanLamaId;

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
    [`Kelompok S13E ${suffix}`, desaId]
  );
  kelompokId = created.rows[0].id;

  const createdLain = await queryDb(
    'INSERT INTO kelompok (nama, desa_id) VALUES ($1, $2) RETURNING id',
    [`Kelompok S13E-lain ${suffix}`, desa1Id]
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

async function main() {
  if (!ADMIN_PASSWORD || !ADMIN_PASSWORD.trim()) {
    console.error('FAIL: ADMIN_PASSWORD wajib diisi.');
    process.exitCode = 1;
    return;
  }

  await check('Admin masuk dan membuat akun S13E', async () => {
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

  await check('Siapkan data lama: pertemuan September selesai + absensi + penilaian', async () => {
    const dibuat = await request(
      'POST',
      '/api/generus',
      dataGenerus('ArsipLama', 'sd', 'perempuan'),
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
    const kodeManual = setuju.data.generus.kode_manual;

    const pertemuan = await request('POST', '/api/pertemuan', {
      tingkat: 'kelompok',
      kelompok_id: kelompokId,
      jenjang: ['caberawit'],
      tanggal: '2026-09-15',
    }, kelompokCookie);
    assert.equal(pertemuan.response.status, 201);
    pertemuanLamaId = pertemuan.data.pertemuan.id;

    const absen = await request(
      'POST',
      `/api/pertemuan/${pertemuanLamaId}/absen`,
      { kode: kodeManual },
      kelompokCookie
    );
    assert.equal(absen.response.status, 200);
    assert.equal(absen.data.absensi.status, 'hadir');

    const tugas = await request('POST', '/api/tugas', {
      judul: `Doa Tes S13E ${suffix}`,
      kategori: 'doa_surat',
    }, kelompokCookie);
    assert.equal(tugas.response.status, 201);

    const nilai = await request('POST', '/api/penilaian', {
      generus_id: generusId,
      tugas_id: tugas.data.tugas.id,
      nilai: 'hafal',
    }, kelompokCookie);
    assert.equal(nilai.response.status, 200);

    // Mundurkan created_at penilaian ke September (API memakai now()).
    await queryDb(
      "UPDATE penilaian SET created_at = '2026-09-10 10:00:00+07' WHERE generus_id = $1",
      [generusId]
    );

    const selesai = await request(
      'POST',
      `/api/pertemuan/${pertemuanLamaId}/selesai`,
      {},
      kelompokCookie
    );
    assert.equal(selesai.response.status, 200);
  });

  await check('M10: /api/arsip memuat September, bukan Oktober/November', async () => {
    const arsip = await request('GET', '/api/arsip', undefined, kelompokCookie);
    assert.equal(arsip.response.status, 200);
    assert.ok(Array.isArray(arsip.data.arsip));

    const september = arsip.data.arsip.find((row) => row.bulan === '2026-09');
    assert.ok(september, 'Bulan 2026-09 harus ada di arsip.');
    assert.ok(september.pertemuan >= 1);
    assert.ok(september.absensi >= 1);
    assert.ok(september.penilaian >= 1);
    assert.equal(typeof september.label, 'string');

    assert.ok(!arsip.data.arsip.some((row) => row.bulan === '2026-10'),
      'Oktober belum satu bulan penuh — belum masuk arsip.');
    assert.ok(!arsip.data.arsip.some((row) => row.bulan === '2026-11'),
      'Bulan berjalan tidak masuk arsip.');
  });

  await check('M10: rincian bulan September bisa dilihat kembali', async () => {
    const rincian = await request(
      'GET', '/api/arsip/bulan?bulan=2026-09', undefined, kelompokCookie
    );
    assert.equal(rincian.response.status, 200);
    assert.equal(rincian.data.bulan, '2026-09');
    assert.equal(typeof rincian.data.label, 'string');
    assert.ok(rincian.data.label.includes('2026'));

    const november = await request(
      'GET', '/api/arsip/bulan?bulan=2026-11', undefined, kelompokCookie
    );
    assert.equal(november.response.status, 404);

    const salah = await request(
      'GET', '/api/arsip/bulan?bulan=2026-13', undefined, kelompokCookie
    );
    assert.equal(salah.response.status, 400);

    const kosong = await request(
      'GET', '/api/arsip/bulan', undefined, kelompokCookie
    );
    assert.equal(kosong.response.status, 400);
  });

  await check('M10: lingkup — kelompok lain tidak melihat arsip September ini', async () => {
    const arsipLain = await request('GET', '/api/arsip', undefined, kelompokLainCookie);
    assert.equal(arsipLain.response.status, 200);
    assert.ok(!arsipLain.data.arsip.some((row) => row.bulan === '2026-09'),
      'Arsip kelompok lain tidak boleh terlihat.');

    const rincianLain = await request(
      'GET', '/api/arsip/bulan?bulan=2026-09', undefined, kelompokLainCookie
    );
    assert.equal(rincianLain.response.status, 404);
  });

  await check('Halaman: arsip.html tersaji, menu Arsip ada di semua halaman', async () => {
    const arsipPage = await request('GET', '/arsip.html', undefined, kelompokCookie);
    assert.equal(arsipPage.response.status, 200);
    assert.ok(arsipPage.text.includes('/api/arsip'),
      'arsip.html harus memanggil endpoint arsip.');
    assert.ok(arsipPage.text.includes('id="kelasMenu"'),
      'arsip.html harus memuat menu Kelas.');

    for (const halaman of ['dashboard.html', 'generus.html', 'akun.html',
      'jadwal.html', 'materi.html', 'laporan.html', 'cetak-qr.html',
      'scan.html', 'izin-kelola.html', 'kelas.html']) {
      const page = await request('GET', `/${halaman}`, undefined, kelompokCookie);
      assert.equal(page.response.status, 200, `${halaman} harus 200.`);
      assert.ok(page.text.includes('href="/arsip.html"'),
        `${halaman} harus memuat menu Arsip.`);
    }
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
