'use strict';

const { fail } = require('./errors');

function requiredString(value, label, max = 255) {
  if (typeof value !== 'string') fail(400, `${label} wajib diisi.`);
  const result = value.trim();
  if (!result || result.length > max) {
    fail(400, `${label} tidak valid.`);
  }
  return result;
}

function passwordValue(value, label, minimum = 1) {
  const result = requiredString(value, label, 72);
  if (
    Array.from(result).length < minimum ||
    Buffer.byteLength(result, 'utf8') > 72
  ) {
    fail(400, `${label} tidak valid.`);
  }
  return result;
}

function normalizedEmail(value) {
  const email = requiredString(value, 'Email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(400, 'Email tidak valid.');
  }
  return email;
}

function positiveId(value, label = 'ID') {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    !/^[1-9]\d*$/.test(String(value))
  ) {
    fail(400, `${label} tidak valid.`);
  }

  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > 2147483647) {
    fail(400, `${label} tidak valid.`);
  }
  return number;
}

function optionalId(value, label) {
  if (value === undefined || value === null || value === '') return null;
  return positiveId(value, label);
}

function validDate(value) {
  const date = requiredString(value, 'Tanggal lahir', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    fail(400, 'Tanggal lahir tidak valid.');
  }

  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date ||
    date > new Date().toISOString().slice(0, 10)
  ) {
    fail(400, 'Tanggal lahir tidak valid.');
  }
  return date;
}

function validPertemuanDate(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith('0000-')
  ) {
    fail(400, 'Tanggal pertemuan tidak valid.');
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    fail(400, 'Tanggal pertemuan tidak valid.');
  }

  return value;
}

function validPengingatJam(value) {
  if (value === undefined || value === null || value === '') return null;

  if (!Number.isSafeInteger(value) || value < 1 || value > 720) {
    fail(400, 'Pengingat harus 1–720 jam atau kosong.');
  }

  return value;
}

function materiPositiveId(value, label) {
  const validType =
    typeof value === 'number' ||
    (typeof value === 'string' && /^[0-9]+$/.test(value));
  const id = validType ? Number(value) : NaN;

  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) {
    fail(400, `${label} harus berupa angka positif yang valid.`);
  }

  return id;
}

function parseTugasFilters(req) {
  const params = new URL(req.url, 'http://localhost').searchParams;

  for (const key of ['kelas_id', 'tahun_ajaran', 'kategori']) {
    if (params.getAll(key).length > 1) {
      fail(400, 'Parameter tidak boleh berulang.');
    }
  }

  const filters = {};

  if (params.has('kelas_id')) {
    filters.kelas_id = materiPositiveId(params.get('kelas_id'), 'ID kelas');
  }

  if (params.has('tahun_ajaran')) {
    const value = params.get('tahun_ajaran');
    const tahun = Number(value);

    if (!/^\d{4}$/.test(value) || !Number.isInteger(tahun) || tahun < 2000 || tahun > 2100) {
      fail(400, 'Tahun ajaran harus berupa bilangan bulat 2000–2100.');
    }

    filters.tahun_ajaran = tahun;
  }

  if (params.has('kategori')) {
    const kategori = params.get('kategori');
    if (!['doa_surat', 'makna_pegon', 'praktik_solat'].includes(kategori)) {
      fail(400, 'Kategori tugas tidak valid.');
    }
    filters.kategori = kategori;
  }

  return filters;
}

module.exports = {
  requiredString, passwordValue, normalizedEmail, positiveId, optionalId,
  validDate, validPertemuanDate, validPengingatJam, materiPositiveId,
  parseTugasFilters,
};
