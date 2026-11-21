'use strict';

const db = require('../db');
const { fail, sendJson } = require('../middleware/errors');
const { requiredString, materiPositiveId, parseTugasFilters } = require('../middleware/validate');
const { generusScopeWhere, tugasScopeWhere } = require('../models/scope');
const { readMateriBody, getMateriTugas, ambilPenilaian } = require('../models/penilaian');

async function createTugas(req, res, auth) {
  const role = auth.user.role;
  if (role !== 'admin' && role !== 'kelompok') {
    fail(403, 'Anda tidak memiliki akses.');
  }

  const body = await readMateriBody(req);

  const judul = requiredString(body.judul, 'Judul tugas', 255);
  if (!['doa_surat', 'makna_pegon', 'praktik_solat'].includes(body.kategori)) {
    fail(400, 'Kategori tugas tidak valid.');
  }

  const kelompokId = role === 'kelompok'
    ? materiPositiveId(auth.user.kelompok_id, 'ID kelompok')
    : body.kelompok_id == null || body.kelompok_id === ''
      ? null
      : materiPositiveId(body.kelompok_id, 'ID kelompok');

  const kelasId = Object.hasOwn(body, 'kelas_id')
    ? materiPositiveId(body.kelas_id, 'ID kelas')
    : null;

  const hasTahun = Object.hasOwn(body, 'tahun_ajaran');
  const tahunAjaran = hasTahun ? body.tahun_ajaran : null;

  if (
    hasTahun &&
    (!Number.isInteger(tahunAjaran) || tahunAjaran < 2000 || tahunAjaran > 2100)
  ) {
    fail(400, 'Tahun ajaran harus berupa bilangan bulat 2000–2100.');
  }

  let tugas;
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    if (kelompokId !== null) {
      const kelompok = await client.query(
        'SELECT id FROM kelompok WHERE id = $1 FOR KEY SHARE',
        [kelompokId]
      );
      if (!kelompok.rows.length) fail(400, 'Kelompok tidak ditemukan.');
    }

    if (kelasId !== null) {
      const kelas = await client.query(
        'SELECT id FROM kelas WHERE id = $1 FOR KEY SHARE',
        [kelasId]
      );
      if (!kelas.rows.length) fail(400, 'Kelas tidak ditemukan.');
    }

    const result = await client.query(
      `INSERT INTO tugas
         (judul, kategori, kelompok_id, dibuat_oleh, kelas_id, tahun_ajaran)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [judul, body.kategori, kelompokId, auth.user.id, kelasId, tahunAjaran]
    );

    tugas = result.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 201, { tugas });
}


// listTugas — diubah Sesi 13A: baca filter kelas_id/tahun_ajaran/kategori dari query.

// Filter tugas dari query (?kelas_id, ?tahun_ajaran, ?kategori) — dipakai
// listTugas dan listPenilaian (M9, Sesi 13A).

async function listTugas(req, res, auth) {
  const filters = parseTugasFilters(req);
  const tugas = await getMateriTugas(db, auth, filters);

  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 200, { tugas });
}

async function deleteTugas(req, res, auth, rawId) {
  if (auth.user.role !== 'kelompok' && auth.user.role !== 'admin') {
    fail(403, 'Hanya kelompok dan Admin yang bisa menghapus tugas.');
  }

  const id = materiPositiveId(rawId, 'Tugas');
  const scope = tugasScopeWhere(auth);
  const values = [...scope.values, id];
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `SELECT t.*
       FROM tugas t
       WHERE (${scope.sql}) AND t.id = $${values.length}
       FOR UPDATE OF t`,
      values
    );

    const tugas = result.rows[0];

    if (!tugas) {
      fail(404, 'Tugas tidak ditemukan.');
    }

    if (
      auth.user.role !== 'admin' &&
      (
        tugas.kelompok_id === null ||
        Number(tugas.kelompok_id) !== Number(auth.user.kelompok_id)
      )
    ) {
      fail(403, 'Anda tidak boleh menghapus tugas ini.');
    }

    const existing = await client.query(
      'SELECT id FROM penilaian WHERE tugas_id = $1 LIMIT 1',
      [id]
    );

    if (existing.rows.length) {
      fail(409, 'Tugas sudah memiliki penilaian.');
    }

    await client.query('DELETE FROM tugas WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');

    if (error.code === '23503') {
      fail(409, 'Tugas sudah memiliki penilaian.');
    }

    throw error;
  } finally {
    client.release();
  }

  sendJson(res, 200, { ok: true });
}

async function savePenilaian(req, res, auth) {
  if (auth.user.role !== 'kelompok' && auth.user.role !== 'admin') {
    fail(403, 'Hanya pengurus kelompok dan Admin yang bisa memberi nilai.');
  }

  const body = await readMateriBody(req);
  const generusId = materiPositiveId(body.generus_id, 'Generus');
  const tugasId = materiPositiveId(body.tugas_id, 'Tugas');

  if (body.nilai == null || body.nilai === '') {
    fail(400, 'Nilai wajib diisi.');
  }

  const generusScope = generusScopeWhere(auth);
  const tugasScope = tugasScopeWhere(auth);
  const generusValues = [...generusScope.values, generusId];
  const tugasValues = [...tugasScope.values, tugasId];
  const client = await db.getClient();
  let penilaian;

  try {
    await client.query('BEGIN');

    const generusResult = await client.query(
      `SELECT g.id
       FROM generus g
       JOIN kelompok k ON k.id = g.kelompok_id
       WHERE (${generusScope.sql})
         AND g.id = $${generusValues.length}
         AND g.status = 'approved'
       FOR SHARE OF g, k`,
      generusValues
    );

    if (!generusResult.rows.length) {
      fail(404, 'Generus tidak ditemukan.');
    }

    // Kunci bersama mencegah tugas dihapus selama penilaian disimpan.
    const tugasResult = await client.query(
      `SELECT t.*
       FROM tugas t
       WHERE (${tugasScope.sql}) AND t.id = $${tugasValues.length}
       FOR SHARE OF t`,
      tugasValues
    );

    const tugas = tugasResult.rows[0];

    if (!tugas) {
      fail(404, 'Tugas tidak ditemukan.');
    }

    const allowedValues =
      tugas.kategori === 'doa_surat'
        ? ['hafal', 'belum']
        : ['bisa', 'tidak'];

    if (!allowedValues.includes(body.nilai)) {
      fail(400, 'Nilai tidak sesuai dengan kategori tugas.');
    }

    const existingResult = await client.query(
      `SELECT *
       FROM penilaian
       WHERE generus_id = $1 AND tugas_id = $2
       FOR UPDATE`,
      [generusId, tugasId]
    );

    const existing = existingResult.rows[0];

    if (!existing) {
      const result = await client.query(
        `INSERT INTO penilaian (
           generus_id, tugas_id, nilai, diubah_count, dicatat_oleh
         )
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [generusId, tugasId, body.nilai, 0, auth.user.id]
      );

      penilaian = result.rows[0];
    } else {
      if (existing.diubah_count >= 2 && auth.user.role !== 'admin') {
        fail(
          403,
          'Nilai sudah diubah 2 kali. Minta izin Admin untuk mengubah lagi.'
        );
      }

      const diubahCount =
        auth.user.role === 'admin'
          ? existing.diubah_count
          : existing.diubah_count + 1;
      const diubahOlehAdmin = auth.user.role === 'admin';

      const result = await client.query(
        `UPDATE penilaian
         SET nilai = $1,
             diubah_count = $2,
             diubah_oleh_admin = $3,
             dicatat_oleh = $4,
             updated_at = now()
         WHERE id = $5
         RETURNING *`,
        [
          body.nilai,
          diubahCount,
          diubahOlehAdmin,
          auth.user.id,
          existing.id,
        ]
      );

      penilaian = result.rows[0];
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');

    if (error.code === '23505') {
      fail(409, 'Penilaian sudah ada. Muat ulang halaman.');
    }

    throw error;
  } finally {
    client.release();
  }

  sendJson(res, 200, { penilaian });
}

async function listPenilaian(req, res, auth) {
  sendJson(res, 200, await ambilPenilaian(req, auth));
}

module.exports = {
  createTugas, listTugas, deleteTugas, savePenilaian, listPenilaian,
};
