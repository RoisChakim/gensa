'use strict';

// Smoke test Sesi 13C — Link izin per kelompok (D3) + tanpa nama
// sebelum verifikasi kode (R3). Menguji: GET /api/kelompok/:id/link-izin
// mengembalikan satu token per kelompok (idempotent, lingkup peran);
// GET /api/izin?t=<token kelompok> menyelesaikan ke kegiatan terdekat
// yang akan datang TANPA daftar nama (R3); token pertemuan lama tetap
// jalan; POST /api/izin/verifikasi mengembalikan satu generus hanya
// setelah kode benar (dan dalam lingkup + approved); pengiriman izin
// lewat token kelompok; izin-kelola memuat kartu link per kelompok;
// izin.html memuat alur verifikasi dulu.
//
// CATATAN: jalankan dengan server yang baru dinyalakan. Tes ini memakai
// jatah POST /api/izin + /api/izin/verifikasi (10/menit/IP, R2) —
// total 9 percobaan, jadi JANGAN jalankan berurutan dengan S10/S12
// tanpa jeda 60 detik.

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
let tokenKelompok;
let tokenKelompokLain;
let pertemuanBesokId;
let pertemuanLusaId;
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
    "SELECT id, nama FROM desa WHERE nama IN ('Desa Contoh 2', 'Desa Contoh 1')"
  );
  assert.equal(desa.rowCount, 2, 'Desa Contoh 2 dan Desa Contoh 1 harus tersedia.');
  desaId = desa.rows.find((row) => row.nama === 'Desa Contoh 2').id;
  const desa1Id = desa.rows.find((row) => row.nama === 'Desa Contoh 1').id;

  const created = await queryDb(
    'INSERT INTO kelompok (nama, desa_id) VALUES ($1, $2) RETURNING id',
    [`Kelompok S13C ${suffix}`, desaId]
  );
  kelompokId = created.rows[0].id;

  const createdLain = await queryDb(
    'INSERT INTO kelompok (nama, desa_id) VALUES ($1, $2) RETURNING id',
    [`Kelompok S13C-lain ${suffix}`, desa1Id]
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

function tokenDariUrl(url) {
  const match = /^\/izin\.html\?t=([a-f0-9]{32})$/.exec(url);
  assert.ok(match, `URL link izin tidak sesuai pola: ${url}`);
  return match[1];
}

async function main() {
  if (!ADMIN_PASSWORD || !ADMIN_PASSWORD.trim()) {
    console.error('FAIL: ADMIN_PASSWORD wajib diisi.');
    process.exitCode = 1;
    return;
  }

  await check('Admin masuk dan membuat akun S13C', async () => {
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

  await check('D3: satu link per kelompok, idempotent, lingkup peran', async () => {
    const pertama = await request(
      'GET', `/api/kelompok/${kelompokId}/link-izin`, undefined, kelompokCookie
    );
    assert.equal(pertama.response.status, 200);
    tokenKelompok = tokenDariUrl(pertama.data.url);

    const kedua = await request(
      'GET', `/api/kelompok/${kelompokId}/link-izin`, undefined, kelompokCookie
    );
    assert.equal(kedua.response.status, 200);
    assert.equal(tokenDariUrl(kedua.data.url), tokenKelompok,
      'Token kelompok harus sama di pemanggilan kedua.');

    const admin = await request(
      'GET', `/api/kelompok/${kelompokId}/link-izin`, undefined, adminCookie
    );
    assert.equal(admin.response.status, 200);
    assert.equal(tokenDariUrl(admin.data.url), tokenKelompok);

    const desa = await request(
      'GET', `/api/kelompok/${kelompokId}/link-izin`, undefined, desaCookie
    );
    assert.equal(desa.response.status, 200);

    const lain = await request(
      'GET', `/api/kelompok/${kelompokId}/link-izin`, undefined, kelompokLainCookie
    );
    assert.equal(lain.response.status, 403,
      'Kelompok lain tidak boleh mengambil link kelompok ini.');

    const tokenLain = await request(
      'GET', `/api/kelompok/${kelompokLainId}/link-izin`, undefined, kelompokLainCookie
    );
    assert.equal(tokenLain.response.status, 200);
    tokenKelompokLain = tokenDariUrl(tokenLain.data.url);
    assert.notEqual(tokenKelompokLain, tokenKelompok);
  });

  await check('R3: GET /api/izin tanpa kegiatan -> 404; tanpa nama', async () => {
    const kosong = await request('GET', `/api/izin?t=${tokenKelompokLain}`);
    assert.equal(kosong.response.status, 404);
    assert.ok(kosong.data.error.includes('Belum ada kegiatan'));

    const palsu = await request('GET', `/api/izin?t=${'a'.repeat(32)}`);
    assert.equal(palsu.response.status, 404);
  });

  await check('D3: token kelompok menyelesaikan ke kegiatan terdekat', async () => {
    const dibuat = await buatGenerus('IzinA', 'sd', kelompokCookie, 'perempuan');
    generus.A = await setujuiGenerus(dibuat.id);

    const besok = await request('POST', '/api/pertemuan', {
      tingkat: 'kelompok',
      kelompok_id: kelompokId,
      jenjang: ['caberawit'],
      tanggal: hariIni(1),
    }, kelompokCookie);
    assert.equal(besok.response.status, 201);
    pertemuanBesokId = besok.data.pertemuan.id;

    const lusa = await request('POST', '/api/pertemuan', {
      tingkat: 'kelompok',
      kelompok_id: kelompokId,
      jenjang: ['caberawit'],
      tanggal: hariIni(3),
    }, kelompokCookie);
    assert.equal(lusa.response.status, 201);
    pertemuanLusaId = lusa.data.pertemuan.id;

    const muat = await request('GET', `/api/izin?t=${tokenKelompok}`);
    assert.equal(muat.response.status, 200);
    assert.equal(muat.data.pertemuan.id, pertemuanBesokId,
      'Harus menyelesaikan ke kegiatan besok (terdekat), bukan lusa.');
    assert.equal(muat.data.pertemuan.tanggal.slice(0, 10), hariIni(1));
    assert.equal(muat.data.mode, 'kelompok');
    assert.equal(muat.data.kelompok.id, kelompokId);
    assert.ok(!('generus' in muat.data), 'R3: daftar nama tidak boleh dikirim.');
    assert.ok(!('desa' in muat.data));
    assert.ok(!JSON.stringify(muat.data).includes(generus.A.nama),
      'R3: nama generus tidak boleh bocor sebelum verifikasi kode.');
  });

  await check('R3: verifikasi kode — benar tampil, salah/luar lingkup 404', async () => {
    const benar = await request('POST', `/api/izin/verifikasi?t=${tokenKelompok}`, {
      kode: generus.A.kode_manual,
    });
    assert.equal(benar.response.status, 200);
    assert.equal(benar.data.generus.id, generus.A.id);
    assert.equal(benar.data.generus.nama, generus.A.nama);

    const salah = await request('POST', `/api/izin/verifikasi?t=${tokenKelompok}`, {
      kode: 'ZZZZZZ',
    });
    assert.equal(salah.response.status, 404);

    const dibuatLain = await buatGenerus('IzinLain', 'sd', kelompokLainCookie, 'perempuan');
    const disetujuiLain = await setujuiGenerus(dibuatLain.id);
    const luar = await request('POST', `/api/izin/verifikasi?t=${tokenKelompok}`, {
      kode: disetujuiLain.kode_manual,
    });
    assert.equal(luar.response.status, 404,
      'Kode generus kelompok lain tidak boleh lolos di kegiatan ini.');
  });

  await check('D3: kirim izin lewat token kelompok + duplikat + validasi alasan', async () => {
    const kirim = await request('POST', `/api/izin?t=${tokenKelompok}`, {
      generus_id: generus.A.id,
      kode: generus.A.kode_manual,
      alasan: 'sakit',
      keterangan: null,
    });
    assert.equal(kirim.response.status, 201);
    assert.equal(kirim.data.izin.status, 'menunggu');
    assert.equal(kirim.data.izin.pertemuan_id, pertemuanBesokId);

    const duplikat = await request('POST', `/api/izin?t=${tokenKelompok}`, {
      generus_id: generus.A.id,
      kode: generus.A.kode_manual,
      alasan: 'sakit',
      keterangan: null,
    });
    assert.equal(duplikat.response.status, 409);

    const dibuatB = await buatGenerus('IzinB', 'sd', kelompokCookie, 'perempuan');
    generus.B = await setujuiGenerus(dibuatB.id);

    const tanpaAlasan = await request('POST', `/api/izin?t=${tokenKelompok}`, {
      generus_id: generus.B.id,
      kode: generus.B.kode_manual,
      alasan: 'izin',
      keterangan: null,
    });
    assert.equal(tanpaAlasan.response.status, 400,
      'Alasan izin wajib disertai keterangan tertulis.');

    const denganAlasan = await request('POST', `/api/izin?t=${tokenKelompok}`, {
      generus_id: generus.B.id,
      kode: generus.B.kode_manual,
      alasan: 'izin',
      keterangan: 'Ada acara keluarga.',
    });
    assert.equal(denganAlasan.response.status, 201);
  });

  await check('Token pertemuan lama tetap jalan (kompatibilitas mundur)', async () => {
    const link = await request(
      'GET', `/api/pertemuan/${pertemuanLusaId}/link-izin`, undefined, kelompokCookie
    );
    assert.equal(link.response.status, 200);
    const tokenPertemuan = tokenDariUrl(link.data.url);

    const muat = await request('GET', `/api/izin?t=${tokenPertemuan}`);
    assert.equal(muat.response.status, 200);
    assert.equal(muat.data.pertemuan.id, pertemuanLusaId);
    assert.equal(muat.data.mode, 'pertemuan');
    assert.ok(!('generus' in muat.data));

    const dibuatC = await buatGenerus('IzinC', 'sd', kelompokCookie, 'perempuan');
    generus.C = await setujuiGenerus(dibuatC.id);
    const kirim = await request('POST', `/api/izin?t=${tokenPertemuan}`, {
      generus_id: generus.C.id,
      kode: generus.C.kode_manual,
      alasan: 'sakit',
      keterangan: null,
    });
    assert.equal(kirim.response.status, 201);
    assert.equal(kirim.data.izin.pertemuan_id, pertemuanLusaId);

    const daftar = await request(
      'GET', `/api/pertemuan/${pertemuanBesokId}/izin`, undefined, kelompokCookie
    );
    assert.equal(daftar.response.status, 200);
    assert.ok(Array.isArray(daftar.data.izin));
    assert.ok(daftar.data.izin.some((row) => row.generus_id === generus.A.id));
  });

  await check('Halaman: izin.html alur verifikasi, izin-kelola kartu link kelompok', async () => {
    const izinPage = await request('GET', '/izin.html', undefined, kelompokCookie);
    assert.equal(izinPage.response.status, 200);
    assert.ok(izinPage.text.includes('Verifikasi kode'),
      'izin.html harus memuat langkah verifikasi kode.');
    assert.ok(izinPage.text.includes('/api/izin/verifikasi'),
      'izin.html harus memanggil endpoint verifikasi.');
    assert.ok(izinPage.text.includes('jsQR'),
      'izin.html harus tetap memuat pemindai QR.');

    const kelolaPage = await request('GET', '/izin-kelola.html', undefined, kelompokCookie);
    assert.equal(kelolaPage.response.status, 200);
    assert.ok(kelolaPage.text.includes('id="bagian-link-kelompok"'),
      'izin-kelola.html harus memuat kartu link per kelompok.');
    assert.ok(kelolaPage.text.includes('/link-izin'),
      'izin-kelola.html harus memanggil endpoint link-izin kelompok.');
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
