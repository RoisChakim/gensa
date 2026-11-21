'use strict';

// Smoke test Sesi 14E — Kartu QR + foto generus (Q8).
// Jalankan dari direktori server dengan server dan migrasi terbaru.
// Tidak membuat pertemuan atau absensi.

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
const UPLOADS_DIR = path.resolve(__dirname, 'uploads');
const MAX_FOTO_BYTES = 2 * 1024 * 1024;
const suffix = crypto.randomBytes(8).toString('hex');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AvwH/2Q==',
  'base64'
);

let failures = 0;
let adminCookie;
let adminState;
let kelompokACookie;
let kelompokBCookie;
let desaCookie;
let kelompokAId;
let kelompokBId;
let desaId;
let generusA;
let generusTanpaFoto;
let kodeManual;
let fotoPng;
let fotoJpeg;

const generusIds = new Set();
const uploadedFiles = new Set();

async function api(method, url, body, cookie) {
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

async function login(email, password) {
  const result = await api('POST', '/api/login', { email, password });
  assert.equal(result.response.status, 200);
  assert.ok(result.cookie);
  return result;
}

async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    return true;
  } catch (error) {
    failures += 1;
    console.error(`FAIL: ${name} — ${error.message}`);
    return false;
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

async function createAndLogin(role, scope) {
  const email = `${role}-${suffix}-${crypto.randomBytes(4).toString('hex')}@tes.gensa.local`;
  const created = await api('POST', '/api/users', {
    email,
    role,
    ...scope,
  }, adminCookie);

  assert.equal(created.response.status, 201);
  assert.equal(typeof created.data.initial_password, 'string');

  const loggedIn = await login(email, created.data.initial_password);
  const newPassword = `Tes${crypto.randomBytes(16).toString('hex')}`;
  const changed = await api('POST', '/api/change-password', {
    old_password: created.data.initial_password,
    new_password: newPassword,
  }, loggedIn.cookie);

  assert.equal(changed.response.status, 200);
  return { cookie: loggedIn.cookie, user: created.data.user };
}

async function setupKelompok() {
  const desa = await queryDb(
    'SELECT id FROM desa ORDER BY id LIMIT 1'
  );
  assert.equal(desa.rowCount, 1, 'Minimal satu desa harus tersedia.');
  desaId = desa.rows[0].id;

  const kelompokA = await queryDb(
    'INSERT INTO kelompok (nama, desa_id) VALUES ($1, $2) RETURNING id',
    [`Kelompok S14E A ${suffix}`, desaId]
  );
  kelompokAId = kelompokA.rows[0].id;

  const kelompokB = await queryDb(
    'INSERT INTO kelompok (nama, desa_id) VALUES ($1, $2) RETURNING id',
    [`Kelompok S14E B ${suffix}`, desaId]
  );
  kelompokBId = kelompokB.rows[0].id;

  kelompokACookie = (await createAndLogin('kelompok', {
    kelompok_id: kelompokAId,
  })).cookie;
  kelompokBCookie = (await createAndLogin('kelompok', {
    kelompok_id: kelompokBId,
  })).cookie;
  desaCookie = (await createAndLogin('desa', {
    desa_id: desaId,
  })).cookie;
}

async function buatGenerus(nama) {
  const created = await api('POST', '/api/generus', {
    nama: `Generus ${nama} ${suffix}`,
    tanggal_lahir: '2015-05-10',
    kelas_sekolah: 'Kelas 4',
    tingkat: 'sd',
    jenis_kelamin: 'perempuan',
    ortu_nama: 'Orang Tua Tes',
    ortu_hubungan: 'Ibu',
    ortu_hp: '081234567890',
  }, kelompokACookie);

  if (Number.isInteger(created.data.generus?.id)) {
    generusIds.add(created.data.generus.id);
  }

  assert.equal(created.response.status, 201);
  assert.equal(created.data.generus.status, 'pending');
  return created.data.generus;
}

async function setujuiGenerus(id) {
  const approved = await api(
    'POST',
    `/api/generus/${id}/approve`,
    {},
    adminCookie
  );

  assert.equal(approved.response.status, 200);
  assert.equal(approved.data.generus.status, 'approved');
  return approved.data.generus;
}

async function uploadFoto(id, body, contentType, cookie) {
  const headers = { 'Content-Type': contentType };
  if (cookie) headers.Cookie = cookie;

  const response = await fetch(`${BASE}/api/generus/${id}/foto`, {
    method: 'POST',
    headers,
    body,
    redirect: 'manual',
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    // Status respons tetap diperiksa bila body bukan JSON.
  }

  if (
    typeof data?.foto_url === 'string' &&
    /^[a-f0-9]{32}\.(?:jpg|png)$/.test(data.foto_url)
  ) {
    uploadedFiles.add(data.foto_url);
  }

  return { response, data };
}

async function getFoto(id, cookie) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;

  const response = await fetch(`${BASE}/api/generus/${id}/foto`, {
    method: 'GET',
    headers,
    redirect: 'manual',
  });

  const body = Buffer.from(await response.arrayBuffer());
  return { response, body };
}

async function main() {
  try {
    const adminReady = await check('1. Admin login', async () => {
      assert.ok(ADMIN_PASSWORD, 'ADMIN_PASSWORD wajib diisi.');

      const admin = await queryDb(
        'SELECT id, must_change_password FROM users WHERE email = $1 AND role = $2',
        [ADMIN_EMAIL, 'admin']
      );
      assert.equal(admin.rowCount, 1);
      adminState = admin.rows[0];

      if (adminState.must_change_password) {
        await queryDb(
          'UPDATE users SET must_change_password = false WHERE id = $1',
          [adminState.id]
        );
      }

      adminCookie = (await login(ADMIN_EMAIL, ADMIN_PASSWORD)).cookie;
    });
    if (!adminReady) return;

    const fixturesReady = await check(
      '2. Kelompok A dan B, akun Desa, serta generus disetujui tersedia',
      async () => {
        await setupKelompok();
        const pending = await buatGenerus('S14E A');
        generusA = await setujuiGenerus(pending.id);
        kodeManual = generusA.kode_manual;

        assert.equal(generusA.id, pending.id);
        assert.equal(typeof kodeManual, 'string');
        assert.ok(kodeManual.length > 0);
      }
    );
    if (!fixturesReady) return;

    await check('3. Kelompok A mengunggah dan membaca PNG dengan byte yang sama', async () => {
      const uploaded = await uploadFoto(
        generusA.id,
        PNG,
        'image/png',
        kelompokACookie
      );

      assert.equal(uploaded.response.status, 200);
      assert.match(uploaded.data.foto_url, /^[a-f0-9]{32}\.png$/);
      fotoPng = uploaded.data.foto_url;

      const downloaded = await getFoto(generusA.id, kelompokACookie);
      assert.equal(downloaded.response.status, 200);
      assert.equal(downloaded.response.headers.get('content-type'), 'image/png');
      assert.equal(downloaded.response.headers.get('content-length'), String(PNG.length));
      assert.equal(downloaded.response.headers.get('cache-control'), 'no-store');
      assert.equal(downloaded.response.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(downloaded.body, PNG);
    });

    await check('4. Daftar generus Admin memuat daerah_nama dan foto_url', async () => {
      const listed = await api(
        'GET',
        '/api/generus?status=approved',
        undefined,
        adminCookie
      );

      assert.equal(listed.response.status, 200);
      assert.ok(Array.isArray(listed.data.generus));
      const item = listed.data.generus.find((row) => row.id === generusA.id);
      assert.ok(item);
      assert.equal(typeof item.daerah_nama, 'string');
      assert.ok(item.daerah_nama.trim().length > 0);
      assert.equal(item.foto_url, fotoPng);
      assert.match(item.foto_url, /^[a-f0-9]{32}\.png$/);
    });

    await check('5. Unggah JPEG mengganti nama file dan foto yang dilayani', async () => {
      const uploaded = await uploadFoto(
        generusA.id,
        JPEG,
        'image/jpeg',
        kelompokACookie
      );

      assert.equal(uploaded.response.status, 200);
      assert.match(uploaded.data.foto_url, /^[a-f0-9]{32}\.jpg$/);
      assert.notEqual(uploaded.data.foto_url, fotoPng);
      fotoJpeg = uploaded.data.foto_url;

      const downloaded = await getFoto(generusA.id, kelompokACookie);
      assert.equal(downloaded.response.status, 200);
      assert.equal(downloaded.response.headers.get('content-type'), 'image/jpeg');
      assert.equal(downloaded.response.headers.get('content-length'), String(JPEG.length));
      assert.deepEqual(downloaded.body, JPEG);
    });

    await check('6. Unggah Kelompok B dan Desa ditolak; akses baca mengikuti wilayah', async () => {
      const otherUpload = await uploadFoto(
        generusA.id,
        PNG,
        'image/png',
        kelompokBCookie
      );
      assert.equal(otherUpload.response.status, 403);

      const desaUpload = await uploadFoto(
        generusA.id,
        PNG,
        'image/png',
        desaCookie
      );
      assert.equal(desaUpload.response.status, 403);

      const otherRead = await getFoto(generusA.id, kelompokBCookie);
      assert.equal(otherRead.response.status, 404);

      const desaRead = await getFoto(generusA.id, desaCookie);
      assert.equal(desaRead.response.status, 200);
      assert.deepEqual(desaRead.body, JPEG);

      const adminRead = await getFoto(generusA.id, adminCookie);
      assert.equal(adminRead.response.status, 200);
      assert.deepEqual(adminRead.body, JPEG);
    });

    await check('7. Teks, magic bytes tidak cocok, dan foto melebihi 2 MB ditolak', async () => {
      const textUpload = await uploadFoto(
        generusA.id,
        Buffer.from('bukan gambar'),
        'text/plain',
        kelompokACookie
      );
      assert.ok([400, 415].includes(textUpload.response.status));

      const mismatched = await uploadFoto(
        generusA.id,
        PNG,
        'image/jpeg',
        kelompokACookie
      );
      assert.equal(mismatched.response.status, 400);

      const oversized = Buffer.alloc(MAX_FOTO_BYTES + 1);
      JPEG.copy(oversized);
      const tooLarge = await uploadFoto(
        generusA.id,
        oversized,
        'image/jpeg',
        kelompokACookie
      );
      assert.equal(tooLarge.response.status, 413);
    });

    await check('8. Unggah dan baca foto tanpa login ditolak', async () => {
      const uploaded = await uploadFoto(
        generusA.id,
        PNG,
        'image/png'
      );
      assert.equal(uploaded.response.status, 401);

      const downloaded = await getFoto(generusA.id);
      assert.equal(downloaded.response.status, 401);
    });

    await check('9. Generus disetujui tanpa foto menghasilkan 404', async () => {
      const pending = await buatGenerus('S14E tanpa foto');
      generusTanpaFoto = await setujuiGenerus(pending.id);

      const downloaded = await getFoto(
        generusTanpaFoto.id,
        kelompokACookie
      );
      assert.equal(downloaded.response.status, 404);
    });

    await check('10. Halaman cetak QR memuat placeholder foto dan nama daerah', async () => {
      const response = await fetch(`${BASE}/cetak-qr.html`, {
        headers: { Cookie: kelompokACookie },
        redirect: 'manual',
      });

      assert.equal(response.status, 200);
      const html = await response.text();
      assert.ok(html.includes('tanpa-foto'));
      assert.ok(html.includes('daerah_nama'));
    });
  } finally {
    for (const id of generusIds) {
      await check(`Membersihkan generus uji ${id}`, async () => {
        await queryDb('DELETE FROM generus WHERE id = $1', [id]);
      });
    }

    for (const namaFile of uploadedFiles) {
      try {
        fs.unlinkSync(path.join(UPLOADS_DIR, namaFile));
      } catch {
        // Foto sebelumnya mungkin sudah dihapus saat penggantian.
      }
    }

    if (adminState) {
      await check('Memulihkan status sandi Admin', async () => {
        await queryDb(
          'UPDATE users SET must_change_password = $1 WHERE id = $2',
          [adminState.must_change_password, adminState.id]
        );
      });
    }

    if (failures > 0) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`GAGAL: ${error.message}`);
  process.exitCode = 1;
});
