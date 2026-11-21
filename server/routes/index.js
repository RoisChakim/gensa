'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const {
  PORT, SESSION_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI, SESSION_SECONDS, RESET_SECONDS, MAX_BODY,
  TRUST_PROXY, APP_URL, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER,
  SMTP_PASS, SMTP_FROM, SMTP_TERKONFIGURASI, PUBLIC_DIR, UPLOADS_DIR,
  MAX_FOTO_BYTES, MANUAL_ALPHABET, PASSWORD_ALPHABET, ROLES, TINGKAT,
  STATUSES, JENJANG, STATUS_ABSENSI, TINGKAT_PERTEMUAN, JENIS_KELAMIN,
} = require('../config');
const { HttpError, fail, sendJson, sendError } = require('../middleware/errors');
const {
  requiredString, passwordValue, normalizedEmail, positiveId, optionalId,
  validDate, validPertemuanDate, validPengingatJam, materiPositiveId,
  parseTugasFilters,
} = require('../middleware/validate');
const {
  readFotoBody, readJson, randomString, sessionCookie, cookieToken,
  requestProtocol, requestSecure, checkOrigin,
} = require('../middleware/http');
const {
  loginFailures, resetAttempts, izinAttempts, rateState, recordLoginFailure,
  clientIp, checkIzinRateLimit, checkResetRateLimit, authenticate, requireRole,
  publicUser,
} = require('../middleware/auth');
const {
  normalisasiPertemuan, pertemuanScopeWhere, canManagePertemuan,
  generusInScope, generusScopeWhere, tugasScopeWhere,
} = require('../models/scope');
const { buatNotifikasi } = require('../models/notifikasi');
const { pertemuanDariToken } = require('../models/izin');
const {
  hitungLaporan, buatLaporanWord, buatLaporanExcel, buatNilaiExcel,
} = require('../models/laporan');
const { readMateriBody, getMateriTugas, ambilPenilaian } = require('../models/penilaian');
const {
  login, logout, createUser, changePassword, resetSignature,
  passwordFingerprint, buatStateGoogle, periksaStateGoogle, kirimEmailReset,
  requestReset, parseResetToken, confirmReset, mulaiLoginGoogle,
  callbackLoginGoogle,
} = require('../controllers/auth');
const {
  createGenerus, listGenerus, approveGenerus, rejectGenerus, requestDelete,
  approveDelete, rejectDelete, ajukanUlangGenerus, updateGenerus, uploadFoto,
  getFoto, qrSvg,
} = require('../controllers/generus');
const {
  listUsers, listWilayah, listKelas, createKelas, updateKelas, deleteKelas,
  listRiwayatKelas, ringkasan, statusSistem,
} = require('../controllers/wilayah');
const {
  listNotifikasi, hitungBelumDibaca, tandaiDibaca, tandaiSemuaDibaca,
} = require('../controllers/notifikasi');
const {
  createPertemuan, listPertemuan, getPertemuan, updatePertemuan,
  deletePertemuan, listAbsensi, daftarPertemuan, recordAbsen,
  recordAbsenManual, syncAbsensi, selesaiPertemuan, linkIzin,
  linkIzinKelompok, listIzin, setujuiIzin, tolakIzin, koreksiAbsensi,
} = require('../controllers/pertemuan');
const {
  createTugas, listTugas, deleteTugas, savePenilaian, listPenilaian,
} = require('../controllers/tugas');
const {
  listArsip, detailArsip, unduhLaporan, unduhNilai,
} = require('../controllers/laporan');
const { muatIzinPublik, kirimIzin, verifikasiKodeIzin } = require('../controllers/izinPublik');
const { serveStatic } = require('../controllers/statis');

async function handle(req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://127.0.0.1');
  } catch {
    fail(400, 'Alamat tidak valid.');
  }

  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(302, { Location: '/login.html', 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  if (req.method === 'GET' && !pathname.startsWith('/api/')) {
    await serveStatic(req, res, pathname);
    return;
  }

  if (!pathname.startsWith('/api/')) fail(404, 'Halaman tidak ditemukan.');

  if (req.method !== 'GET') checkOrigin(req);

  if (req.method === 'POST' && pathname === '/api/login') {
    await login(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/reset-password') {
    await requestReset(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/reset-password/confirm') {
    await confirmReset(req, res);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/auth/google') {
    await mulaiLoginGoogle(req, res);
    return;
  }

  if (
    req.method === 'GET' &&
    pathname === '/api/auth/google/callback'
  ) {
    await callbackLoginGoogle(req, res, url);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/izin') {
    await muatIzinPublik(req, res, url);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/izin') {
    await kirimIzin(req, res, url);
    return;
  }

if (req.method === 'POST' && pathname === '/api/izin/verifikasi') {
    await verifikasiKodeIzin(req, res, url);
    return;
  }

  const auth = await authenticate(req);

  if (req.method === 'POST' && pathname === '/api/logout') {
    await logout(req, res, auth);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/me') {
    sendJson(res, 200, { user: publicUser(auth.user) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/change-password') {
    await changePassword(req, res, auth);
    return;
  }

  if (auth.user.must_change_password) {
    fail(403, 'Ganti password terlebih dahulu.');
  }

  // Rute Kelas + Riwayat Kelas (Sesi 13A).

  if (req.method === 'GET' && pathname === '/api/kelas') {
    await listKelas(res, auth, url);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/kelas') {
    await createKelas(req, res, auth);
    return;
  }

  const kelasMatch = pathname.match(/^\/api\/kelas\/([1-9]\d*)$/);

  if (req.method === 'PATCH' && kelasMatch) {
    await updateKelas(req, res, auth, positiveId(kelasMatch[1], 'ID kelas'));
    return;
  }

  if (req.method === 'DELETE' && kelasMatch) {
    await deleteKelas(res, auth, positiveId(kelasMatch[1], 'ID kelas'));
    return;
  }

  const riwayatKelasMatch = pathname.match(/^\/api\/generus\/([1-9]\d*)\/riwayat-kelas$/);

  if (req.method === 'GET' && riwayatKelasMatch) {
    await listRiwayatKelas(
      res,
      auth,
      positiveId(riwayatKelasMatch[1], 'ID generus')
    );
    return;
  }

  if (req.method === 'POST' && pathname === '/api/users') {
    await createUser(req, res, auth);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/users') {
    await listUsers(res, auth);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/wilayah') {
    await listWilayah(res, auth);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/ringkasan') {
    await ringkasan(res, auth);
    return;
  }

if (req.method === 'GET' && pathname === '/api/sistem') {
    statusSistem(res, auth);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/notifikasi') {
    await listNotifikasi(req, res, auth);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/notifikasi/belum-dibaca') {
    await hitungBelumDibaca(res, auth);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/notifikasi/baca-semua') {
    await tandaiSemuaDibaca(res, auth);
    return;
  }

  const notifikasiMatch = pathname.match(
    /^\/api\/notifikasi\/([1-9]\d*)\/baca$/
  );

  if (req.method === 'POST' && notifikasiMatch) {
    await tandaiDibaca(req, res, auth, notifikasiMatch[1]);
    return;
  }

  if (pathname === '/api/generus' && req.method === 'POST') {
    await createGenerus(req, res, auth);
    return;
  }

  if (pathname === '/api/generus' && req.method === 'GET') {
    await listGenerus(res, auth, url);
    return;
  }

  // Rute ubah generus (PATCH /api/generus/:id, Sesi 13A).

  const editGenerusMatch = pathname.match(/^\/api\/generus\/([1-9]\d*)$/);

  if (req.method === 'PATCH' && editGenerusMatch) {
    await updateGenerus(
      req,
      res,
      auth,
      positiveId(editGenerusMatch[1], 'ID generus')
    );
    return;
  }

  const match = pathname.match(
    /^\/api\/generus\/([1-9]\d*)\/(approve|reject|delete-request|delete-approve|delete-reject|ajukan-ulang)$/
  );

  if (req.method === 'POST' && match) {
    const id = positiveId(match[1]);

    if (match[2] === 'approve') await approveGenerus(res, auth, id);
    if (match[2] === 'reject') await rejectGenerus(req, res, auth, id);
    if (match[2] === 'delete-request') await requestDelete(req, res, auth, id);
    if (match[2] === 'delete-approve') await approveDelete(res, auth, id);
    if (match[2] === 'delete-reject') await rejectDelete(req, res, auth, id);
    if (match[2] === 'ajukan-ulang') await ajukanUlangGenerus(req, res, auth, id);
    return;
  }

  const fotoMatch = pathname.match(/^\/api\/generus\/([1-9]\d*)\/foto$/);
  if (req.method === 'POST' && fotoMatch) {
    await uploadFoto(req, res, auth, positiveId(fotoMatch[1], 'ID generus'));
    return;
  }

if (
  req.method === 'GET' &&
  (pathname === '/api/laporan' || pathname === '/api/laporan.docx' || pathname === '/api/laporan.xlsx')
) {
  await unduhLaporan(req, res, auth, url);
  return;
}

if (req.method === 'GET' && pathname === '/api/arsip/bulan') {
    await detailArsip(req, res, auth, url);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/arsip') {
    await listArsip(res, auth);
    return;
  }

if (req.method === 'POST' && pathname === '/api/tugas') {
  await createTugas(req, res, auth);
  return;
}

if (req.method === 'GET' && pathname === '/api/tugas') {
  await listTugas(req, res, auth);
  return;
}

const deleteTugasMatch = pathname.match(/^\/api\/tugas\/([0-9]+)$/);

if (req.method === 'DELETE' && deleteTugasMatch) {
  await deleteTugas(req, res, auth, deleteTugasMatch[1]);
  return;
}

if (req.method === 'POST' && pathname === '/api/penilaian') {
  await savePenilaian(req, res, auth);
  return;
}

if (req.method === 'GET' && pathname === '/api/penilaian') {
  await listPenilaian(req, res, auth);
  return;
}

if (req.method === 'GET' && pathname === '/api/nilai.xlsx') {
  await unduhNilai(req, res, auth, url);
  return;
}

  if (req.method === 'POST' && pathname === '/api/pertemuan') {
    await createPertemuan(req, res, auth);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/pertemuan') {
    await listPertemuan(res, auth, url);
    return;
  }

  const pertemuanMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)$/);
  if (req.method === 'GET' && pertemuanMatch) {
    await getPertemuan(res, auth, positiveId(pertemuanMatch[1]));
    return;
  }

  if (req.method === 'PATCH' && pertemuanMatch) {
    await updatePertemuan(req, res, auth, positiveId(pertemuanMatch[1]));
    return;
  }

  if (req.method === 'DELETE' && pertemuanMatch) {
    await deletePertemuan(res, auth, positiveId(pertemuanMatch[1]));
    return;
  }

  const absensiMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)\/absensi$/);
  if (req.method === 'GET' && absensiMatch) {
    await listAbsensi(res, auth, positiveId(absensiMatch[1]), url);
    return;
  }

  const daftarMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)\/daftar$/);
  if (req.method === 'GET' && daftarMatch) {
    await daftarPertemuan(res, auth, positiveId(daftarMatch[1]));
    return;
  }

  const syncMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)\/sync$/);
  if (req.method === 'POST' && syncMatch) {
    await syncAbsensi(req, res, auth, positiveId(syncMatch[1]));
    return;
  }

  const absenMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)\/absen$/);
  if (req.method === 'POST' && absenMatch) {
    await recordAbsen(req, res, auth, positiveId(absenMatch[1]));
    return;
  }

  const manualMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)\/absen-manual$/);
  if (req.method === 'POST' && manualMatch) {
    await recordAbsenManual(req, res, auth, positiveId(manualMatch[1]));
    return;
  }

  const selesaiMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)\/selesai$/);
  if (req.method === 'POST' && selesaiMatch) {
    await selesaiPertemuan(res, auth, positiveId(selesaiMatch[1]));
    return;
  }

  const koreksiMatch = pathname.match(
    /^\/api\/pertemuan\/([1-9]\d*)\/absensi\/([1-9]\d*)\/koreksi$/
  );
  if (req.method === 'POST' && koreksiMatch) {
    await koreksiAbsensi(
      req, res, auth, positiveId(koreksiMatch[1]), positiveId(koreksiMatch[2])
    );
    return;
  }

  const linkIzinMatch = pathname.match(
    /^\/api\/pertemuan\/([1-9]\d*)\/link-izin$/
  );
  if (req.method === 'GET' && linkIzinMatch) {
    await linkIzin(res, auth, positiveId(linkIzinMatch[1]));
    return;
  }

  const linkIzinKelompokMatch = pathname.match(
    /^\/api\/kelompok\/(\d+)\/link-izin$/
  );

  if (req.method === 'GET' && linkIzinKelompokMatch) {
    await linkIzinKelompok(
      res,
      auth,
      positiveId(linkIzinKelompokMatch[1], 'Kelompok')
    );
    return;
  }

  const listIzinMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)\/izin$/);
  if (req.method === 'GET' && listIzinMatch) {
    await listIzin(res, auth, positiveId(listIzinMatch[1]));
    return;
  }

  const putusIzinMatch = pathname.match(
    /^\/api\/pertemuan\/([1-9]\d*)\/izin\/([1-9]\d*)\/(setujui|tolak)$/
  );
  if (req.method === 'POST' && putusIzinMatch) {
    const pid = positiveId(putusIzinMatch[1]);
    const zid = positiveId(putusIzinMatch[2]);
    if (putusIzinMatch[3] === 'setujui') {
      await setujuiIzin(req, res, auth, pid, zid);
    } else {
      await tolakIzin(req, res, auth, pid, zid);
    }
    return;
  }

  const qrMatch = pathname.match(/^\/api\/generus\/([1-9]\d*)\/qr\.svg$/);
  if (req.method === 'GET' && qrMatch) {
    await qrSvg(req, res, auth, positiveId(qrMatch[1]));
    return;
  }

  const fotoGetMatch = pathname.match(/^\/api\/generus\/([1-9]\d*)\/foto$/);
  if (req.method === 'GET' && fotoGetMatch) {
    await getFoto(res, auth, positiveId(fotoGetMatch[1], 'ID generus'));
    return;
  }

  fail(404, 'Rute tidak ditemukan.');
}

module.exports = { handle };
