'use strict';

// Smoke test Sesi 12 (lanjutan) — Halaman UI baru + navigasi konsisten.
// Menguji: dashboard.html, generus.html, akun.html tersedia dan memuat
// API yang dibutuhkannya; menu sidebar v1 (urutan + tautan) sama di
// SEMUA halaman (3 baru + 6 lama); alur generus dan akun lewat API
// yang dipakai halaman-halaman itu; peran non-admin ditolak endpoint akun.
//
// Jalankan dengan server yang baru dinyalakan. TIDAK memakai jatah
// rate limit POST /api/izin, jadi boleh jalan kapan saja.

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
let desaCookie;
let kelompokId;
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

// Urutan menu v1 — harus sama di semua halaman.
// Sesi 13A: ditambah /kelas.html setelah /generus.html (menu Kelola Kelas).
const MENU = [
  '/dashboard.html',
  '/generus.html',
  '/kelas.html',
  '/materi.html',
  '/jadwal.html',
  '/izin-kelola.html',
  '/laporan.html',
  '/arsip.html',
  '/cetak-qr.html',
  '/akun.html',
];

const SEMUA_HALAMAN = [
  'dashboard.html',
  'generus.html',
  'kelas.html',
  'akun.html',
  'jadwal.html',
  'cetak-qr.html',
  'materi.html',
  'laporan.html',
  'scan.html',
  'izin-kelola.html',
];

async function main() {
  if (!ADMIN_PASSWORD || !ADMIN_PASSWORD.trim()) {
    console.error('FAIL: ADMIN_PASSWORD wajib diisi.');
    process.exitCode = 1;
    return;
  }

  await check('Admin masuk dan membuat akun S13', async () => {
    const desa = await queryDb(
      "SELECT id, nama FROM desa WHERE nama = 'Desa Contoh 3'"
    );
    assert.equal(desa.rowCount, 1, 'Desa Contoh 3 harus tersedia.');
    desaId = desa.rows[0].id;

    const created = await queryDb(
      'INSERT INTO kelompok (nama, desa_id) VALUES ($1, $2) RETURNING id',
      [`Kelompok S13 ${suffix}`, desaId]
    );
    kelompokId = created.rows[0].id;

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

    const accountDesa = await createAndLogin('desa', {
      desa_id: desaId,
    });
    desaCookie = accountDesa.cookie;
  });

  await check('Halaman baru tersedia dan memuat API yang dibutuhkannya', async () => {
    const dashboard = await request('GET', '/dashboard.html', undefined, adminCookie);
    assert.equal(dashboard.response.status, 200);
    assert.match(dashboard.response.headers.get('content-type') || '', /text\/html/i);
    assert.ok(dashboard.text.includes('/api/me'));
    assert.ok(dashboard.text.includes('/api/ringkasan'));
    assert.ok(dashboard.text.includes('/api/generus'));
    assert.ok(dashboard.text.includes('/api/pertemuan'));
    assert.ok(dashboard.text.includes('rel="manifest"'));
    assert.ok(dashboard.text.includes("navigator.serviceWorker.register('/sw.js')"));

    const generus = await request('GET', '/generus.html', undefined, adminCookie);
    assert.equal(generus.response.status, 200);
    assert.match(generus.response.headers.get('content-type') || '', /text\/html/i);
    assert.ok(generus.text.includes('/api/generus'));
    assert.ok(generus.text.includes('/api/wilayah'));
    assert.ok(generus.text.includes('approve'));
    assert.ok(generus.text.includes('ajukan-ulang'));
    assert.ok(generus.text.includes('delete-request'));
    assert.ok(generus.text.includes('delete-approve'));
    assert.ok(generus.text.includes('jenis_kelamin'));

    const akun = await request('GET', '/akun.html', undefined, adminCookie);
    assert.equal(akun.response.status, 200);
    assert.match(akun.response.headers.get('content-type') || '', /text\/html/i);
    assert.ok(akun.text.includes('/api/users'));
    assert.ok(akun.text.includes('/api/wilayah'));
    assert.ok(akun.text.includes('initial_password'));
    assert.ok(akun.text.includes('Halaman ini hanya untuk Admin.'));
  });

  await check('Menu sidebar v1 sama di semua halaman', async () => {
    for (const page of SEMUA_HALAMAN) {
      const result = await request('GET', `/${page}`, undefined, adminCookie);
      assert.equal(result.response.status, 200, page);

      // Hanya tautan sidebar (class side-link) yang dihitung — halaman
      // boleh punya tautan lain ke halaman yang sama di luar sidebar
      // (misal tombol "coba lagi" di generus.html).
      const tautan = [...result.text.matchAll(
        /<a class="side-link[^"]*"[^>]*href="([^"]+)"/g
      )].map((m) => m[1]);
      assert.deepEqual(
        tautan,
        MENU,
        `${page}: menu sidebar harus ${MENU.join(', ')}, dapat ${tautan.join(', ')}`
      );

      // Blok pengguna + tombol keluar ada di sidebar.
      assert.ok(result.text.includes('id="userName"'), page);
      assert.ok(result.text.includes('id="logoutBtn"'), page);
      assert.ok(result.text.includes('Keluar'), page);
    }
  });

  await check('Halaman lama tetap memuat kontennya', async () => {
    const jadwal = await request('GET', '/jadwal.html', undefined, kelompokCookie);
    assert.equal(jadwal.response.status, 200);
    assert.ok(jadwal.text.includes('Jadwal Pengajian'));
    assert.ok(jadwal.text.includes('Salin link izin'));
    assert.ok(jadwal.text.includes('Kelola izin'));

    const materi = await request('GET', '/materi.html', undefined, kelompokCookie);
    assert.equal(materi.response.status, 200);
    assert.ok(materi.text.includes('Materi &amp; Penilaian'));
    assert.ok(materi.text.includes('/api/penilaian'));

    const laporan = await request('GET', '/laporan.html', undefined, kelompokCookie);
    assert.equal(laporan.response.status, 200);
    assert.ok(laporan.text.includes('Laporan Kehadiran'));

    const scan = await request('GET', '/scan.html', undefined, kelompokCookie);
    assert.equal(scan.response.status, 200);
    assert.ok(scan.text.includes('Scan Kehadiran'));
    assert.ok(scan.text.includes('getUserMedia'));
    assert.ok(scan.text.includes('/jsQR.js'));

    const kelola = await request('GET', '/izin-kelola.html', undefined, kelompokCookie);
    assert.equal(kelola.response.status, 200);
    assert.ok(kelola.text.includes('Kelola izin'));

    const cetak = await request('GET', '/cetak-qr.html', undefined, kelompokCookie);
    assert.equal(cetak.response.status, 200);
    assert.ok(cetak.text.includes('Cetak QR Generus'));
  });

  await check('Alur generus lewat API halaman: ajukan, setujui, tampil di daftar', async () => {
    const dibuat = await request('POST', '/api/generus', {
      nama: `Generus S13 ${suffix}`,
      tanggal_lahir: '2015-05-10',
      kelas_sekolah: 'Kelas 4',
      tingkat: 'sd',
      jenis_kelamin: 'perempuan',
      ortu_nama: 'Orang Tua Tes',
      ortu_hubungan: 'Ibu',
      ortu_hp: '081234567890',
    }, kelompokCookie);
    assert.equal(dibuat.response.status, 201);
    assert.equal(dibuat.data.generus.status, 'pending');

    const disetujui = await request(
      'POST',
      `/api/generus/${dibuat.data.generus.id}/approve`,
      {},
      adminCookie
    );
    assert.equal(disetujui.response.status, 200);
    assert.equal(disetujui.data.generus.status, 'approved');

    const daftar = await request(
      'GET',
      '/api/generus?status=approved',
      undefined,
      adminCookie
    );
    assert.equal(daftar.response.status, 200);
    const baris = daftar.data.generus.find(
      (row) => row.id === dibuat.data.generus.id
    );
    assert.ok(baris, 'Generus yang disetujui harus tampil di daftar');
    assert.equal(baris.jenis_kelamin, 'perempuan');
    assert.ok(baris.kelompok_nama, 'Daftar harus memuat nama kelompok');
    assert.ok(baris.desa_nama, 'Daftar harus memuat nama desa');
  });

  await check('Alur akun lewat API halaman: buat, tampil di daftar', async () => {
    const email = `desa-s13-${suffix}@tes.gensa.local`;
    const dibuat = await request('POST', '/api/users', {
      email,
      role: 'desa',
      desa_id: desaId,
      kelompok_id: null,
    }, adminCookie);
    assert.equal(dibuat.response.status, 201);
    assert.equal(typeof dibuat.data.initial_password, 'string');
    assert.equal(dibuat.data.initial_password.length, 12);
    assert.equal(dibuat.data.user.must_change_password, true);

    const daftar = await request('GET', '/api/users', undefined, adminCookie);
    assert.equal(daftar.response.status, 200);
    const baris = daftar.data.users.find((row) => row.email === email);
    assert.ok(baris, 'Akun baru harus tampil di daftar');
    assert.equal(baris.role, 'desa');
    assert.ok(baris.desa_nama, 'Daftar harus memuat nama desa');
    assert.ok(!('password_hash' in baris), 'Daftar akun tidak boleh memuat password_hash');
  });

  await check('Peran non-admin ditolak endpoint akun', async () => {
    const daftar = await request('GET', '/api/users', undefined, kelompokCookie);
    assert.equal(daftar.response.status, 403);

    const buat = await request('POST', '/api/users', {
      email: `tolak-${suffix}@tes.gensa.local`,
      role: 'desa',
      desa_id: desaId,
      kelompok_id: null,
    }, desaCookie);
    assert.equal(buat.response.status, 403);
  });

  await check('Dashboard memuat data ringkasan sesuai peran', async () => {
    const admin = await request('GET', '/api/ringkasan', undefined, adminCookie);
    assert.equal(admin.response.status, 200);
    assert.equal(typeof admin.data.generus.total, 'number');
    assert.equal(typeof admin.data.pertemuan_mendatang, 'number');
    assert.equal(typeof admin.data.izin_menunggu, 'number');

    const kelompok = await request('GET', '/api/ringkasan', undefined, kelompokCookie);
    assert.equal(kelompok.response.status, 200);
    assert.ok(
      kelompok.data.generus.total <= admin.data.generus.total,
      'Ringkasan kelompok tidak boleh lebih besar dari admin'
    );
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
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
