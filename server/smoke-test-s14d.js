'use strict';

// Smoke test Sesi 14D — Pengaturan pengingat jadwal (Q7).
// Semua pertemuan uji berada di tingkat kelompok, bertanggal hari ini,
// tanpa absensi dan tidak diselesaikan. Pertemuan dihapus melalui API
// pada bagian finally, termasuk bila pemeriksaan sebelumnya gagal.
// Jalankan dari direktori server setelah migrasi dan server dinyalakan.

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
let adminMustChangePassword;
let kelompokCookie;
let kelompokId;
let pertemuanId;
const pertemuanUji = new Set();

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

async function login(email, password) {
  const result = await api('POST', '/api/login', { email, password });
  assert.equal(result.response.status, 200);
  assert.ok(result.cookie);
  return result.cookie;
}

async function createAndLoginKelompok() {
  const email = `kelompok-s14d-${suffix}@tes.gensa.local`;
  const created = await api('POST', '/api/users', {
    email,
    role: 'kelompok',
    kelompok_id: kelompokId,
  }, adminCookie);

  assert.equal(created.response.status, 201);
  assert.equal(typeof created.data.initial_password, 'string');

  const cookie = await login(email, created.data.initial_password);
  const changed = await api('POST', '/api/change-password', {
    old_password: created.data.initial_password,
    new_password: `Tes${crypto.randomBytes(16).toString('hex')}`,
  }, cookie);

  assert.equal(changed.response.status, 200);
  return cookie;
}

async function buatPertemuan(tambahan = {}) {
  const result = await api('POST', '/api/pertemuan', {
    tingkat: 'kelompok',
    kelompok_id: kelompokId,
    jenjang: ['caberawit'],
    tanggal: new Date().toISOString().slice(0, 10),
    ...tambahan,
  }, kelompokCookie);

  if (result.data.pertemuan && result.data.pertemuan.id) {
    pertemuanUji.add(result.data.pertemuan.id);
  }

  return result;
}

async function main() {
  try {
    const adminSiap = await check('Admin login', async () => {
      assert.ok(ADMIN_PASSWORD, 'ADMIN_PASSWORD wajib diisi.');

      const admin = await queryDb(
        'SELECT must_change_password FROM users WHERE email = $1',
        [ADMIN_EMAIL]
      );
      assert.equal(admin.rowCount, 1, 'Akun Admin harus tersedia.');
      adminMustChangePassword = admin.rows[0].must_change_password;

      await queryDb(
        'UPDATE users SET must_change_password = false WHERE email = $1',
        [ADMIN_EMAIL]
      );

      adminCookie = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    });

    if (!adminSiap) return;

    const kelompokSiap = await check(
      'Menyiapkan akun kelompok dan satu generus disetujui',
      async () => {
        const wilayah = await api(
          'GET',
          '/api/wilayah',
          undefined,
          adminCookie
        );
        assert.equal(wilayah.response.status, 200);
        assert.ok(Array.isArray(wilayah.data.kelompok));
        assert.ok(wilayah.data.kelompok.length > 0, 'Kelompok harus tersedia.');

        kelompokId = wilayah.data.kelompok[0].id;
        assert.ok(kelompokId);
        kelompokCookie = await createAndLoginKelompok();

        const created = await api('POST', '/api/generus', {
          nama: `Generus S14D ${suffix}`,
          tanggal_lahir: '2015-05-10',
          kelas_sekolah: 'Kelas 4',
          tingkat: 'sd',
          jenis_kelamin: 'perempuan',
          ortu_nama: 'Orang Tua Tes',
          ortu_hubungan: 'Ibu',
          ortu_hp: '081234567890',
        }, kelompokCookie);

        assert.equal(created.response.status, 201);
        assert.equal(created.data.generus.status, 'pending');

        const approved = await api(
          'POST',
          `/api/generus/${created.data.generus.id}/approve`,
          {},
          adminCookie
        );
        assert.equal(approved.response.status, 200);
        assert.equal(approved.data.generus.status, 'approved');
      }
    );

    if (!kelompokSiap) return;

    await check('Buat pengingat 24 jam dan tampilkan pada daftar', async () => {
      const created = await buatPertemuan({ pengingat_jam: 24 });
      assert.equal(created.response.status, 201);

      pertemuanId = created.data.pertemuan.id;
      assert.ok(pertemuanId);
      assert.equal(created.data.pertemuan.pengingat_jam, 24);

      const daftar = await api(
        'GET',
        '/api/pertemuan',
        undefined,
        kelompokCookie
      );
      assert.equal(daftar.response.status, 200);
      assert.ok(Array.isArray(daftar.data.pertemuan));

      const item = daftar.data.pertemuan.find(
        (row) => row.id === pertemuanId
      );
      assert.ok(item, 'Pertemuan uji harus muncul pada daftar.');
      assert.equal(item.pengingat_jam, 24);
    });

    await check('Buat tanpa pengingat menghasilkan null', async () => {
      const created = await buatPertemuan();
      assert.equal(created.response.status, 201);
      assert.equal(created.data.pertemuan.pengingat_jam, null);
    });

    await check('Tolak pengingat 0, 721, dan abc saat membuat', async () => {
      for (const value of [0, 721, 'abc']) {
        const created = await buatPertemuan({ pengingat_jam: value });
        assert.equal(
          created.response.status,
          400,
          `Pengingat ${JSON.stringify(value)} harus ditolak.`
        );
      }
    });

    await check('Ubah pengingat menjadi 2 jam lalu kosongkan', async () => {
      assert.ok(pertemuanId, 'Pertemuan uji harus tersedia.');

      const changed = await api(
        'PATCH',
        `/api/pertemuan/${pertemuanId}`,
        { pengingat_jam: 2 },
        kelompokCookie
      );
      assert.equal(changed.response.status, 200);
      assert.equal(changed.data.pertemuan.pengingat_jam, 2);

      const cleared = await api(
        'PATCH',
        `/api/pertemuan/${pertemuanId}`,
        { pengingat_jam: null },
        kelompokCookie
      );
      assert.equal(cleared.response.status, 200);
      assert.equal(cleared.data.pertemuan.pengingat_jam, null);
    });

    await check('Tolak pengingat 999 saat mengubah', async () => {
      assert.ok(pertemuanId, 'Pertemuan uji harus tersedia.');

      const changed = await api(
        'PATCH',
        `/api/pertemuan/${pertemuanId}`,
        { pengingat_jam: 999 },
        kelompokCookie
      );
      assert.equal(changed.response.status, 400);
    });

    await check('Halaman jadwal memuat input dan teks pengingat', async () => {
      const page = await api(
        'GET',
        '/jadwal.html',
        undefined,
        kelompokCookie
      );
      assert.equal(page.response.status, 200);
      assert.ok(page.text.includes('pengingat-baru'));
      assert.ok(page.text.includes('Ingatkan H-'));
    });
  } finally {
    await check('Hapus semua pertemuan uji melalui API', async () => {
      const errors = [];

      for (const id of pertemuanUji) {
        try {
          const deleted = await api(
            'DELETE',
            `/api/pertemuan/${id}`,
            undefined,
            kelompokCookie
          );
          assert.equal(
            deleted.response.status,
            200,
            `Penghapusan pertemuan ${id} harus berhasil.`
          );
          pertemuanUji.delete(id);
        } catch (error) {
          errors.push(error.message);
        }
      }

      assert.equal(errors.length, 0, errors.join('\n'));
      assert.equal(pertemuanUji.size, 0);
    });

    if (adminMustChangePassword !== undefined) {
      await check('Pulihkan status akun Admin', async () => {
        await queryDb(
          'UPDATE users SET must_change_password = $1 WHERE email = $2',
          [adminMustChangePassword, ADMIN_EMAIL]
        );
      });
    }

    if (failures > 0) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`FAIL: Smoke test S14D — ${error.message}`);
  process.exitCode = 1;
});
