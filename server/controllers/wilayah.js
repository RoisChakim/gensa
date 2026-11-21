'use strict';

const db = require('../db');
const { fail, sendJson } = require('../middleware/errors');
const { requiredString, positiveId } = require('../middleware/validate');
const { readJson } = require('../middleware/http');
const { requireRole } = require('../middleware/auth');
const { pertemuanScopeWhere } = require('../models/scope');
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SMTP_TERKONFIGURASI, JENJANG } = require('../config');

async function listUsers(res, auth) {
  requireRole(auth.user, 'admin');

  const result = await db.query(
    `SELECT u.id, u.email, u.role, u.desa_id, u.kelompok_id,
            u.must_change_password, u.active, u.created_at,
            d.nama AS desa_nama, k.nama AS kelompok_nama
     FROM users u
     LEFT JOIN desa d ON d.id = u.desa_id
     LEFT JOIN kelompok k ON k.id = u.kelompok_id
     ORDER BY u.created_at DESC, u.id DESC`
  );

  sendJson(res, 200, { users: result.rows });
}

// Daftar wilayah untuk form buat akun (M3): semua desa + kelompok.

async function listWilayah(res, auth) {
  // Nama wilayah sesuai lingkup peran pemanggil: admin/daerah melihat
  // semua, desa hanya desanya + kelompok di dalamnya, kelompok hanya
  // kelompoknya sendiri (plus nama desanya untuk label).
  const role = auth.user.role;

  const desa = await db.query(
    `SELECT id, daerah_id, nama FROM desa
     WHERE ($1::text IN ('admin', 'daerah'))
        OR ($1::text = 'desa' AND id = $2)
        OR ($1::text = 'kelompok' AND id = (
          SELECT desa_id FROM kelompok WHERE id = $3))
     ORDER BY nama`,
    [role, auth.user.desa_id, auth.user.kelompok_id]
  );
  const kelompok = await db.query(
    `SELECT id, desa_id, nama FROM kelompok
     WHERE ($1::text IN ('admin', 'daerah'))
        OR ($1::text = 'desa' AND desa_id = $2)
        OR ($1::text = 'kelompok' AND id = $3)
     ORDER BY nama`,
    [role, auth.user.desa_id, auth.user.kelompok_id]
  );

  sendJson(res, 200, { desa: desa.rows, kelompok: kelompok.rows });
}

// Kelola Kelas (M7, Sesi 13A): daftar, tambah, ubah, hapus kelas.

async function listKelas(res, auth, url) {
  if (!auth || !auth.user) fail(401, 'Silakan masuk terlebih dahulu.');

  const params = url.searchParams;

  for (const key of ['jenjang', 'aktif']) {
    if (params.getAll(key).length > 1) {
      fail(400, 'Parameter tidak boleh berulang.');
    }
  }

  const jenjang = params.has('jenjang') ? params.get('jenjang') : null;
  if (jenjang !== null && !JENJANG.has(jenjang)) {
    fail(400, 'Jenjang tidak valid.');
  }

  let aktif = null;
  if (params.has('aktif')) {
    const value = params.get('aktif');
    if (value !== '0' && value !== '1') {
      fail(400, 'Aktif harus bernilai 0 atau 1.');
    }
    aktif = value === '1';
  }

  const result = await db.query(
    `SELECT *
       FROM kelas
      WHERE ($1::jenjang_generus IS NULL OR jenjang = $1)
        AND ($2::boolean IS NULL OR aktif = $2)
      ORDER BY jenjang, urutan, nama, id`,
    [jenjang, aktif]
  );

  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 200, { kelas: result.rows });
}

async function createKelas(req, res, auth) {
  requireRole(auth.user, 'admin');

  const body = await readJson(req);

  if (Object.keys(body).some(key => !['jenjang', 'nama', 'urutan'].includes(key))) {
    fail(400, 'Ada field yang tidak diizinkan.');
  }

  if (!JENJANG.has(body.jenjang)) fail(400, 'Jenjang tidak valid.');
  const nama = requiredString(body.nama, 'Nama kelas', 100);
  const urutan = Object.hasOwn(body, 'urutan') ? body.urutan : 0;

  if (!Number.isInteger(urutan) || urutan < 0 || urutan > 9999) {
    fail(400, 'Urutan harus berupa bilangan bulat 0–9999.');
  }

  try {
    const result = await db.query(
      `INSERT INTO kelas (jenjang, nama, urutan)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [body.jenjang, nama, urutan]
    );

    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, 201, { kelas: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      fail(409, 'Kelas sudah ada pada jenjang ini.');
    }
    throw error;
  }
}

async function updateKelas(req, res, auth, id) {
  requireRole(auth.user, 'admin');
  id = positiveId(id, 'ID kelas');

  const body = await readJson(req);

  const keys = Object.keys(body);
  if (!keys.length || keys.some(key => !['nama', 'urutan', 'aktif'].includes(key))) {
    fail(400, 'Isi minimal satu field: nama, urutan, atau aktif.');
  }

  const hasNama = Object.hasOwn(body, 'nama');
  const hasUrutan = Object.hasOwn(body, 'urutan');
  const hasAktif = Object.hasOwn(body, 'aktif');

  const nama = hasNama ? requiredString(body.nama, 'Nama kelas', 100) : null;
  const urutan = hasUrutan ? body.urutan : null;
  const aktif = hasAktif ? body.aktif : null;

  if (hasUrutan && (!Number.isInteger(urutan) || urutan < 0 || urutan > 9999)) {
    fail(400, 'Urutan harus berupa bilangan bulat 0–9999.');
  }

  if (hasAktif && typeof aktif !== 'boolean') {
    fail(400, 'Aktif harus berupa boolean.');
  }

  try {
    const result = await db.query(
      `UPDATE kelas
          SET nama = CASE WHEN $2::boolean THEN $3::text ELSE nama END,
              urutan = CASE WHEN $4::boolean THEN $5::integer ELSE urutan END,
              aktif = CASE WHEN $6::boolean THEN $7::boolean ELSE aktif END,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [id, hasNama, nama, hasUrutan, urutan, hasAktif, aktif]
    );

    if (!result.rows.length) fail(404, 'Kelas tidak ditemukan.');

    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, 200, { kelas: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      fail(409, 'Kelas sudah ada pada jenjang ini.');
    }
    throw error;
  }
}

async function deleteKelas(res, auth, id) {
  requireRole(auth.user, 'admin');
  id = positiveId(id, 'ID kelas');

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const kelas = await client.query(
      'SELECT id FROM kelas WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (!kelas.rows.length) fail(404, 'Kelas tidak ditemukan.');

    const usage = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM generus WHERE kelas_id = $1
       ) OR EXISTS (
         SELECT 1 FROM tugas WHERE kelas_id = $1
       ) AS dipakai`,
      [id]
    );

    if (usage.rows[0].dipakai) fail(409, 'Kelas masih dipakai.');

    await client.query('DELETE FROM kelas WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23503') fail(409, 'Kelas masih dipakai.');
    throw error;
  } finally {
    client.release();
  }

  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 200, { ok: true });
}

async function listRiwayatKelas(res, auth, id) {
  id = positiveId(id, 'ID generus');

  const role = auth.user.role;
  if (!['admin', 'daerah', 'desa', 'kelompok'].includes(role)) {
    fail(403, 'Anda tidak memiliki akses.');
  }

  // LEFT JOIN membedakan generus tanpa riwayat dari generus di luar lingkup.
  const result = await db.query(
    `SELECT r.id, r.generus_id, r.kelas_lama, r.kelas_baru,
            r.diubah_oleh, r.created_at,
            u.email AS diubah_oleh_nama
       FROM generus g
       JOIN kelompok k ON k.id = g.kelompok_id
       JOIN desa d ON d.id = k.desa_id
       LEFT JOIN riwayat_kelas r ON r.generus_id = g.id
       LEFT JOIN users u ON u.id = r.diubah_oleh
      WHERE g.id = $1
        AND (
          $2::text IN ('admin', 'daerah')
          OR ($2::text = 'desa' AND d.id = $3::integer)
          OR ($2::text = 'kelompok' AND g.kelompok_id = $4::integer)
        )
      ORDER BY r.created_at DESC, r.id DESC`,
    [id, role, auth.user.desa_id ?? null, auth.user.kelompok_id ?? null]
  );

  if (!result.rows.length) fail(404, 'Generus tidak ditemukan.');

  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 200, {
    riwayat: result.rows.filter(row => row.id !== null)
  });
}

// Ringkasan dashboard: hitungan sesuai lingkup peran pemanggil.

async function ringkasan(res, auth) {
  const generus = await db.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE g.status = 'pending')::int AS pending,
       COUNT(*) FILTER (WHERE g.status = 'delete_pending')::int AS delete_pending,
       COUNT(*) FILTER (WHERE g.status = 'approved')::int AS approved
     FROM generus g
     JOIN kelompok k ON k.id = g.kelompok_id
     WHERE ($1::text IN ('admin', 'daerah'))
        OR ($1::text = 'desa' AND k.desa_id = $2)
        OR ($1::text = 'kelompok' AND g.kelompok_id = $3)`,
    [auth.user.role, auth.user.desa_id, auth.user.kelompok_id]
  );

  const scope = pertemuanScopeWhere(auth);

  const pertemuan = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM pertemuan p
     WHERE p.selesai_pada IS NULL AND p.tanggal >= CURRENT_DATE
       AND ${scope.sql}`,
    scope.values
  );

  const izin = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM izin z
     JOIN pertemuan p ON p.id = z.pertemuan_id
     WHERE z.status = 'menunggu' AND ${scope.sql}`,
    scope.values
  );

  const notifikasi = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM notifikasi
     WHERE user_id = $1 AND dibaca = false`,
    [auth.user.id]
  );

  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 200, {
    generus: generus.rows[0],
    pertemuan_mendatang: pertemuan.rows[0].total,
    izin_menunggu: izin.rows[0].total,
    notifikasi_belum_dibaca: notifikasi.rows[0].total,
  });
}

function statusSistem(res, auth) {
  requireRole(auth.user, 'admin');
  res.setHeader('Cache-Control', 'no-store');

  sendJson(res, 200, {
    smtp_terkonfigurasi: SMTP_TERKONFIGURASI,
    google_terkonfigurasi: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
  });
}

module.exports = {
  listUsers, listWilayah, listKelas, createKelas, updateKelas, deleteKelas,
  listRiwayatKelas, ringkasan, statusSistem,
};
