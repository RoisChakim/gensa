'use strict';

// Smoke test Sesi 13B — Notifikasi hasil pengajuan (M5) + catatan tolak
// hapus terpisah (D9). Menguji: Admin menyetujui pengajuan generus ->
// pemohon menerima notifikasi generus_disetujui; Admin menolak pengajuan
// -> notifikasi generus_ditolak berisi alasan; Admin menolak pengajuan
// hapus -> notifikasi hapus_ditolak + catatan_tolak_hapus terisi TANPA
// menimpa alasan_penolakan; Admin menyetujui hapus generus ber-riwayat
// -> notifikasi hapus_disetujui; daftar/baca/baca-semua notifikasi;
// isolasi antar pengguna; ringkasan memuat notifikasi_belum_dibaca;
// dashboard.html dan generus.html memuat kartu/banner notifikasi.
//
// CATATAN: jalankan dengan server yang baru dinyalakan. Tidak memakai
// jatah POST /api/izin, jadi boleh jalan berurutan dengan tes lain.

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
let pertemuanId;
const generus = {};
const notifikasi = {};

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
    [`Kelompok S13B ${suffix}`, desaId]
  );
  kelompokId = created.rows[0].id;

  const createdLain = await queryDb(
    'INSERT INTO kelompok (nama, desa_id) VALUES ($1, $2) RETURNING id',
    [`Kelompok S13B-lain ${suffix}`, desa1Id]
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

async function belumDibaca(cookie) {
  const hitung = await request('GET', '/api/notifikasi/belum-dibaca', undefined, cookie);
  assert.equal(hitung.response.status, 200);
  return hitung.data.belum_dibaca;
}

async function cariNotifikasi(jenis, generusId, cookie) {
  const daftar = await request('GET', '/api/notifikasi?batas=50', undefined, cookie);
  assert.equal(daftar.response.status, 200);
  return daftar.data.notifikasi.find(
    (row) => row.jenis === jenis && row.generus_id === generusId
  );
}

async function main() {
  if (!ADMIN_PASSWORD || !ADMIN_PASSWORD.trim()) {
    console.error('FAIL: ADMIN_PASSWORD wajib diisi.');
    process.exitCode = 1;
    return;
  }

  await check('Admin masuk dan membuat akun S13B', async () => {
    await setupKelompok();

    const login = await request('POST', '/api/login', {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    assert.equal(login.response.status, 200);
    assert.ok(login.cookie);
    adminCookie = login.cookie;

    if (login.data.user.must_change_password) {
      // Kembalikan ke password yang sama (seperti S1) supaya tes bisa
      // diulang tanpa reset manual di DB.
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

  await check('M5: pengajuan disetujui -> notifikasi generus_disetujui', async () => {
    const sebelum = await belumDibaca(kelompokCookie);
    const dibuat = await buatGenerus('NotifSetuju', 'sd', kelompokCookie, 'perempuan');
    generus.Setuju = await setujuiGenerus(dibuat.id);

    const sesudah = await belumDibaca(kelompokCookie);
    assert.equal(sesudah, sebelum + 1, 'Jumlah belum dibaca harus naik 1.');

    const item = await cariNotifikasi('generus_disetujui', dibuat.id, kelompokCookie);
    assert.ok(item, 'Notifikasi generus_disetujui harus ada.');
    assert.equal(item.dibaca, false);
    assert.equal(item.generus_nama, dibuat.nama);
    assert.ok(item.judul.length > 0);
    assert.ok(item.pesan.includes(dibuat.nama));
    notifikasi.Setuju = item;
  });

  await check('M5: pengajuan ditolak -> notifikasi generus_ditolak berisi alasan', async () => {
    const dibuat = await buatGenerus('NotifTolak', 'sd', kelompokCookie, 'perempuan');
    const tolak = await request(
      'POST',
      `/api/generus/${dibuat.id}/reject`,
      { catatan: 'Nama orang tua belum lengkap.' },
      adminCookie
    );
    assert.equal(tolak.response.status, 200);

    const item = await cariNotifikasi('generus_ditolak', dibuat.id, kelompokCookie);
    assert.ok(item, 'Notifikasi generus_ditolak harus ada.');
    assert.equal(item.dibaca, false);
    assert.ok(item.pesan.includes('Nama orang tua belum lengkap.'),
      'Pesan notifikasi harus memuat alasan Admin.');
    notifikasi.Tolak = item;
  });

  await check('D9: tolak hapus tidak menimpa alasan_penolakan + notifikasi hapus_ditolak', async () => {
    const dibuat = await buatGenerus('TolakHapus', 'sd', kelompokCookie, 'perempuan');
    const tolakAwal = await request(
      'POST',
      `/api/generus/${dibuat.id}/reject`,
      { catatan: 'Data kurang lengkap.' },
      adminCookie
    );
    assert.equal(tolakAwal.response.status, 200);

    const ulang = await request(
      'POST',
      `/api/generus/${dibuat.id}/ajukan-ulang`,
      { ...dataGenerus('TolakHapus', 'sd', 'perempuan'), tanggal_lahir: '2014-03-02' },
      kelompokCookie
    );
    assert.equal(ulang.response.status, 200);
    generus.TolakHapus = await setujuiGenerus(dibuat.id);

    const minta = await request(
      'POST',
      `/api/generus/${dibuat.id}/delete-request`,
      { alasan: 'Pindah kelompok.' },
      kelompokCookie
    );
    assert.equal(minta.response.status, 200);

    const tolakHapus = await request(
      'POST',
      `/api/generus/${dibuat.id}/delete-reject`,
      { catatan: 'Jangan hapus dulu.' },
      adminCookie
    );
    assert.equal(tolakHapus.response.status, 200);
    assert.equal(tolakHapus.data.generus.status, 'approved');

    const baris = await queryDb(
      'SELECT alasan_penolakan, catatan_tolak_hapus FROM generus WHERE id = $1',
      [dibuat.id]
    );
    // ajukan-ulang membersihkan alasan penolakan lama (benar) — yang
    // penting: tolak-hapus TIDAK menulis ke alasan_penolakan (D9).
    // Kode lama menulis catatan tolak-hapus ke alasan_penolakan.
    assert.equal(baris.rows[0].alasan_penolakan, null,
      'alasan_penolakan harus tetap kosong setelah tolak hapus.');
    assert.equal(baris.rows[0].catatan_tolak_hapus, 'Jangan hapus dulu.');

    const item = await cariNotifikasi('hapus_ditolak', dibuat.id, kelompokCookie);
    assert.ok(item, 'Notifikasi hapus_ditolak harus ada.');
    assert.ok(item.pesan.includes('Jangan hapus dulu.'));

    // D9, varian kuat: bila ada alasan penolakan lama, tolak-hapus kedua
    // tidak boleh menimpanya.
    await queryDb(
      "UPDATE generus SET alasan_penolakan = 'Data kurang lengkap.' WHERE id = $1",
      [dibuat.id]
    );
    const mintaLagi = await request(
      'POST',
      `/api/generus/${dibuat.id}/delete-request`,
      { alasan: 'Pindah kelompok lagi.' },
      kelompokCookie
    );
    assert.equal(mintaLagi.response.status, 200);
    const tolakLagi = await request(
      'POST',
      `/api/generus/${dibuat.id}/delete-reject`,
      { catatan: 'Tetap jangan hapus.' },
      adminCookie
    );
    assert.equal(tolakLagi.response.status, 200);
    const barisLagi = await queryDb(
      'SELECT alasan_penolakan, catatan_tolak_hapus FROM generus WHERE id = $1',
      [dibuat.id]
    );
    assert.equal(barisLagi.rows[0].alasan_penolakan, 'Data kurang lengkap.',
      'alasan_penolakan lama tidak boleh ditimpa catatan tolak hapus.');
    assert.equal(barisLagi.rows[0].catatan_tolak_hapus, 'Tetap jangan hapus.');
    notifikasi.TolakHapus = item;
  });

  await check('M5: hapus generus ber-riwayat disetujui -> notifikasi hapus_disetujui', async () => {
    const dibuat = await buatGenerus('NotifHapus', 'sd', kelompokCookie, 'perempuan');
    generus.Hapus = await setujuiGenerus(dibuat.id);

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
      { kode: generus.Hapus.kode_manual },
      kelompokCookie
    );
    assert.equal(absen.response.status, 200);

    const minta = await request(
      'POST',
      `/api/generus/${dibuat.id}/delete-request`,
      { alasan: 'Sudah pindah kota.' },
      kelompokCookie
    );
    assert.equal(minta.response.status, 200);

    const hapus = await request(
      'POST',
      `/api/generus/${dibuat.id}/delete-approve`,
      {},
      adminCookie
    );
    assert.equal(hapus.response.status, 200);

    const item = await cariNotifikasi('hapus_disetujui', dibuat.id, kelompokCookie);
    assert.ok(item, 'Notifikasi hapus_disetujui harus ada.');
    assert.equal(item.generus_nama, dibuat.nama);
    notifikasi.Hapus = item;
  });

  await check('Baca notifikasi: satu per satu, lalu baca-semua', async () => {
    const sebelum = await belumDibaca(kelompokCookie);
    assert.ok(sebelum >= 2, 'Masih ada notifikasi belum dibaca.');

    const satu = await request(
      'POST',
      `/api/notifikasi/${notifikasi.Setuju.id}/baca`,
      {},
      kelompokCookie
    );
    assert.equal(satu.response.status, 200);
    assert.equal(await belumDibaca(kelompokCookie), sebelum - 1);

    const item = await cariNotifikasi('generus_disetujui', generus.Setuju.id, kelompokCookie);
    assert.equal(item.dibaca, true);

    const semua = await request(
      'POST',
      '/api/notifikasi/baca-semua',
      {},
      kelompokCookie
    );
    assert.equal(semua.response.status, 200);
    assert.equal(await belumDibaca(kelompokCookie), 0);
  });

  await check('Isolasi: pengguna lain tidak melihat notifikasi + baca milik orang lain 404', async () => {
    const daftar = await request('GET', '/api/notifikasi?batas=50', undefined, kelompokLainCookie);
    assert.equal(daftar.response.status, 200);
    assert.ok(!daftar.data.notifikasi.some(
      (row) => row.generus_id === generus.Setuju.id
    ), 'Notifikasi kelompok lain tidak boleh terlihat.');

    const bacaOrangLain = await request(
      'POST',
      `/api/notifikasi/${notifikasi.Tolak.id}/baca`,
      {},
      kelompokLainCookie
    );
    assert.equal(bacaOrangLain.response.status, 404);
  });

  await check('Validasi: batas salah 400, id tidak ada 404, ringkasan memuat jumlah', async () => {
    const batasSalah = await request('GET', '/api/notifikasi?batas=abc', undefined, kelompokCookie);
    assert.equal(batasSalah.response.status, 400);

    const tidakAda = await request('POST', '/api/notifikasi/999999/baca', {}, kelompokCookie);
    assert.equal(tidakAda.response.status, 404);

    const ringkasan = await request('GET', '/api/ringkasan', undefined, kelompokCookie);
    assert.equal(ringkasan.response.status, 200);
    assert.equal(typeof ringkasan.data.notifikasi_belum_dibaca, 'number');
    assert.equal(ringkasan.data.notifikasi_belum_dibaca, 0);
  });

  await check('Halaman: dashboard memuat kartu notifikasi, generus memuat banner', async () => {
    const dashboard = await request('GET', '/dashboard.html', undefined, kelompokCookie);
    assert.equal(dashboard.response.status, 200);
    assert.ok(dashboard.text.includes('id="notifCard"'), 'dashboard.html harus memuat notifCard.');
    assert.ok(dashboard.text.includes('id="notifBell"'), 'dashboard.html harus memuat notifBell.');

    const generusPage = await request('GET', '/generus.html', undefined, kelompokCookie);
    assert.equal(generusPage.response.status, 200);
    assert.ok(generusPage.text.includes('id="notifBanner"'), 'generus.html harus memuat notifBanner.');
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
