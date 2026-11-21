'use strict';

const db = require('../db');
const { fail } = require('../middleware/errors');

function normalisasiPertemuan(pertemuan) {
  if (!pertemuan) return pertemuan;
  if (typeof pertemuan.jenjang_target === 'string') {
    const isi = pertemuan.jenjang_target.slice(1, -1);
    pertemuan.jenjang_target = isi ? isi.split(',') : [];
  }
  return pertemuan;
}

function pertemuanScopeWhere(auth) {
  return {
    sql: `(
      $1::text IN ('admin', 'daerah')
      OR (
        $1::text = 'desa'
        AND (
          p.desa_id = $2::integer
          OR EXISTS (
            SELECT 1 FROM kelompok k
            WHERE k.id = p.kelompok_id AND k.desa_id = $2::integer
          )
        )
      )
      OR (
        $1::text = 'kelompok'
        AND (
          p.kelompok_id = $3::integer
          OR p.desa_id = (
            SELECT k.desa_id FROM kelompok k WHERE k.id = $3::integer
          )
          OR p.tingkat = 'daerah'
        )
      )
    )`,
    values: [auth.user.role, auth.user.desa_id, auth.user.kelompok_id],
  };
}

function canManagePertemuan(auth, pertemuan) {
  const user = auth.user;

  if (user.role === 'admin') return;

  if (
    user.role === pertemuan.tingkat &&
    (
      (user.role === 'kelompok' && user.kelompok_id === pertemuan.kelompok_id) ||
      (user.role === 'desa' && user.desa_id === pertemuan.desa_id) ||
      user.role === 'daerah'
    )
  ) {
    return;
  }

  fail(403, 'Anda tidak memiliki akses untuk mengelola pertemuan ini.');
}

async function generusInScope(pertemuan, generusId, client = db) {
  const result = await client.query(
    `SELECT g.id, g.kelompok_id, g.nama, g.kelas_sekolah, g.jenjang, g.status
     FROM generus g
     JOIN kelompok k ON k.id = g.kelompok_id
     WHERE g.id = $1
       AND g.status = 'approved'
       AND g.jenjang = ANY($2::jenjang_generus[])
       AND (
         ($3::text = 'kelompok' AND g.kelompok_id = $4::integer)
         OR ($3::text = 'desa' AND k.desa_id = $5::integer)
         OR $3::text = 'daerah'
       )
     FOR SHARE OF g, k`,
    [
      generusId, pertemuan.jenjang_target, pertemuan.tingkat,
      pertemuan.kelompok_id, pertemuan.desa_id,
    ]
  );

  return result.rows[0] || null;
}

function generusScopeWhere(auth) {
  return {
    sql: `(
      $1::text IN ('admin', 'daerah')
      OR ($1::text = 'desa' AND k.desa_id = $2::integer)
      OR ($1::text = 'kelompok' AND g.kelompok_id = $3::integer)
    )`,
    values: [auth.user.role, auth.user.desa_id, auth.user.kelompok_id],
  };
}

function tugasScopeWhere(auth) {
  if (auth.user.role === 'kelompok') {
    return {
      sql: '(t.kelompok_id = $1 OR t.kelompok_id IS NULL)',
      values: [auth.user.kelompok_id],
    };
  }

  if (auth.user.role === 'desa') {
    return {
      sql: `(
        t.kelompok_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM kelompok kt
          WHERE kt.id = t.kelompok_id
            AND kt.desa_id = $1
        )
      )`,
      values: [auth.user.desa_id],
    };
  }

  if (auth.user.role === 'admin' || auth.user.role === 'daerah') {
    return { sql: 'TRUE', values: [] };
  }

  fail(403, 'Akses tidak diizinkan.');
}

module.exports = {
  normalisasiPertemuan, pertemuanScopeWhere, canManagePertemuan,
  generusInScope, generusScopeWhere, tugasScopeWhere,
};
