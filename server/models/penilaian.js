'use strict';

const db = require('../db');
const { fail } = require('../middleware/errors');
const { tugasScopeWhere, generusScopeWhere } = require('./scope');
const { parseTugasFilters, materiPositiveId } = require('../middleware/validate');
const { readJson } = require('../middleware/http');

async function readMateriBody(req) {
  const body = await readJson(req);

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail(400, 'Data tidak valid.');
  }

  return body;
}

// getMateriTugas — diubah Sesi 13A: filter kelas_id/tahun_ajaran/kategori + kelas_nama.

async function getMateriTugas(db, auth, filters = {}) {
  const role = auth.user.role;
  if (!['admin', 'daerah', 'desa', 'kelompok'].includes(role)) {
    fail(403, 'Anda tidak memiliki akses.');
  }

  // Bentuk return tugasScopeWhere tidak disertakan dalam konteks.
  // Predikat statis ini menerapkan lingkup yang sama tanpa interpolasi SQL.
  // t.* sudah mencakup t.kelas_id dan t.tahun_ajaran.
  const result = await db.query(
    `SELECT t.*, k.nama AS kelompok_nama, kl.nama AS kelas_nama
       FROM tugas t
       LEFT JOIN kelompok k ON k.id = t.kelompok_id
       LEFT JOIN kelas kl ON kl.id = t.kelas_id
      WHERE (
        $1::text IN ('admin', 'daerah')
        OR (
          $1::text = 'desa'
          AND (t.kelompok_id IS NULL OR k.desa_id = $2::integer)
        )
        OR (
          $1::text = 'kelompok'
          AND (t.kelompok_id IS NULL OR t.kelompok_id = $3::integer)
        )
      )
        AND ($4::integer IS NULL OR t.kelas_id = $4)
        AND ($5::integer IS NULL OR t.tahun_ajaran = $5)
        AND ($6::text IS NULL OR t.kategori::text = $6)
      ORDER BY t.kategori, t.judul, t.id`,
    [
      role,
      auth.user.desa_id ?? null,
      auth.user.kelompok_id ?? null,
      filters.kelas_id ?? null,
      filters.tahun_ajaran ?? null,
      filters.kategori ?? null
    ]
  );

  return result.rows;
}


// createTugas — diubah Sesi 13A: terima kelas_id + tahun_ajaran.

async function ambilPenilaian(req, auth) {
  const url = new URL(req.url, 'http://localhost');
  const rawKelompokId = url.searchParams.get('kelompok_id');
  let kelompokId = null;

  if (auth.user.role === 'kelompok') {
    kelompokId = materiPositiveId(auth.user.kelompok_id, 'Kelompok');
  } else if (rawKelompokId !== null) {
    kelompokId = materiPositiveId(rawKelompokId, 'Kelompok');
  }

  if (auth.user.role === 'desa' && kelompokId !== null) {
    const kelompok = await db.query(
      'SELECT id FROM kelompok WHERE id = $1 AND desa_id = $2',
      [kelompokId, auth.user.desa_id]
    );

    if (!kelompok.rows.length) {
      fail(403, 'Kelompok berada di luar wilayah desa Anda.');
    }
  }

  const scope = generusScopeWhere(auth);
  const values = [...scope.values];
  let where = `(${scope.sql})`;

  if (kelompokId !== null) {
    values.push(kelompokId);
    where += ` AND g.kelompok_id = $${values.length}`;
  }

  const [tugas, penilaianResult, hasilResult] = await Promise.all([
    getMateriTugas(db, auth, parseTugasFilters(req)),
    db.query(
      `SELECT
         p.id,
         p.generus_id,
         p.tugas_id,
         p.nilai,
         p.diubah_count,
         p.diubah_oleh_admin,
         p.dicatat_oleh,
         p.created_at,
         p.updated_at
       FROM penilaian p
       JOIN generus g ON g.id = p.generus_id
       JOIN kelompok k ON k.id = g.kelompok_id
       WHERE ${where}
       ORDER BY p.generus_id, p.tugas_id`,
      values
    ),
    db.query(
      `SELECT
         g.id AS generus_id,
         g.nama,
         g.kelas_sekolah,
         g.jenjang,
         k.nama AS kelompok,
         g.ortu_nama,
         g.ortu_hp,
         hitungan.hafal,
         hitungan.total_hafalan
       FROM generus g
       JOIN kelompok k ON k.id = g.kelompok_id
       CROSS JOIN LATERAL (
         SELECT
           (COUNT(*) FILTER (WHERE p.nilai = 'hafal'))::integer AS hafal,
           COUNT(*)::integer AS total_hafalan
         FROM tugas t
         LEFT JOIN penilaian p
           ON p.tugas_id = t.id AND p.generus_id = g.id
         WHERE t.kategori = 'doa_surat'
           AND (t.kelompok_id IS NULL OR t.kelompok_id = g.kelompok_id)
       ) hitungan
       WHERE ${where} AND g.status = 'approved'
       ORDER BY k.nama, g.jenjang, g.nama, g.id`,
      values
    ),
  ]);

  const hasil = hasilResult.rows.map((row) => ({
    ...row,
    persen:
      row.total_hafalan > 0
        ? Math.round((row.hafal / row.total_hafalan) * 1000) / 10
        : null,
  }));

  return {
    tugas,
    penilaian: penilaianResult.rows,
    hasil,
  };
}

module.exports = { readMateriBody, getMateriTugas, ambilPenilaian };
