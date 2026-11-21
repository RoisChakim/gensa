'use strict';

const db = require('../db');
const { fail } = require('../middleware/errors');
const { normalisasiPertemuan } = require('./scope');

async function pertemuanDariToken(token) {
  const hasilPertemuan = await db.query(
    'SELECT * FROM pertemuan WHERE izin_token = $1',
    [token]
  );

  if (hasilPertemuan.rows[0]) {
    return {
      pertemuan: normalisasiPertemuan(hasilPertemuan.rows[0]),
      mode: 'pertemuan'
    };
  }

  const hasilKelompok = await db.query(
    'SELECT id, nama, desa_id FROM kelompok WHERE izin_token = $1',
    [token]
  );

  const kelompok = hasilKelompok.rows[0];

  if (!kelompok) {
    fail(404, 'Tautan izin tidak ditemukan.');
  }

  const hasilTerdekat = await db.query(
    `SELECT *
     FROM pertemuan
     WHERE tanggal >= CURRENT_DATE
       AND selesai_pada IS NULL
       AND (
         (tingkat = 'kelompok' AND kelompok_id = $1)
         OR (tingkat = 'desa' AND desa_id = $2)
         OR tingkat = 'daerah'
       )
     ORDER BY tanggal ASC, id ASC
     LIMIT 1`,
    [kelompok.id, kelompok.desa_id]
  );

  if (!hasilTerdekat.rows[0]) {
    fail(404, 'Belum ada kegiatan yang akan datang.');
  }

  return {
    pertemuan: normalisasiPertemuan(hasilTerdekat.rows[0]),
    mode: 'kelompok',
    kelompok: {
      id: kelompok.id,
      nama: kelompok.nama
    }
  };
}

module.exports = { pertemuanDariToken };
