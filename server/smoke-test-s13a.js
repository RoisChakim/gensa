'use strict';

// Smoke test Sesi 13A — Struktur kelas (M7), riwayat kelas (M8),
// tugas per kelas/tahun (M9).
// Menguji: seed 15 kelas + filter GET /api/kelas; CRUD kelas (Admin saja,
// duplikat 409, hapus kelas terpakai 409); pengajuan generus dgn kelas_id
// (kelas_sekolah diturunkan dari nama kelas, jenjang salah 400,
// kelas tak ada 400, teks bebas lama tetap jalan); PATCH generus
// (kelompok, approved saja) + riwayat kelas; ajukan ulang dgn kelas_id;
// tugas dgn kelas_id + tahun_ajaran + filter di /api/tugas dan
// /api/penilaian; halaman /kelas.html tersaji 200.

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

function dataGenerus(nama, tingkat, extra = {}) {
  return {
    nama: `Generus ${nama} ${suffix}`,
    tanggal_lahir: '2015-05-10',
    kelas_sekolah: tingkat === 'sd' ? 'Kelas 4' : 'Kelas 7',
    tingkat,
    jenis_kelamin: 'perempuan',
    ortu_nama: 'Orang Tua Tes',
    ortu_hubungan: 'Ibu',
    ortu_hp: '081234567890',
    ...extra,
  };
}

async function buatGenerus(nama, tingkat, cookie, extra) {
  const created = await request(
    'POST',
    '/api/generus',
    dataGenerus(nama, tingkat, extra),
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

async function kelasId(jenjang, nama) {
  const row = await queryDb(
    'SELECT id FROM kelas WHERE jenjang = $1 AND nama = $2',
    [jenjang, nama]
  );
  assert.equal(row.rowCount, 1, `Kelas ${jenjang}/${nama} harus ada.`);
  return row.rows[0].id;
}

let kelasSdA;
let kelasSdB;
let kelasSmpA;
let kelasBaruId;
let generusA;

async function main() {
  if (!ADMIN_PASSWORD || !ADMIN_PASSWORD.trim()) {
    console.error('FAIL: ADMIN_PASSWORD wajib diisi.');
    process.exitCode = 1;
    return;
  }

  await check('Admin masuk dan membuat akun kelompok S13A', async () => {
    const desa = await queryDb(
      "SELECT id, nama FROM desa WHERE nama IN ('Desa Contoh 3', 'Desa Contoh 1')"
    );
    assert.equal(desa.rowCount, 2, 'Desa Contoh 3 dan Desa Contoh 1 harus tersedia.');
    desaId = desa.rows.find((row) => row.nama === 'Desa Contoh 3').id;
    const desa1Id = desa.rows.find((row) => row.nama === 'Desa Contoh 1').id;

    const created = await queryDb(
      'INSERT INTO kelompok (nama, desa_id) VALUES ($1, $2) RETURNING id',
      [`Kelompok S13A ${suffix}`, desaId]
    );
    kelompokId = created.rows[0].id;
    const createdLain = await queryDb(
      'INSERT INTO kelompok (nama, desa_id) VALUES ($1, $2) RETURNING id',
      [`Kelompok S13A-lain ${suffix}`, desa1Id]
    );
    kelompokLainId = createdLain.rows[0].id;

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

    const account = await createAndLogin('kelompok', { kelompok_id: kelompokId });
    kelompokCookie = account.cookie;
    const accountLain = await createAndLogin('kelompok', { kelompok_id: kelompokLainId });
    kelompokLainCookie = accountLain.cookie;

    kelasSdA = await kelasId('caberawit', 'A');
    kelasSdB = await kelasId('caberawit', 'B');
    kelasSmpA = await kelasId('pra_remaja', 'A');
  });

  await check('M7: seed 15 kelas + filter jenjang/aktif', async () => {
    const semua = await request('GET', '/api/kelas', undefined, adminCookie);
    assert.equal(semua.response.status, 200);
    assert.ok(Array.isArray(semua.data.kelas));
    assert.ok(semua.data.kelas.length >= 15, 'Minimal 15 kelas seed.');

    const caberawit = await request(
      'GET', '/api/kelas?jenjang=caberawit', undefined, adminCookie
    );
    assert.equal(caberawit.response.status, 200);
    assert.equal(caberawit.data.kelas.length, 7);
    assert.ok(caberawit.data.kelas.every((k) => k.jenjang === 'caberawit'));

    const salah = await request(
      'GET', '/api/kelas?jenjang=tidak-ada', undefined, adminCookie
    );
    assert.equal(salah.response.status, 400);

    const tanpaLogin = await request('GET', '/api/kelas');
    assert.equal(tanpaLogin.response.status, 401);
  });

  await check('M7: CRUD kelas — Admin saja, duplikat 409, hapus terpakai 409', async () => {
    const buat = await request('POST', '/api/kelas', {
      jenjang: 'remaja', nama: 'Z', urutan: 99,
    }, adminCookie);
    assert.equal(buat.response.status, 201);
    assert.equal(buat.data.kelas.nama, 'Z');
    kelasBaruId = buat.data.kelas.id;

    const duplikat = await request('POST', '/api/kelas', {
      jenjang: 'remaja', nama: 'Z', urutan: 100,
    }, adminCookie);
    assert.equal(duplikat.response.status, 409);

    const kelompokBuat = await request('POST', '/api/kelas', {
      jenjang: 'remaja', nama: 'Y',
    }, kelompokCookie);
    assert.equal(kelompokBuat.response.status, 403);

    const ubah = await request('PATCH', `/api/kelas/${kelasBaruId}`, {
      nama: 'Z2', aktif: false,
    }, adminCookie);
    assert.equal(ubah.response.status, 200);
    assert.equal(ubah.data.kelas.nama, 'Z2');
    assert.equal(ubah.data.kelas.aktif, false);

    const nonaktif = await request(
      'GET', '/api/kelas?jenjang=remaja&aktif=1', undefined, adminCookie
    );
    assert.equal(nonaktif.response.status, 200);
    assert.ok(!nonaktif.data.kelas.some((k) => k.id === kelasBaruId));

    const hapus = await request('DELETE', `/api/kelas/${kelasBaruId}`, undefined, adminCookie);
    assert.equal(hapus.response.status, 200);

    const hapusLagi = await request('DELETE', `/api/kelas/${kelasBaruId}`, undefined, adminCookie);
    assert.equal(hapusLagi.response.status, 404);
  });

  await check('M7: pengajuan generus dgn kelas_id + validasi jenjang', async () => {
    const dibuat = await buatGenerus('KelasA', 'sd', kelompokCookie, { kelas_id: kelasSdA });
    assert.equal(dibuat.kelas_id, kelasSdA);
    assert.equal(dibuat.kelas_sekolah, 'A');
    generusA = await setujuiGenerus(dibuat.id);

    const daftar = await request(
      'GET', '/api/generus?status=approved', undefined, kelompokCookie
    );
    const baris = daftar.data.generus.find((row) => row.id === generusA.id);
    assert.ok(baris, 'Generus A harus ada di daftar.');
    assert.equal(baris.kelas_nama, 'A');

    // Jenjang salah: kelas SMP untuk tingkat SD.
    const salahJenjang = await request(
      'POST', '/api/generus',
      dataGenerus('SalahJenjang', 'sd', { kelas_id: kelasSmpA }),
      kelompokCookie
    );
    assert.equal(salahJenjang.response.status, 400);

    // Kelas tidak ada.
    const takAda = await request(
      'POST', '/api/generus',
      dataGenerus('TakAda', 'sd', { kelas_id: 999999 }),
      kelompokCookie
    );
    assert.equal(takAda.response.status, 400);

    // Teks bebas lama tetap jalan (klien lama).
    const bebas = await buatGenerus('Bebas', 'sd', kelompokCookie, {});
    assert.equal(bebas.kelas_sekolah, 'Kelas 4');
    assert.equal(bebas.kelas_id, null);
  });

  await check('M8: PATCH generus ubah kelas + riwayat tercatat', async () => {
    // Belum disetujui tidak bisa diubah lewat PATCH (harus approved).
    const pending = await buatGenerus('Pending', 'sd', kelompokCookie, { kelas_id: kelasSdA });
    const patchPending = await request('PATCH', `/api/generus/${pending.id}`, {
      kelas_id: kelasSdB,
    }, kelompokCookie);
    assert.equal(patchPending.response.status, 404);

    // Admin tidak boleh PATCH (hanya kelompok).
    const patchAdmin = await request('PATCH', `/api/generus/${generusA.id}`, {
      kelas_id: kelasSdB,
    }, adminCookie);
    assert.equal(patchAdmin.response.status, 403);

    // Kelompok lain tidak boleh.
    const patchLain = await request('PATCH', `/api/generus/${generusA.id}`, {
      kelas_id: kelasSdB,
    }, kelompokLainCookie);
    assert.equal(patchLain.response.status, 404);

    // Pemilik ubah kelas A -> B.
    const diubah = await request('PATCH', `/api/generus/${generusA.id}`, {
      kelas_id: kelasSdB,
      ortu_hp: '081234567891',
    }, kelompokCookie);
    assert.equal(diubah.response.status, 200);
    assert.equal(diubah.data.generus.kelas_id, kelasSdB);
    assert.equal(diubah.data.generus.kelas_sekolah, 'B');
    assert.equal(diubah.data.generus.ortu_hp, '081234567891');

    const riwayat = await request(
      'GET', `/api/generus/${generusA.id}/riwayat-kelas`, undefined, kelompokCookie
    );
    assert.equal(riwayat.response.status, 200);
    assert.equal(riwayat.data.riwayat.length, 1);
    assert.equal(riwayat.data.riwayat[0].kelas_lama, 'A');
    assert.equal(riwayat.data.riwayat[0].kelas_baru, 'B');
    assert.ok(riwayat.data.riwayat[0].diubah_oleh_nama, 'Nama pengubah harus ada.');

    // Riwayat tidak berubah bila kelas sama.
    const sama = await request('PATCH', `/api/generus/${generusA.id}`, {
      kelas_id: kelasSdB,
    }, kelompokCookie);
    assert.equal(sama.response.status, 200);
    const riwayat2 = await request(
      'GET', `/api/generus/${generusA.id}/riwayat-kelas`, undefined, kelompokCookie
    );
    assert.equal(riwayat2.data.riwayat.length, 1);

    // Kelompok lain tidak bisa lihat riwayat.
    const riwayatLain = await request(
      'GET', `/api/generus/${generusA.id}/riwayat-kelas`, undefined, kelompokLainCookie
    );
    assert.equal(riwayatLain.response.status, 404);
  });

  await check('M8: ajukan ulang dgn kelas_id mencatat riwayat', async () => {
    const dibuat = await buatGenerus('Ulang', 'sd', kelompokCookie, { kelas_id: kelasSdA });
    const tolak = await request('POST', `/api/generus/${dibuat.id}/reject`, {
      catatan: 'Perbaiki kelas.',
    }, adminCookie);
    assert.equal(tolak.response.status, 200);

    const ulang = await request('POST', `/api/generus/${dibuat.id}/ajukan-ulang`, {
      ...dataGenerus('Ulang', 'sd', { kelas_id: kelasSdB }),
    }, kelompokCookie);
    assert.equal(ulang.response.status, 200);
    assert.equal(ulang.data.generus.kelas_id, kelasSdB);
    assert.equal(ulang.data.generus.kelas_sekolah, 'B');

    const riwayat = await request(
      'GET', `/api/generus/${dibuat.id}/riwayat-kelas`, undefined, kelompokCookie
    );
    assert.equal(riwayat.data.riwayat.length, 1);
    assert.equal(riwayat.data.riwayat[0].kelas_lama, 'A');
    assert.equal(riwayat.data.riwayat[0].kelas_baru, 'B');
  });

  await check('M7: hapus kelas terpakai ditolak 409', async () => {
    const hapus = await request('DELETE', `/api/kelas/${kelasSdB}`, undefined, adminCookie);
    assert.equal(hapus.response.status, 409);
  });

  await check('M9: tugas per kelas/tahun + filter', async () => {
    const buat = await request('POST', '/api/tugas', {
      judul: `Tugas Kelas B ${suffix}`,
      kategori: 'doa_surat',
      kelas_id: kelasSdB,
      tahun_ajaran: 2026,
    }, kelompokCookie);
    assert.equal(buat.response.status, 201);
    assert.equal(buat.data.tugas.kelas_id, kelasSdB);
    assert.equal(buat.data.tugas.tahun_ajaran, 2026);

    const buatUmum = await request('POST', '/api/tugas', {
      judul: `Tugas Umum ${suffix}`,
      kategori: 'doa_surat',
    }, kelompokCookie);
    assert.equal(buatUmum.response.status, 201);
    assert.equal(buatUmum.data.tugas.kelas_id, null);

    const tahunSalah = await request('POST', '/api/tugas', {
      judul: 'Tahun Salah',
      kategori: 'doa_surat',
      tahun_ajaran: 1999,
    }, kelompokCookie);
    assert.equal(tahunSalah.response.status, 400);

    const kelasSalah = await request('POST', '/api/tugas', {
      judul: 'Kelas Salah',
      kategori: 'doa_surat',
      kelas_id: 999999,
    }, kelompokCookie);
    assert.equal(kelasSalah.response.status, 400);

    const filterKelas = await request(
      'GET', `/api/tugas?kelas_id=${kelasSdB}`, undefined, kelompokCookie
    );
    assert.equal(filterKelas.response.status, 200);
    assert.ok(filterKelas.data.tugas.length >= 1);
    assert.ok(filterKelas.data.tugas.every((t) => t.kelas_id === kelasSdB));
    assert.equal(filterKelas.data.tugas[0].kelas_nama, 'B');

    const filterTahun = await request(
      'GET', '/api/tugas?tahun_ajaran=2026', undefined, kelompokCookie
    );
    assert.equal(filterTahun.response.status, 200);
    assert.ok(filterTahun.data.tugas.every((t) => t.tahun_ajaran === 2026));

    const filterPenilaian = await request(
      'GET', `/api/penilaian?kelas_id=${kelasSdB}`, undefined, kelompokCookie
    );
    assert.equal(filterPenilaian.response.status, 200);
    assert.ok(filterPenilaian.data.tugas.every((t) => t.kelas_id === kelasSdB));
  });

  await check('Halaman kelas tersaji + halaman lama tetap 200', async () => {
    for (const page of ['/kelas.html', '/dashboard.html', '/generus.html', '/materi.html']) {
      const res = await request('GET', page);
      assert.equal(res.response.status, 200, `${page} harus 200.`);
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

main().catch((error) => {
  console.error('FAIL: Smoke test tidak dapat diselesaikan.', error);
  process.exitCode = 1;
});
