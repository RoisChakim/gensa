'use strict';

const db = require('../db');
const { fail, sendJson } = require('../middleware/errors');
const { requiredString, positiveId } = require('../middleware/validate');
const { readJson } = require('../middleware/http');
const { checkIzinRateLimit } = require('../middleware/auth');
const { pertemuanDariToken } = require('../models/izin');
const { normalisasiPertemuan, generusInScope } = require('../models/scope');
const { MANUAL_ALPHABET } = require('../config');

async function muatIzinPublik(req, res, url) {
  res.setHeader('Cache-Control', 'no-store');

  const token = url.searchParams.get('t');

  if (typeof token !== 'string' || !/^[a-fA-F0-9]{32}$/.test(token)) {
    fail(404, 'Tautan izin tidak ditemukan.');
  }

  const sumber = await pertemuanDariToken(token.toLowerCase());
  const pertemuan = sumber.pertemuan;
  let kelompok = sumber.mode === 'kelompok' ? sumber.kelompok : null;

  if (kelompok === null && pertemuan.tingkat === 'kelompok') {
    const hasilKelompok = await db.query(
      'SELECT id, nama FROM kelompok WHERE id = $1',
      [pertemuan.kelompok_id]
    );

    if (!hasilKelompok.rows[0]) {
      fail(404, 'Tautan izin tidak ditemukan.');
    }

    kelompok = {
      id: hasilKelompok.rows[0].id,
      nama: hasilKelompok.rows[0].nama
    };
  }

  sendJson(res, 200, {
    pertemuan: {
      id: pertemuan.id,
      tanggal: pertemuan.tanggal,
      tingkat: pertemuan.tingkat
    },
    kelompok,
    mode: sumber.mode
  });
}

async function kirimIzin(req, res, url) {
  // R2: batasi percobaan dari satu IP sebelum membaca token/kode.
  checkIzinRateLimit(req);
  res.setHeader('Cache-Control', 'no-store');

  const token = url.searchParams.get('t');

  if (typeof token !== 'string' || !/^[a-fA-F0-9]{32}$/.test(token)) {
    fail(404, 'Tautan izin tidak ditemukan.');
  }

  const tokenNormal = token.toLowerCase();
  const sumber = await pertemuanDariToken(tokenNormal);

  if (sumber.pertemuan.selesai_pada !== null) {
    fail(409, 'Kegiatan sudah selesai.');
  }

  const body = await readJson(req);

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail(400, 'Data pengajuan tidak valid.');
  }

  const generusId = positiveId(body.generus_id, 'Generus');

  if (body.alasan !== 'sakit' && body.alasan !== 'izin') {
    fail(400, 'Alasan harus sakit atau izin.');
  }

  let keterangan = null;

  if (body.alasan === 'izin') {
    keterangan = requiredString(body.keterangan, 'Alasan izin', 500);
  } else if (body.keterangan !== undefined && body.keterangan !== null) {
    if (typeof body.keterangan !== 'string') {
      fail(400, 'Keterangan harus berupa teks.');
    }

    if (body.keterangan.trim() !== '') {
      keterangan = requiredString(body.keterangan, 'Keterangan', 500);
    }
  }

  if (typeof body.kode !== 'string') {
    fail(404, 'Kode tidak ditemukan.');
  }

  const kode = body.kode.trim();
  let qrToken = null;
  let kodeManual = null;

  if (/^[a-fA-F0-9]{32}$/.test(kode)) {
    qrToken = kode.toLowerCase();
  } else if (
    kode.length === 6 &&
    [...kode].every((karakter) => MANUAL_ALPHABET.includes(karakter))
  ) {
    kodeManual = kode;
  } else {
    fail(404, 'Kode tidak ditemukan.');
  }

  const client = await db.getClient();
  let izin;

  try {
    await client.query('BEGIN');

    const terkunci = await client.query(
      `SELECT *
       FROM pertemuan
       WHERE id = $1
       FOR UPDATE`,
      [sumber.pertemuan.id]
    );

    if (
      !terkunci.rows[0] ||
      (
        sumber.mode === 'pertemuan' &&
        terkunci.rows[0].izin_token !== tokenNormal
      )
    ) {
      fail(404, 'Tautan izin tidak ditemukan.');
    }

    const pertemuan = normalisasiPertemuan(terkunci.rows[0]);

    if (pertemuan.selesai_pada !== null) {
      fail(409, 'Kegiatan sudah selesai.');
    }

    const hasilGenerus = await client.query(
      `SELECT id
       FROM generus
       WHERE status = 'approved'
         AND (qr_token = $1 OR kode_manual = $2)`,
      [qrToken, kodeManual]
    );

    const generus = hasilGenerus.rows[0];

    if (!generus || generus.id !== generusId) {
      fail(404, 'Kode tidak ditemukan.');
    }

    const dalamLingkup = await generusInScope(
      pertemuan,
      generus.id,
      client
    );

    if (!dalamLingkup) {
      fail(404, 'Kode tidak ditemukan.');
    }

    const duplikat = await client.query(
      `SELECT id
       FROM izin
       WHERE pertemuan_id = $1
         AND generus_id = $2
         AND status IN ('menunggu', 'disetujui')
       LIMIT 1`,
      [pertemuan.id, generusId]
    );

    if (duplikat.rows[0]) {
      fail(409, 'Izin sudah diajukan untuk kegiatan ini.');
    }

    const hasilIzin = await client.query(
      `INSERT INTO izin (
         pertemuan_id, generus_id, alasan, keterangan, status
       )
       VALUES ($1, $2, $3, $4, 'menunggu')
       RETURNING
         id, pertemuan_id, generus_id, alasan, keterangan,
         status, created_at`,
      [pertemuan.id, generusId, body.alasan, keterangan]
    );

    izin = hasilIzin.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  sendJson(res, 201, { izin });
}

async function verifikasiKodeIzin(req, res, url) {
  // R2: gunakan batas percobaan yang sama dengan pengiriman izin.
  checkIzinRateLimit(req);
  res.setHeader('Cache-Control', 'no-store');

  const token = url.searchParams.get('t');

  if (typeof token !== 'string' || !/^[a-fA-F0-9]{32}$/.test(token)) {
    fail(404, 'Tautan izin tidak ditemukan.');
  }

  const { pertemuan } = await pertemuanDariToken(token.toLowerCase());

  if (pertemuan.selesai_pada !== null) {
    fail(409, 'Kegiatan sudah selesai.');
  }

  const body = await readJson(req);

  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    typeof body.kode !== 'string'
  ) {
    fail(404, 'Kode tidak ditemukan.');
  }

  const kode = body.kode.trim();
  let qrToken = null;
  let kodeManual = null;

  if (/^[a-fA-F0-9]{32}$/.test(kode)) {
    qrToken = kode.toLowerCase();
  } else if (
    kode.length === 6 &&
    [...kode].every((karakter) => MANUAL_ALPHABET.includes(karakter))
  ) {
    kodeManual = kode;
  } else {
    fail(404, 'Kode tidak ditemukan.');
  }

  const hasilGenerus = await db.query(
    `SELECT id, nama, kelas_sekolah
     FROM generus
     WHERE status = 'approved'
       AND (qr_token = $1 OR kode_manual = $2)`,
    [qrToken, kodeManual]
  );

  const generus = hasilGenerus.rows[0];

  if (!generus) {
    fail(404, 'Kode tidak ditemukan.');
  }

  const dalamLingkup = await generusInScope(
    pertemuan,
    generus.id,
    db
  );

  if (!dalamLingkup) {
    fail(404, 'Kode tidak ditemukan.');
  }

  sendJson(res, 200, {
    generus: {
      id: generus.id,
      nama: generus.nama,
      kelas_sekolah: generus.kelas_sekolah
    }
  });
}

module.exports = { muatIzinPublik, kirimIzin, verifikasiKodeIzin };
