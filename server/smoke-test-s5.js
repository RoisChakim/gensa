'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const QRCode = require('qrcode');
const jsQR = require('jsqr');

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
let kelompokId;
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

  const text = await response.text();
  let data = {};

  try {
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

async function findKelompokC() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL wajib diisi untuk mencari kelompok contoh.');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const result = await client.query(
      `SELECT k.id AS kelompok_id, k.desa_id AS desa_id
       FROM kelompok k
       JOIN desa d ON d.id = k.desa_id
       JOIN daerah a ON a.id = d.daerah_id
       WHERE a.nama = $1 AND d.nama = $2 AND k.nama = $3`,
      ['Daerah Contoh', 'Desa Contoh 3', 'Kelompok Contoh C']
    );

    assert.equal(result.rowCount, 1, 'Kelompok contoh C tidak ditemukan.');
    return result.rows[0];
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

  const approved = await request(
    'POST',
    `/api/generus/${created.data.generus.id}/approve`,
    {},
    adminCookie
  );
  assert.equal(approved.response.status, 200);
  assert.match(approved.data.generus.qr_token, /^[a-f0-9]{32}$/);
  assert.match(approved.data.generus.kode_manual, /^[A-HJ-NP-Z2-9]{6}$/);
  generus[nama] = approved.data.generus;
}

async function main() {
  if (!ADMIN_PASSWORD || !ADMIN_PASSWORD.trim()) {
    console.error('FAIL: ADMIN_PASSWORD wajib diisi.');
    process.exitCode = 1;
    return;
  }

  await check('Admin masuk dan membuat akun kelompok C', async () => {
    const location = await findKelompokC();
    kelompokId = location.kelompok_id;
    desaId = location.desa_id;

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

  await check('Halaman scan tersedia dan memuat jsQR', async () => {
    const page = await request('GET', '/scan.html', undefined, kelompokCookie);
    assert.equal(page.response.status, 200);
    assert.match(page.response.headers.get('content-type') || '', /text\/html/i);
    assert.match(page.text, /Scan Kehadiran/);
    assert.match(page.text, /getUserMedia/);
    assert.match(page.text, /\/jsQR\.js/);
    assert.match(page.text, /\/api\/pertemuan\//);
    assert.match(page.text, /'\/absen'/);

    const lib = await request('GET', '/jsQR.js', undefined, kelompokCookie);
    assert.equal(lib.response.status, 200);
    assert.match(lib.response.headers.get('content-type') || '', /javascript/i);
    assert.ok(lib.text.length > 100000, 'Pustaka jsQR terlalu kecil.');
    assert.match(lib.text, /jsQR/);
  });

  await check('Alur scan: QR token mencatat hadir', async () => {
    await buatGenerusDisetujui('E', 'sd');
    await buatGenerusDisetujui('F', 'sd');

    const pertemuan = await request('POST', '/api/pertemuan', {
      tingkat: 'kelompok',
      kelompok_id: kelompokId,
      jenjang: ['caberawit'],
      tanggal: hariIni(),
    }, kelompokCookie);
    assert.equal(pertemuan.response.status, 201);
    pertemuanId = pertemuan.data.pertemuan.id;

    // Sumber data pemilih pertemuan di halaman scan.
    const daftar = await request(
      'GET',
      '/api/pertemuan?tingkat=kelompok',
      undefined,
      kelompokCookie
    );
    assert.equal(daftar.response.status, 200);
    assert.ok(daftar.data.pertemuan.some(
      (item) => item.id === pertemuanId && item.selesai_pada === null
    ));

    // Inilah yang dikirim halaman scan setelah jsQR membaca QR.
    const scan = await request(
      'POST',
      `/api/pertemuan/${pertemuanId}/absen`,
      { kode: generus.E.qr_token },
      kelompokCookie
    );
    assert.equal(scan.response.status, 200);
    assert.equal(scan.data.absensi.status, 'hadir');
    assert.equal(scan.data.absensi.generus_id, generus.E.id);

    // Nama yang ditampilkan halaman scan diambil dari daftar ini.
    const absensi = await request(
      'GET',
      `/api/pertemuan/${pertemuanId}/absensi`,
      undefined,
      kelompokCookie
    );
    assert.equal(absensi.response.status, 200);
    const baris = absensi.data.absensi.find(
      (row) => row.generus_id === generus.E.id
    );
    assert.ok(baris, 'Baris absensi E tidak ditemukan.');
    assert.equal(baris.nama, generus.E.nama);
    assert.equal(baris.status, 'hadir');
  });

  await check('jsQR membaca QR yang dicetak server', async () => {
    // QR yang sama dengan yang dicetak /api/generus/:id/qr.svg
    // (pustaka qrcode yang sama, token yang sama), diubah jadi
    // bitmap lalu dibaca jsQR — jalur decode yang dipakai halaman.
    const token = generus.E.qr_token;
    const qr = QRCode.create(token, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    const scale = 8;
    const width = (size + 8) * scale;
    const data = new Uint8ClampedArray(width * width * 4);

    for (let y = 0; y < width; y++) {
      for (let x = 0; x < width; x++) {
        const mx = Math.floor(x / scale) - 4;
        const my = Math.floor(y / scale) - 4;
        const dark = mx >= 0 && mx < size && my >= 0 && my < size &&
          qr.modules.get(mx, my);
        const i = (y * width + x) * 4;
        const v = dark ? 0 : 255;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }

    const decoded = jsQR(data, width, width);
    assert.ok(decoded, 'jsQR tidak menemukan QR.');
    assert.equal(decoded.data, token);
  });

  await check('Scan ulang kode yang sama tidak membuat absensi ganda', async () => {
    const ulang = await request(
      'POST',
      `/api/pertemuan/${pertemuanId}/absen`,
      { kode: generus.E.qr_token },
      kelompokCookie
    );
    assert.equal(ulang.response.status, 200);
    assert.equal(ulang.data.absensi.status, 'hadir');

    const absensi = await request(
      'GET',
      `/api/pertemuan/${pertemuanId}/absensi`,
      undefined,
      kelompokCookie
    );
    assert.equal(absensi.response.status, 200);
    assert.equal(absensi.data.absensi.length, 1);
  });

  await check('Kode manual mencatat hadir, kode salah ditolak', async () => {
    const manual = await request(
      'POST',
      `/api/pertemuan/${pertemuanId}/absen`,
      { kode: generus.F.kode_manual },
      kelompokCookie
    );
    assert.equal(manual.response.status, 200);
    assert.equal(manual.data.absensi.status, 'hadir');
    assert.equal(manual.data.absensi.generus_id, generus.F.id);

    const salah = await request(
      'POST',
      `/api/pertemuan/${pertemuanId}/absen`,
      { kode: '00000000000000000000000000000000' },
      kelompokCookie
    );
    assert.equal(salah.response.status, 404);
  });

  await check('QR generus tersedia sebagai SVG untuk dicetak', async () => {
    const result = await request(
      'GET',
      `/api/generus/${generus.E.id}/qr.svg`,
      undefined,
      kelompokCookie
    );
    assert.equal(result.response.status, 200);
    assert.match(result.response.headers.get('content-type') || '', /image\/svg\+xml/i);
    assert.match(result.text, /<svg\b/i);
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
