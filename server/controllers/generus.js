'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const QRCode = require('qrcode');
const db = require('../db');
const { fail, sendJson } = require('../middleware/errors');
const { requiredString, positiveId, validDate, materiPositiveId } = require('../middleware/validate');
const { readJson, readFotoBody, randomString } = require('../middleware/http');
const { requireRole } = require('../middleware/auth');
const { buatNotifikasi } = require('../models/notifikasi');
const { JENIS_KELAMIN, TINGKAT, STATUSES, UPLOADS_DIR, MANUAL_ALPHABET } = require('../config');

async function createGenerus(req, res, auth) {
  requireRole(auth.user, 'kelompok');
  const kelompokId = positiveId(auth.user.kelompok_id, 'ID kelompok');

  const body = await readJson(req);

  const nama = requiredString(body.nama, 'Nama', 200);
  const tanggalLahir = validDate(body.tanggal_lahir);

  if (!TINGKAT.has(body.tingkat)) fail(400, 'Tingkat pendidikan tidak valid.');
  const tingkat = body.tingkat;
  const jenjang = {
    paud: 'caberawit',
    sd: 'caberawit',
    smp: 'pra_remaja',
    sma: 'remaja',
    kuliah: 'usia_nikah',
    kerja: 'usia_nikah'
  }[tingkat];

  const jenisKelamin = body.jenis_kelamin ?? null;
  if (jenisKelamin !== null && !JENIS_KELAMIN.has(jenisKelamin)) {
    fail(400, 'Jenis kelamin tidak valid.');
  }

  const ortuNama = requiredString(body.ortu_nama, 'Nama orang tua', 200);
  const ortuHubungan = requiredString(body.ortu_hubungan, 'Hubungan orang tua', 100);
  const ortuHp = requiredString(body.ortu_hp, 'Nomor HP orang tua', 30);
  if (!/^[+0-9 ()-]+$/.test(ortuHp)) {
    fail(400, 'Nomor HP orang tua/wali tidak valid.');
  }

  const hasKelas = Object.hasOwn(body, 'kelas_id');
  const kelasId = hasKelas ? materiPositiveId(body.kelas_id, 'ID kelas') : null;
  let kelasSekolah = hasKelas
    ? null
    : requiredString(body.kelas_sekolah, 'Kelas sekolah', 100);

  let generus;
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    if (hasKelas) {
      const result = await client.query(
        'SELECT id, nama, jenjang, aktif FROM kelas WHERE id = $1 FOR SHARE',
        [kelasId]
      );

      if (!result.rows.length) fail(400, 'Kelas tidak ditemukan.');
      const selected = result.rows[0];

      if (!selected.aktif) fail(400, 'Kelas sudah nonaktif.');
      if (selected.jenjang !== jenjang) {
        fail(400, 'Kelas tidak sesuai dengan tingkat pendidikan.');
      }
      kelasSekolah = selected.nama;
    }

    const result = await client.query(
      `INSERT INTO generus (
         kelompok_id, nama, tanggal_lahir, kelas_sekolah, kelas_id,
         tingkat, jenis_kelamin, ortu_nama, ortu_hubungan, ortu_hp,
         status, requested_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11)
       RETURNING id, kelompok_id, nama, tanggal_lahir, kelas_sekolah, kelas_id,
                 tingkat, jenjang, jenis_kelamin, ortu_nama, ortu_hubungan, ortu_hp,
                 status, requested_by, created_at, updated_at`,
      [
        kelompokId, nama, tanggalLahir, kelasSekolah, kelasId,
        tingkat, jenisKelamin, ortuNama, ortuHubungan, ortuHp, auth.user.id
      ]
    );

    generus = result.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 201, { generus });
}


// listGenerus — diubah Sesi 13A: sertakan kelas_id + kelas_nama.

async function listGenerus(res, auth, url) {
  const role = auth.user.role;
  if (!['admin', 'daerah', 'desa', 'kelompok'].includes(role)) {
    fail(403, 'Anda tidak memiliki akses.');
  }

  const params = url.searchParams;
  if (params.getAll('status').length > 1) {
    fail(400, 'Parameter status tidak boleh berulang.');
  }

  const status = params.has('status') ? params.get('status') : null;
  if (status !== null && !STATUSES.has(status)) {
    fail(400, 'Status generus tidak valid.');
  }

  // g.* sudah mencakup g.kelas_id.
  const result = await db.query(
    `SELECT g.*, k.nama AS kelompok_nama, d.nama AS desa_nama, da.nama AS daerah_nama,
            kl.nama AS kelas_nama
       FROM generus g
       JOIN kelompok k ON k.id = g.kelompok_id
       JOIN desa d ON d.id = k.desa_id
       JOIN daerah da ON da.id = d.daerah_id
       LEFT JOIN kelas kl ON kl.id = g.kelas_id
      WHERE ($1::status_generus IS NULL OR g.status = $1)
        AND (
          $2::text IN ('admin', 'daerah')
          OR ($2::text = 'desa' AND d.id = $3::integer)
          OR ($2::text = 'kelompok' AND g.kelompok_id = $4::integer)
        )
      ORDER BY g.created_at DESC, g.id DESC`,
    [
      status,
      role,
      auth.user.desa_id ?? null,
      auth.user.kelompok_id ?? null
    ]
  );

  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 200, { generus: result.rows });
}

async function approveGenerus(res, auth, id) {
  requireRole(auth.user, 'admin');

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const qrToken = crypto.randomBytes(16).toString('hex');
    const kodeManual = randomString(MANUAL_ALPHABET, 6);

    let result;
    try {
      result = await db.query(
        `UPDATE generus
         SET status = 'approved', qr_token = $1, kode_manual = $2,
             decided_by = $3, decided_at = now(), updated_at = now()
         WHERE id = $4 AND status = 'pending'
         RETURNING id, kelompok_id, nama, status, jenis_kelamin, qr_token, kode_manual,
                   decided_by, decided_at, updated_at, requested_by`,
        [qrToken, kodeManual, auth.user.id, id]
      );
    } catch (error) {
      if (error.code === '23505') continue;
      throw error;
    }

    if (result.rowCount !== 1) {
      fail(409, 'Generus tidak ditemukan atau tidak berstatus pending.');
    }

    const generus = result.rows[0];

    await buatNotifikasi(db, {
      userId: generus.requested_by,
      jenis: 'generus_disetujui',
      generusId: generus.id,
      generusNama: generus.nama,
      judul: 'Pengajuan generus disetujui',
      pesan: `Pengajuan generus ${generus.nama} sudah disetujui Admin. Generus sudah bisa absen.`,
    });

    sendJson(res, 200, { generus });
    return;
  }

  throw new Error('Gagal membuat kode unik.');
}

async function rejectGenerus(req, res, auth, id) {
  requireRole(auth.user, 'admin');
  const body = await readJson(req);
  const catatan = requiredString(body.catatan, 'Catatan', 2000);

  const result = await db.query(
    `UPDATE generus
     SET status = 'rejected', alasan_penolakan = $1,
         decided_by = $2, decided_at = now(), updated_at = now()
     WHERE id = $3 AND status = 'pending'
     RETURNING id, status, alasan_penolakan, decided_by, decided_at, updated_at,
               requested_by, nama`,
    [catatan, auth.user.id, id]
  );

  if (result.rowCount !== 1) {
    fail(409, 'Generus tidak ditemukan atau tidak berstatus pending.');
  }

  const generus = result.rows[0];

  await buatNotifikasi(db, {
    userId: generus.requested_by,
    jenis: 'generus_ditolak',
    generusId: generus.id,
    generusNama: generus.nama,
    judul: 'Pengajuan generus perlu diperbaiki',
    pesan: `Pengajuan generus ${generus.nama} belum disetujui. Alasan Admin: ${catatan}. Perbaiki datanya lalu ajukan ulang.`,
  });

  sendJson(res, 200, { generus });
}

async function requestDelete(req, res, auth, id) {
  // D1: Desa boleh mengajukan hapus generus di desanya (dulu hanya Kelompok).
  if (auth.user.role !== 'kelompok' && auth.user.role !== 'desa') {
    fail(403, 'Anda tidak memiliki akses.');
  }
  const body = await readJson(req);
  const alasan = requiredString(body.alasan, 'Alasan', 2000);

  const result = await db.query(
    `UPDATE generus g
     SET status = 'delete_pending', alasan_penghapusan = $1, updated_at = now()
     FROM kelompok k
     WHERE g.id = $2 AND g.kelompok_id = k.id AND g.status = 'approved'
       AND (
         ($3::text = 'kelompok' AND g.kelompok_id = $4)
         OR ($3::text = 'desa' AND k.desa_id = $5)
       )
     RETURNING g.id, g.status, g.alasan_penghapusan, g.updated_at`,
    [alasan, id, auth.user.role, auth.user.kelompok_id, auth.user.desa_id]
  );

  if (result.rowCount !== 1) {
    fail(409, 'Generus tidak ditemukan atau tidak dapat diajukan untuk dihapus.');
  }
  sendJson(res, 200, { generus: result.rows[0] });
}

async function approveDelete(res, auth, id) {
  requireRole(auth.user, 'admin');

  // R8: hapus riwayat anak dulu dalam satu transaksi, baru generusnya —
  // absensi/penilaian/izin/sync_items punya FK ke generus(id) TANPA
  // ON DELETE CASCADE, jadi DELETE langsung selalu gagal FK (23503)
  // untuk generus yang punya riwayat. PRD §6: riwayat ikut hilang.
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const terkunci = await client.query(
      `SELECT id, requested_by, nama
       FROM generus
       WHERE id = $1 AND status = 'delete_pending'
       FOR UPDATE`,
      [id]
    );

    if (terkunci.rowCount !== 1) {
      fail(409, 'Pengajuan penghapusan tidak ditemukan.');
    }

    const generus = terkunci.rows[0];

    await client.query('DELETE FROM sync_items WHERE generus_id = $1', [id]);
    await client.query('DELETE FROM izin WHERE generus_id = $1', [id]);
    await client.query('DELETE FROM penilaian WHERE generus_id = $1', [id]);
    await client.query('DELETE FROM absensi WHERE generus_id = $1', [id]);

    await buatNotifikasi(client, {
      userId: generus.requested_by,
      jenis: 'hapus_disetujui',
      generusId: generus.id,
      generusNama: generus.nama,
      judul: 'Pengajuan hapus generus disetujui',
      pesan: `Pengajuan hapus generus ${generus.nama} sudah disetujui Admin. Data generus dan riwayatnya sudah dihapus.`,
    });

    await client.query('DELETE FROM generus WHERE id = $1', [id]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  sendJson(res, 200, { ok: true });
}

async function rejectDelete(req, res, auth, id) {
  requireRole(auth.user, 'admin');
  const body = await readJson(req);
  const catatan = requiredString(body.catatan, 'Catatan', 2000);

  const result = await db.query(
    `UPDATE generus
     SET status = 'approved', alasan_penghapusan = NULL,
         catatan_tolak_hapus = $1, decided_by = $2, decided_at = now(),
         updated_at = now()
     WHERE id = $3 AND status = 'delete_pending'
     RETURNING id, status, alasan_penolakan, catatan_tolak_hapus,
               decided_by, decided_at, updated_at, nama, requested_by`,
    [catatan, auth.user.id, id]
  );

  if (result.rowCount !== 1) {
    fail(409, 'Pengajuan penghapusan tidak ditemukan.');
  }

  const generus = result.rows[0];

  await buatNotifikasi(db, {
    userId: generus.requested_by,
    jenis: 'hapus_ditolak',
    generusId: generus.id,
    generusNama: generus.nama,
    judul: 'Pengajuan hapus generus ditolak',
    pesan: `Pengajuan hapus generus ${generus.nama} ditolak Admin. Alasan: ${catatan}. Data generus tetap ada.`,
  });

  sendJson(res, 200, { generus });
}


// PRD §5: pengajuan yang ditolak Admin (alasan = data belum lengkap)
// bisa diperbaiki Kelompok lalu diajukan ulang — status kembali pending.
// ajukanUlangGenerus — diubah Sesi 13A: terima kelas_id, catat riwayat bila kelas berubah.

async function ajukanUlangGenerus(req, res, auth, id) {
  requireRole(auth.user, 'kelompok');

  id = positiveId(id, 'ID generus');
  const kelompokId = positiveId(auth.user.kelompok_id, 'ID kelompok');

  const body = await readJson(req);

  const nama = requiredString(body.nama, 'Nama', 200);
  const tanggalLahir = validDate(body.tanggal_lahir);

  if (!TINGKAT.has(body.tingkat)) fail(400, 'Tingkat pendidikan tidak valid.');
  const tingkat = body.tingkat;
  const jenjang = {
    paud: 'caberawit',
    sd: 'caberawit',
    smp: 'pra_remaja',
    sma: 'remaja',
    kuliah: 'usia_nikah',
    kerja: 'usia_nikah'
  }[tingkat];

  const jenisKelamin = body.jenis_kelamin ?? null;
  if (jenisKelamin !== null && !JENIS_KELAMIN.has(jenisKelamin)) {
    fail(400, 'Jenis kelamin tidak valid.');
  }

  const ortuNama = requiredString(body.ortu_nama, 'Nama orang tua', 200);
  const ortuHubungan = requiredString(body.ortu_hubungan, 'Hubungan orang tua', 100);
  const ortuHp = requiredString(body.ortu_hp, 'Nomor HP orang tua', 30);
  if (!/^[+0-9 ()-]+$/.test(ortuHp)) {
    fail(400, 'Nomor HP orang tua/wali tidak valid.');
  }

  const hasKelas = Object.hasOwn(body, 'kelas_id');
  const kelasId = hasKelas ? materiPositiveId(body.kelas_id, 'ID kelas') : null;
  let kelasSekolah = hasKelas
    ? null
    : requiredString(body.kelas_sekolah, 'Kelas sekolah', 100);

  let generus;
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const previous = await client.query(
      `SELECT *
         FROM generus
        WHERE id = $1
          AND kelompok_id = $2
          AND status = 'rejected'
        FOR UPDATE`,
      [id, kelompokId]
    );

    if (!previous.rows.length) {
      fail(409, 'Generus tidak ditemukan atau tidak berstatus ditolak.');
    }

    const old = previous.rows[0];

    if (hasKelas) {
      const result = await client.query(
        'SELECT id, nama, jenjang, aktif FROM kelas WHERE id = $1 FOR SHARE',
        [kelasId]
      );

      if (!result.rows.length) fail(400, 'Kelas tidak ditemukan.');
      const selected = result.rows[0];

      if (!selected.aktif) fail(400, 'Kelas sudah nonaktif.');
      if (selected.jenjang !== jenjang) {
        fail(400, 'Kelas tidak sesuai dengan tingkat pendidikan.');
      }
      kelasSekolah = selected.nama;
    }

    const result = await client.query(
      `UPDATE generus
          SET nama = $1,
              tanggal_lahir = $2,
              kelas_sekolah = $3,
              kelas_id = $4,
              tingkat = $5,
              jenis_kelamin = $6,
              ortu_nama = $7,
              ortu_hubungan = $8,
              ortu_hp = $9,
              status = 'pending',
              alasan_penolakan = NULL,
              decided_by = NULL,
              decided_at = NULL,
              updated_at = now()
        WHERE id = $10
          AND kelompok_id = $11
          AND status = 'rejected'
        RETURNING id, kelompok_id, nama, tanggal_lahir, kelas_sekolah, kelas_id,
                  tingkat, jenjang, jenis_kelamin, ortu_nama, ortu_hubungan, ortu_hp,
                  status, requested_by, created_at, updated_at`,
      [
        nama, tanggalLahir, kelasSekolah, kelasId, tingkat, jenisKelamin,
        ortuNama, ortuHubungan, ortuHp, id, kelompokId
      ]
    );

    if (!result.rows.length) {
      fail(409, 'Generus tidak ditemukan atau tidak berstatus ditolak.');
    }

    if (old.kelas_id !== kelasId) {
      await client.query(
        `INSERT INTO riwayat_kelas
           (generus_id, kelas_lama, kelas_baru, diubah_oleh)
         VALUES ($1, $2, $3, $4)`,
        [id, old.kelas_sekolah, kelasSekolah, auth.user.id]
      );
    }

    generus = result.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 200, { generus });
}


// Ubah generus yang sudah disetujui (M7/M8, Sesi 13A): ganti kelas + data ortu, catat riwayat kelas.

async function updateGenerus(req, res, auth, id) {
  requireRole(auth.user, 'kelompok');

  id = positiveId(id, 'ID generus');
  const kelompokId = positiveId(auth.user.kelompok_id, 'ID kelompok');

  const body = await readJson(req);

  const keys = Object.keys(body);
  const allowed = ['kelas_id', 'ortu_nama', 'ortu_hubungan', 'ortu_hp'];
  if (!keys.length || keys.some(key => !allowed.includes(key))) {
    fail(400, 'Isi minimal satu field yang boleh diubah.');
  }

  const hasKelas = Object.hasOwn(body, 'kelas_id');
  const hasNama = Object.hasOwn(body, 'ortu_nama');
  const hasHubungan = Object.hasOwn(body, 'ortu_hubungan');
  const hasHp = Object.hasOwn(body, 'ortu_hp');

  const requestedKelasId = hasKelas
    ? materiPositiveId(body.kelas_id, 'ID kelas')
    : null;
  const ortuNama = hasNama
    ? requiredString(body.ortu_nama, 'Nama orang tua/wali', 150)
    : null;
  const ortuHubungan = hasHubungan
    ? requiredString(body.ortu_hubungan, 'Hubungan orang tua/wali', 50)
    : null;
  const ortuHp = hasHp
    ? requiredString(body.ortu_hp, 'Nomor HP orang tua/wali', 30)
    : null;

  if (hasHp && !/^[+0-9 ()-]+$/.test(ortuHp)) {
    fail(400, 'Nomor HP orang tua/wali tidak valid.');
  }

  let generus;
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const previous = await client.query(
      `SELECT *
         FROM generus
        WHERE id = $1
          AND kelompok_id = $2
          AND status = 'approved'
        FOR UPDATE`,
      [id, kelompokId]
    );

    if (!previous.rows.length) {
      fail(404, 'Generus tidak ditemukan atau tidak dapat diubah.');
    }

    const old = previous.rows[0];
    let kelasId = old.kelas_id;
    let kelasSekolah = old.kelas_sekolah;
    let kelasBerubah = false;

    if (hasKelas) {
      const kelas = await client.query(
        'SELECT id, nama, jenjang, aktif FROM kelas WHERE id = $1 FOR SHARE',
        [requestedKelasId]
      );

      if (!kelas.rows.length) fail(400, 'Kelas tidak ditemukan.');
      const selected = kelas.rows[0];

      if (!selected.aktif) fail(400, 'Kelas sudah nonaktif.');
      if (selected.jenjang !== old.jenjang) {
        fail(400, 'Kelas tidak sesuai dengan jenjang generus.');
      }

      kelasId = selected.id;
      kelasBerubah = kelasId !== old.kelas_id;

      if (kelasBerubah) kelasSekolah = selected.nama;
    }

    const result = await client.query(
      `WITH changed AS (
         UPDATE generus
            SET kelas_id = $1,
                kelas_sekolah = $2,
                ortu_nama = $3,
                ortu_hubungan = $4,
                ortu_hp = $5,
                updated_at = now()
          WHERE id = $6
            AND kelompok_id = $7
            AND status = 'approved'
          RETURNING *
       )
       SELECT g.*, k.nama AS kelompok_nama, d.nama AS desa_nama,
              kl.nama AS kelas_nama
         FROM changed g
         JOIN kelompok k ON k.id = g.kelompok_id
         JOIN desa d ON d.id = k.desa_id
         LEFT JOIN kelas kl ON kl.id = g.kelas_id`,
      [
        kelasId,
        kelasSekolah,
        hasNama ? ortuNama : old.ortu_nama,
        hasHubungan ? ortuHubungan : old.ortu_hubungan,
        hasHp ? ortuHp : old.ortu_hp,
        id,
        kelompokId
      ]
    );

    if (!result.rows.length) {
      fail(404, 'Generus tidak ditemukan atau tidak dapat diubah.');
    }

    if (kelasBerubah) {
      await client.query(
        `INSERT INTO riwayat_kelas
           (generus_id, kelas_lama, kelas_baru, diubah_oleh)
         VALUES ($1, $2, $3, $4)`,
        [id, old.kelas_sekolah, kelasSekolah, auth.user.id]
      );
    }

    generus = result.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 200, { generus });
}

// Daftar akun (M3, halaman Admin buat akun): tanpa password_hash.

async function uploadFoto(req, res, auth, id) {
  const contentType = (req.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  if (!['image/jpeg', 'image/png'].includes(contentType)) {
    fail(415, 'Foto harus JPG atau PNG.');
  }

  const result = await db.query(
    'SELECT id, kelompok_id, status, foto_url FROM generus WHERE id = $1',
    [id]
  );

  if (result.rowCount !== 1 || result.rows[0].status !== 'approved') {
    fail(404, 'Generus tidak ditemukan.');
  }

  const generus = result.rows[0];

  if (
    auth.user.role !== 'admin' &&
    (
      auth.user.role !== 'kelompok' ||
      auth.user.kelompok_id !== generus.kelompok_id
    )
  ) {
    fail(403, 'Anda tidak memiliki akses.');
  }

  const foto = await readFotoBody(req);
  const signature = contentType === 'image/jpeg'
    ? Buffer.from([0xff, 0xd8, 0xff])
    : Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  if (
    foto.length < signature.length ||
    !foto.subarray(0, signature.length).equals(signature)
  ) {
    fail(400, 'Isi file bukan gambar yang valid.');
  }

  const ekstensi = contentType === 'image/jpeg' ? '.jpg' : '.png';
  const namaFile = crypto.randomBytes(16).toString('hex') + ekstensi;
  const filePath = path.join(UPLOADS_DIR, namaFile);

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(filePath, foto, { flag: 'wx', mode: 0o600 });

  try {
    const updated = await db.query(
      `UPDATE generus
          SET foto_url = $1, updated_at = now()
        WHERE id = $2
          AND status = 'approved'
          AND kelompok_id = $3`,
      [namaFile, id, generus.kelompok_id]
    );

    if (updated.rowCount !== 1) {
      fail(404, 'Generus tidak ditemukan.');
    }
  } catch (error) {
    try {
      fs.unlinkSync(filePath);
    } catch {}
    throw error;
  }

  if (
    generus.foto_url &&
    generus.foto_url !== namaFile &&
    /^[a-f0-9]{32}\.(jpg|png)$/.test(generus.foto_url)
  ) {
    try {
      fs.unlinkSync(path.join(UPLOADS_DIR, generus.foto_url));
    } catch {}
  }

  sendJson(res, 200, { foto_url: namaFile });
}

async function getFoto(res, auth, id) {
  const result = await db.query(
    `SELECT g.foto_url
     FROM generus g
     JOIN kelompok k ON k.id = g.kelompok_id
     WHERE g.id = $1
       AND g.status = 'approved'
       AND (
         $2::text IN ('admin', 'daerah')
         OR ($2::text = 'desa' AND k.desa_id = $3::integer)
         OR ($2::text = 'kelompok' AND g.kelompok_id = $4::integer)
       )`,
    [id, auth.user.role, auth.user.desa_id, auth.user.kelompok_id]
  );

  if (result.rowCount !== 1 || !result.rows[0].foto_url) {
    fail(404, 'Foto generus tidak ditemukan.');
  }

  const namaFile = result.rows[0].foto_url;

  if (
    namaFile.includes('/') ||
    namaFile.includes('\\') ||
    !/^[a-f0-9]{32}\.(jpg|png)$/.test(namaFile)
  ) {
    fail(404, 'Foto generus tidak ditemukan.');
  }

  let foto;

  try {
    foto = fs.readFileSync(path.join(UPLOADS_DIR, namaFile));
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      fail(404, 'Foto generus tidak ditemukan.');
    }
    throw error;
  }

  res.writeHead(200, {
    'Content-Type': namaFile.endsWith('.png') ? 'image/png' : 'image/jpeg',
    'Content-Length': foto.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(foto);
}

async function qrSvg(req, res, auth, id) {
  const result = await db.query(
    `SELECT g.qr_token
     FROM generus g
     JOIN kelompok k ON k.id = g.kelompok_id
     WHERE g.id = $1
       AND g.status = 'approved'
       AND g.qr_token IS NOT NULL
       AND (
         $2::text IN ('admin', 'daerah')
         OR ($2::text = 'desa' AND k.desa_id = $3::integer)
         OR ($2::text = 'kelompok' AND g.kelompok_id = $4::integer)
       )`,
    [id, auth.user.role, auth.user.desa_id, auth.user.kelompok_id]
  );

  if (result.rowCount !== 1 || !result.rows[0].qr_token) {
    fail(404, 'QR generus tidak ditemukan.');
  }

  const svg = await QRCode.toString(result.rows[0].qr_token, {
    type: 'svg',
    margin: 1,
  });

  res.writeHead(200, {
    'Content-Type': 'image/svg+xml',
    'Content-Length': Buffer.byteLength(svg),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(svg);
}

module.exports = {
  createGenerus, listGenerus, approveGenerus, rejectGenerus, requestDelete,
  approveDelete, rejectDelete, ajukanUlangGenerus, updateGenerus, uploadFoto,
  getFoto, qrSvg,
};
