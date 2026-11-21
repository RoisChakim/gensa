'use strict';

const fs = require('node:fs');
const path = require('node:path');

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
const SESSION_SECRET = process.env.SESSION_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ||
  `http://127.0.0.1:${PORT}/api/auth/google/callback`;
const SESSION_SECONDS = 12 * 60 * 60;
const RESET_SECONDS = 60 * 60;
const MAX_BODY = 100 * 1024;
// TRUST_PROXY=1 hanya bila server jalan di belakang reverse proxy
// tepercaya (mis. Vercel): TLS berakhir di edge, jadi req.socket.encrypted
// selalu false dan protokol asli dibaca dari x-forwarded-proto.
// JANGAN diaktifkan bila server diakses langsung (lokal).
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
// Basis URL publik untuk tautan reset password (mis.
// https://gensa.vercel.app). Bila kosong, pakai alamat lokal seperti dulu.
const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = process.env.SMTP_SECURE === '1';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const SMTP_TERKONFIGURASI = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

if (!SMTP_TERKONFIGURASI) {
  console.log('Peringatan: SMTP belum dikonfigurasi — tautan reset password hanya tampil di log server. Isi SMTP_HOST, SMTP_USER, dan SMTP_PASS di .env untuk mengirim email.');
}
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const UPLOADS_DIR = path.resolve(__dirname, 'uploads');
const MAX_FOTO_BYTES = 2 * 1024 * 1024;
const MANUAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const ROLES = new Set(['admin', 'daerah', 'desa', 'kelompok']);
const TINGKAT = new Set(['paud', 'sd', 'smp', 'sma', 'kuliah', 'kerja']);
const STATUSES = new Set(['pending', 'approved', 'rejected', 'delete_pending']);
const JENJANG = new Set(['caberawit', 'pra_remaja', 'remaja', 'usia_nikah']);
const STATUS_ABSENSI = new Set(['hadir', 'izin', 'sakit', 'alfa']);
const TINGKAT_PERTEMUAN = new Set(['kelompok', 'desa', 'daerah']);
const JENIS_KELAMIN = new Set(['laki-laki', 'perempuan']);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT tidak valid.');
}

if (!SESSION_SECRET || Buffer.byteLength(SESSION_SECRET, 'utf8') < 32) {
  throw new Error('SESSION_SECRET wajib diisi minimal 32 byte acak.');
}

module.exports = {
  PORT, SESSION_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI, SESSION_SECONDS, RESET_SECONDS, MAX_BODY,
  TRUST_PROXY, APP_URL, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER,
  SMTP_PASS, SMTP_FROM, SMTP_TERKONFIGURASI, PUBLIC_DIR, UPLOADS_DIR,
  MAX_FOTO_BYTES, MANUAL_ALPHABET, PASSWORD_ALPHABET, ROLES, TINGKAT,
  STATUSES, JENJANG, STATUS_ABSENSI, TINGKAT_PERTEMUAN, JENIS_KELAMIN,
};
