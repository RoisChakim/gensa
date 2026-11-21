'use strict';

const crypto = require('node:crypto');
const db = require('../db');
const { HttpError, fail, sendJson } = require('../middleware/errors');
const { requiredString, positiveId, optionalId, validPertemuanDate, validPengingatJam } = require('../middleware/validate');
const { readJson } = require('../middleware/http');
const { normalisasiPertemuan, pertemuanScopeWhere, canManagePertemuan, generusInScope } = require('../models/scope');
const { JENJANG, TINGKAT_PERTEMUAN, STATUS_ABSENSI, MANUAL_ALPHABET } = require('../config');

async function createPertemuan(req, res, auth) {
  const body = await readJson(req);
  const tingkat = body.tingkat;

  if (!TINGKAT_PERTEMUAN.has(tingkat)) {
    fail(400, 'Tingkat pertemuan tidak valid.');
  }

  const kelompokId = optionalId(body.kelompok_id, 'Kelompok');
  const desaId = optionalId(body.desa_id, 'Desa');

  if (
    !Array.isArray(body.jenjang) ||
    body.jenjang.length === 0 ||
    !body.jenjang.every((jenjang) => JENJANG.has(jenjang))
  ) {
    fail(400, 'Jenjang pertemuan tidak valid.');
  }

  const jenjang = [...new Set(body.jenjang)];
  const tanggal = validPertemuanDate(body.tanggal);
  const pengingatJam = validPengingatJam(body.pengingat_jam);

  const validScope =
    (tingkat === 'kelompok' && kelompokId !== null && desaId === null) ||
    (tingkat === 'desa' && desaId !== null && kelompokId === null) ||
    (tingkat === 'daerah' && kelompokId === null && desaId === null);

  if (!validScope) fail(400, 'Wilayah tidak sesuai dengan tingkat pertemuan.');

  canManagePertemuan(auth, {
    tingkat,
    kelompok_id: kelompokId,
    desa_id: desaId,
  });

  let result;
  try {
    result = await db.query(
      `INSERT INTO pertemuan
         (tingkat, kelompok_id, desa_id, jenjang_target, tanggal, pengingat_jam, dibuat_oleh)
       VALUES ($1, $2, $3, $4::jenjang_generus[], $5::date, $7, $6)
       RETURNING *`,
      [tingkat, kelompokId, desaId, jenjang, tanggal, auth.user.id, pengingatJam]
    );
  } catch (error) {
    if (error.code === '23503') fail(400, 'Wilayah atau pengguna tidak ditemukan.');
    throw error;
  }

  sendJson(res, 201, { pertemuan: normalisasiPertemuan(result.rows[0]) });
}

async function listPertemuan(res, auth, url) {
  const tingkat = url.searchParams.get('tingkat');
  const tanggalValue = url.searchParams.get('tanggal');

  if (tingkat !== null && !TINGKAT_PERTEMUAN.has(tingkat)) {
    fail(400, 'Tingkat pertemuan tidak valid.');
  }

  const tanggal = tanggalValue === null ? null : validPertemuanDate(tanggalValue);
  const scope = pertemuanScopeWhere(auth);

  const result = await db.query(
    `SELECT p.*
     FROM pertemuan p
     WHERE ${scope.sql}
       AND ($4::text IS NULL OR p.tingkat = $4::text)
       AND ($5::date IS NULL OR p.tanggal = $5::date)
     ORDER BY p.tanggal DESC, p.id DESC`,
    [...scope.values, tingkat, tanggal]
  );

  sendJson(res, 200, { pertemuan: result.rows.map(normalisasiPertemuan) });
}

async function getPertemuan(res, auth, id) {
  const scope = pertemuanScopeWhere(auth);
  const result = await db.query(
    `SELECT p.*
     FROM pertemuan p
     WHERE ${scope.sql} AND p.id = $4`,
    [...scope.values, id]
  );

  if (result.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');

  const ringkasan = await db.query(
    `SELECT
       (count(*) FILTER (WHERE status = 'hadir'))::integer AS hadir,
       (count(*) FILTER (WHERE status = 'izin'))::integer AS izin,
       (count(*) FILTER (WHERE status = 'sakit'))::integer AS sakit,
       (count(*) FILTER (WHERE status = 'alfa'))::integer AS alfa
     FROM absensi
     WHERE pertemuan_id = $1`,
    [id]
  );

  sendJson(res, 200, {
    pertemuan: normalisasiPertemuan(result.rows[0]),
    ringkasan: ringkasan.rows[0],
  });
}

async function updatePertemuan(req, res, auth, id) {
  const client = await db.getClient();
  let pertemuan;

  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');

    const found = await client.query(
      'SELECT * FROM pertemuan WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (found.rowCount !== 1) {
      fail(404, 'Pertemuan tidak ditemukan.');
    }

    pertemuan = found.rows[0];
    canManagePertemuan(auth, pertemuan);

    if (pertemuan.selesai_pada !== null) {
      fail(409, 'Pertemuan sudah selesai.');
    }

    const body = await readJson(req);

    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      fail(400, 'Data perubahan tidak valid.');
    }

    const hasTanggal = Object.hasOwn(body, 'tanggal');
    const hasJenjang = Object.hasOwn(body, 'jenjang');
    const hasPengingatJam = Object.hasOwn(body, 'pengingat_jam');

    if (!hasTanggal && !hasJenjang && !hasPengingatJam) {
      fail(400, 'Tidak ada yang diubah.');
    }

    if (Object.keys(body).some((key) => !['tanggal', 'jenjang', 'pengingat_jam'].includes(key))) {
      fail(400, 'Hanya tanggal, jenjang, dan pengingat yang boleh diubah.');
    }

    const columns = [];
    const values = [];

    if (hasTanggal) {
      values.push(validPertemuanDate(body.tanggal));
      columns.push(`tanggal = $${values.length}::date`);
    }

    if (hasJenjang) {
      if (
        !Array.isArray(body.jenjang) ||
        body.jenjang.length === 0 ||
        !body.jenjang.every((jenjang) => JENJANG.has(jenjang))
      ) {
        fail(400, 'Jenjang pertemuan tidak valid.');
      }

      values.push([...new Set(body.jenjang)]);
      columns.push(`jenjang_target = $${values.length}::jenjang_generus[]`);
    }

    if (hasPengingatJam) {
      values.push(validPengingatJam(body.pengingat_jam));
      columns.push(`pengingat_jam = $${values.length}`);
    }

    columns.push('updated_at = now()');
    values.push(id);

    // Nama kolom berasal dari konstanta di atas; data selalu parameter.
    const result = await client.query(
      `UPDATE pertemuan
       SET ${columns.join(', ')}
       WHERE id = $${values.length}
       RETURNING *`,
      values
    );

    pertemuan = result.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  sendJson(res, 200, { pertemuan: normalisasiPertemuan(pertemuan) });
}

async function deletePertemuan(res, auth, id) {
  const client = await db.getClient();

  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');

    const found = await client.query(
      'SELECT * FROM pertemuan WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (found.rowCount !== 1) {
      fail(404, 'Pertemuan tidak ditemukan.');
    }

    const pertemuan = found.rows[0];
    canManagePertemuan(auth, pertemuan);

    if (pertemuan.selesai_pada !== null) {
      fail(409, 'Pertemuan sudah selesai.');
    }

    const absensi = await client.query(
      'SELECT 1 FROM absensi WHERE pertemuan_id = $1 LIMIT 1',
      [id]
    );

    if (absensi.rowCount !== 0) {
      fail(409, 'Pertemuan sudah memiliki absensi.');
    }

    await client.query('DELETE FROM pertemuan WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');

    if (error.code === '23503') {
      fail(409, 'Pertemuan masih memiliki data terkait.');
    }

    throw error;
  } finally {
    client.release();
  }

  sendJson(res, 200, { ok: true });
}

async function listAbsensi(res, auth, id, url) {
  const scope = pertemuanScopeWhere(auth);
  const pertemuan = await db.query(
    `SELECT p.id
     FROM pertemuan p
     WHERE ${scope.sql} AND p.id = $4`,
    [...scope.values, id]
  );

  if (pertemuan.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');

  const result = await db.query(
    `SELECT a.id, a.pertemuan_id, a.generus_id, a.status, a.dicatat_oleh,
            a.koreksi_count, a.created_at, a.updated_at,
            g.nama, g.kelas_sekolah, g.jenjang
     FROM absensi a
     JOIN generus g ON g.id = a.generus_id
     WHERE a.pertemuan_id = $1
     ORDER BY g.nama, g.id`,
    [id]
  );

  sendJson(res, 200, { absensi: result.rows });
}

async function daftarPertemuan(res, auth, id) {
  const existing = await db.query(
    'SELECT * FROM pertemuan WHERE id = $1',
    [id]
  );
  if (existing.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');

  const pertemuan = existing.rows[0];
  try {
    canManagePertemuan(auth, pertemuan);
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) {
      fail(404, 'Pertemuan tidak ditemukan.');
    }
    throw error;
  }

  // CATATAN KEAMANAN: respons memuat kode_manual dan qr_token,
  // sama dengan data cetak-qr untuk pengurus yang sama.
  // Hanya pengurus yang lolos canManagePertemuan boleh mengunduhnya.
  const result = await db.query(
    `SELECT g.id, g.nama, g.kelas_sekolah, g.jenjang,
            g.kode_manual, g.qr_token
     FROM generus g
     JOIN kelompok k ON k.id = g.kelompok_id
     WHERE g.status = 'approved'
       AND g.jenjang = ANY($1::jenjang_generus[])
       AND (
         ($2::text = 'kelompok' AND g.kelompok_id = $3::integer)
         OR ($2::text = 'desa' AND k.desa_id = $4::integer)
         OR $2::text = 'daerah'
       )
     ORDER BY g.nama, g.id`,
    [
      pertemuan.jenjang_target, pertemuan.tingkat,
      pertemuan.kelompok_id, pertemuan.desa_id,
    ]
  );

  sendJson(res, 200, {
    pertemuan: normalisasiPertemuan(pertemuan),
    generus: result.rows,
  });
}

async function recordAbsen(req, res, auth, id) {
  const existing = await db.query(
    'SELECT * FROM pertemuan WHERE id = $1',
    [id]
  );

  if (existing.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');
  canManagePertemuan(auth, existing.rows[0]);

  const body = await readJson(req);
  if (typeof body.kode !== 'string') fail(404, 'Kode tidak ditemukan.');

  const kode = body.kode.trim();
  let qrToken = null;
  let kodeManual = null;

  if (/^[a-fA-F0-9]{32}$/.test(kode)) {
    qrToken = kode.toLowerCase();
  } else if (
    kode.length === 6 &&
    Array.from(kode).every((karakter) => MANUAL_ALPHABET.includes(karakter))
  ) {
    kodeManual = kode;
  } else {
    fail(404, 'Kode tidak ditemukan.');
  }

  const client = await db.getClient();
  let absensi;

  try {
    await client.query('BEGIN');

    const locked = await client.query(
      'SELECT * FROM pertemuan WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (locked.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');
    const pertemuan = locked.rows[0];
    canManagePertemuan(auth, pertemuan);

    const found = await client.query(
      `SELECT id
       FROM generus
       WHERE status = 'approved'
         AND (
           ($1::text IS NOT NULL AND qr_token = $1::text)
           OR ($2::text IS NOT NULL AND kode_manual = $2::text)
         )`,
      [qrToken, kodeManual]
    );

    if (found.rowCount !== 1) fail(404, 'Kode tidak ditemukan.');

    const generus = await generusInScope(pertemuan, found.rows[0].id, client);
    if (!generus) fail(404, 'Kode tidak ditemukan.');

    if (pertemuan.selesai_pada !== null) fail(409, 'Gunakan koreksi.');

    const result = await client.query(
      `INSERT INTO absensi (pertemuan_id, generus_id, status, dicatat_oleh)
       VALUES ($1, $2, 'hadir', $3)
       ON CONFLICT (pertemuan_id, generus_id)
       DO UPDATE SET status = EXCLUDED.status,
                     dicatat_oleh = EXCLUDED.dicatat_oleh,
                     updated_at = now()
       RETURNING id, pertemuan_id, generus_id, status, dicatat_oleh,
                 koreksi_count, created_at, updated_at`,
      [id, generus.id, auth.user.id]
    );

    absensi = result.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  sendJson(res, 200, { absensi });
}

async function recordAbsenManual(req, res, auth, id) {
  const existing = await db.query(
    'SELECT * FROM pertemuan WHERE id = $1',
    [id]
  );

  if (existing.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');
  canManagePertemuan(auth, existing.rows[0]);

  const body = await readJson(req);
  const generusId = positiveId(body.generus_id, 'Generus');
  const status = body.status;

  if (!STATUS_ABSENSI.has(status) || status === 'alfa') {
    fail(400, 'Status absensi manual harus hadir, izin, atau sakit.');
  }

  const client = await db.getClient();
  let absensi;

  try {
    await client.query('BEGIN');

    const locked = await client.query(
      'SELECT * FROM pertemuan WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (locked.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');
    const pertemuan = locked.rows[0];
    canManagePertemuan(auth, pertemuan);

    const generus = await generusInScope(pertemuan, generusId, client);
    if (!generus) fail(404, 'Generus tidak ditemukan dalam lingkup pertemuan.');

    if (pertemuan.selesai_pada !== null) fail(409, 'Gunakan koreksi.');

    const result = await client.query(
      `INSERT INTO absensi (pertemuan_id, generus_id, status, dicatat_oleh)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (pertemuan_id, generus_id)
       DO UPDATE SET status = EXCLUDED.status,
                     dicatat_oleh = EXCLUDED.dicatat_oleh,
                     updated_at = now()
       RETURNING id, pertemuan_id, generus_id, status, dicatat_oleh,
                 koreksi_count, created_at, updated_at`,
      [id, generus.id, status, auth.user.id]
    );

    absensi = result.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  sendJson(res, 200, { absensi });
}

async function syncAbsensi(req, res, auth, id) {
  const existing = await db.query(
    'SELECT * FROM pertemuan WHERE id = $1',
    [id]
  );
  if (existing.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');
  canManagePertemuan(auth, existing.rows[0]);
  if (existing.rows[0].selesai_pada !== null) {
    fail(409, 'Pertemuan sudah selesai. Gunakan koreksi.');
  }

  const body = await readJson(req);
  if (
    !Array.isArray(body.items) ||
    body.items.length < 1 ||
    body.items.length > 200
  ) {
    fail(400, 'Daftar antrean tidak valid.');
  }

  const hasil = [];
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      'SELECT * FROM pertemuan WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (locked.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');

    const pertemuan = locked.rows[0];
    canManagePertemuan(auth, pertemuan);
    if (pertemuan.selesai_pada !== null) {
      fail(409, 'Pertemuan sudah selesai. Gunakan koreksi.');
    }

    for (const item of body.items) {
      let generusId;
      try {
        if (
          !item ||
          typeof item !== 'object' ||
          Array.isArray(item) ||
          !['hadir', 'izin', 'sakit'].includes(item.status) ||
          typeof item.client_id !== 'string' ||
          item.client_id.length < 1 ||
          item.client_id.length > 64 ||
          item.client_id.trim().length === 0 ||
          item.client_id.includes('\u0000')
        ) {
          fail(400, 'Data antrean tidak valid.');
        }
        generusId = positiveId(item.generus_id);
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 400) {
          throw error;
        }
        hasil.push({
          generus_id: item?.generus_id ?? null,
          diterima: false,
          alasan: 'Data antrean tidak valid.',
        });
        continue;
      }

      let dicatatPada = null;
      if (
        typeof item.dicatat_pada === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
          item.dicatat_pada
        )
      ) {
        const waktu = Date.parse(item.dicatat_pada);
        if (
          Number.isFinite(waktu) &&
          waktu <= Date.now() + 24 * 60 * 60 * 1000
        ) {
          dicatatPada = new Date(waktu).toISOString();
        }
      }

      const duplikat = await client.query(
        `SELECT status FROM sync_items
         WHERE pertemuan_id = $1 AND client_id = $2`,
        [id, item.client_id]
      );
      if (duplikat.rowCount > 0) {
        hasil.push({
          generus_id: generusId,
          diterima: true,
          sudah_ada: true,
          status: duplikat.rows[0].status,
        });
        continue;
      }

      const generus = await generusInScope(pertemuan, generusId, client);
      if (!generus) {
        hasil.push({
          generus_id: generusId,
          diterima: false,
          alasan: 'Generus tidak ditemukan dalam lingkup pertemuan.',
        });
        continue;
      }

      const sebelumnya = await client.query(
        `SELECT status FROM absensi
         WHERE pertemuan_id = $1 AND generus_id = $2
         FOR UPDATE`,
        [id, generusId]
      );

      let statusAkhir;
      if (sebelumnya.rowCount === 0) {
        await client.query(
          `INSERT INTO absensi
             (pertemuan_id, generus_id, status, dicatat_oleh, dicatat_pada)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, generusId, item.status, auth.user.id, dicatatPada]
        );
        statusAkhir = item.status;
      } else {
        statusAkhir = sebelumnya.rows[0].status;
        if (statusAkhir !== 'hadir' && item.status === 'hadir') {
          await client.query(
            `UPDATE absensi
             SET status = 'hadir',
                 dicatat_oleh = $3,
                 dicatat_pada = $4,
                 updated_at = now()
             WHERE pertemuan_id = $1 AND generus_id = $2`,
            [id, generusId, auth.user.id, dicatatPada]
          );
          statusAkhir = 'hadir';
        }
      }

      await client.query(
        `INSERT INTO sync_items
           (pertemuan_id, generus_id, client_id, status,
            dicatat_pada, dicatat_oleh)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id, generusId, item.client_id, statusAkhir,
          dicatatPada, auth.user.id,
        ]
      );

      hasil.push({
        generus_id: generusId,
        diterima: true,
        status: statusAkhir,
      });
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  sendJson(res, 200, { hasil });
}

async function selesaiPertemuan(res, auth, id) {
  const existing = await db.query(
    'SELECT * FROM pertemuan WHERE id = $1',
    [id]
  );

  if (existing.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');
  canManagePertemuan(auth, existing.rows[0]);

  const client = await db.getClient();
  let pertemuan;
  let alfaDitandai;

  try {
    await client.query('BEGIN');

    const locked = await client.query(
      'SELECT * FROM pertemuan WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (locked.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');
    const current = locked.rows[0];
    canManagePertemuan(auth, current);

    if (current.selesai_pada !== null) {
      fail(409, 'Pertemuan sudah selesai.');
    }

    const updated = await client.query(
      `UPDATE pertemuan
       SET selesai_pada = now(), updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    const alfa = await client.query(
      `INSERT INTO absensi (pertemuan_id, generus_id, status, dicatat_oleh)
       SELECT $1, g.id, 'alfa', $2
       FROM generus g
       JOIN kelompok k ON k.id = g.kelompok_id
       WHERE g.status = 'approved'
         AND g.jenjang = ANY($3::jenjang_generus[])
         AND (
           ($4::text = 'kelompok' AND g.kelompok_id = $5::integer)
           OR ($4::text = 'desa' AND k.desa_id = $6::integer)
           OR $4::text = 'daerah'
         )
         AND NOT EXISTS (
           SELECT 1 FROM absensi a
           WHERE a.pertemuan_id = $1 AND a.generus_id = g.id
         )`,
      [
        id, auth.user.id, current.jenjang_target, current.tingkat,
        current.kelompok_id, current.desa_id,
      ]
    );

    pertemuan = updated.rows[0];
    alfaDitandai = alfa.rowCount;

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  sendJson(res, 200, { pertemuan: normalisasiPertemuan(pertemuan), alfa_ditandai: alfaDitandai });
}

async function linkIzin(res, auth, id) {
  const hasilPertemuan = await db.query(
    'SELECT * FROM pertemuan WHERE id = $1',
    [id]
  );

  if (!hasilPertemuan.rows[0]) {
    fail(404, 'Pertemuan tidak ditemukan.');
  }

  const pertemuan = hasilPertemuan.rows[0];
  canManagePertemuan(auth, pertemuan);

  let token = pertemuan.izin_token;

  for (let percobaan = 0; token === null && percobaan < 10; percobaan += 1) {
    const calonToken = crypto.randomBytes(16).toString('hex');

    try {
      const hasilUpdate = await db.query(
        `UPDATE pertemuan
         SET izin_token = $2, updated_at = now()
         WHERE id = $1 AND izin_token IS NULL
         RETURNING izin_token`,
        [id, calonToken]
      );

      if (hasilUpdate.rows[0]) {
        token = hasilUpdate.rows[0].izin_token;
      } else {
        const terbaru = await db.query(
          'SELECT * FROM pertemuan WHERE id = $1',
          [id]
        );

        if (!terbaru.rows[0]) {
          fail(404, 'Pertemuan tidak ditemukan.');
        }

        canManagePertemuan(auth, terbaru.rows[0]);
        token = terbaru.rows[0].izin_token;
      }
    } catch (error) {
      if (error.code !== '23505') {
        throw error;
      }
    }
  }

  if (token === null) {
    fail(500, 'Tautan izin belum berhasil dibuat. Silakan coba lagi.');
  }

  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 200, { url: '/izin.html?t=' + token });
}

async function linkIzinKelompok(res, auth, kelompokId) {
  res.setHeader('Cache-Control', 'no-store');

  function cekLingkup(kelompok) {
    const role = auth.user.role;

    if (role === 'admin' || role === 'daerah') {
      return;
    }

    if (
      role === 'desa' &&
      kelompok.desa_id === auth.user.desa_id
    ) {
      return;
    }

    if (
      role === 'kelompok' &&
      kelompok.id === auth.user.kelompok_id
    ) {
      return;
    }

    fail(403, 'Akses ditolak.');
  }

  const hasilKelompok = await db.query(
    'SELECT id, desa_id, izin_token FROM kelompok WHERE id = $1',
    [kelompokId]
  );

  if (!hasilKelompok.rows[0]) {
    fail(404, 'Kelompok tidak ditemukan.');
  }

  cekLingkup(hasilKelompok.rows[0]);
  let token = hasilKelompok.rows[0].izin_token;

  for (let percobaan = 0; token === null && percobaan < 10; percobaan += 1) {
    const calonToken = crypto.randomBytes(16).toString('hex');

    try {
      const hasilUpdate = await db.query(
        `UPDATE kelompok
         SET izin_token = $2
         WHERE id = $1 AND izin_token IS NULL
         RETURNING id, desa_id, izin_token`,
        [kelompokId, calonToken]
      );

      if (hasilUpdate.rows[0]) {
        cekLingkup(hasilUpdate.rows[0]);
        token = hasilUpdate.rows[0].izin_token;
      } else {
        const terbaru = await db.query(
          'SELECT id, desa_id, izin_token FROM kelompok WHERE id = $1',
          [kelompokId]
        );

        if (!terbaru.rows[0]) {
          fail(404, 'Kelompok tidak ditemukan.');
        }

        cekLingkup(terbaru.rows[0]);
        token = terbaru.rows[0].izin_token;
      }
    } catch (error) {
      if (error.code !== '23505') {
        throw error;
      }
    }
  }

  if (token === null) {
    fail(500, 'Tautan izin belum berhasil dibuat. Silakan coba lagi.');
  }

  sendJson(res, 200, { url: '/izin.html?t=' + token });
}

async function listIzin(res, auth, id) {
  const hasilPertemuan = await db.query(
    'SELECT * FROM pertemuan WHERE id = $1',
    [id]
  );

  if (!hasilPertemuan.rows[0]) {
    fail(404, 'Pertemuan tidak ditemukan.');
  }

  canManagePertemuan(auth, hasilPertemuan.rows[0]);

  const hasil = await db.query(
    `SELECT
       i.id,
       i.pertemuan_id,
       i.generus_id,
       g.nama,
       g.kelas_sekolah,
       i.alasan,
       i.keterangan,
       i.status,
       i.catatan_penolakan,
       i.created_at,
       i.diputuskan_pada
     FROM izin i
     JOIN generus g ON g.id = i.generus_id
     WHERE i.pertemuan_id = $1
     ORDER BY i.created_at, i.id`,
    [id]
  );

  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 200, { izin: hasil.rows });
}

async function setujuiIzin(req, res, auth, pertemuanId, izinId) {
  const hasilPertemuan = await db.query(
    'SELECT * FROM pertemuan WHERE id = $1',
    [pertemuanId]
  );

  if (!hasilPertemuan.rows[0]) {
    fail(404, 'Pertemuan tidak ditemukan.');
  }

  canManagePertemuan(auth, hasilPertemuan.rows[0]);

  const client = await db.getClient();
  let izin;
  let absensi;

  try {
    await client.query('BEGIN');

    const terkunci = await client.query(
      'SELECT * FROM pertemuan WHERE id = $1 FOR UPDATE',
      [pertemuanId]
    );

    if (!terkunci.rows[0]) {
      fail(404, 'Pertemuan tidak ditemukan.');
    }

    const pertemuan = normalisasiPertemuan(terkunci.rows[0]);
    canManagePertemuan(auth, pertemuan);

    if (pertemuan.selesai_pada !== null) {
      fail(409, 'Pertemuan sudah selesai. Gunakan koreksi.');
    }

    const hasilIzin = await client.query(
      `SELECT *
       FROM izin
       WHERE id = $1 AND pertemuan_id = $2
       FOR UPDATE`,
      [izinId, pertemuanId]
    );

    const pengajuan = hasilIzin.rows[0];

    if (!pengajuan) {
      fail(404, 'Izin tidak ditemukan.');
    }

    if (pengajuan.status !== 'menunggu') {
      fail(409, 'Izin sudah diputuskan.');
    }

    const generus = await generusInScope(
      pertemuan,
      pengajuan.generus_id,
      client
    );

    if (!generus) {
      fail(409, 'Generus tidak lagi termasuk peserta kegiatan ini.');
    }

    const hasilAbsensi = await client.query(
      `INSERT INTO absensi (
         pertemuan_id, generus_id, status, dicatat_oleh
       )
       VALUES ($1, $2, $3::status_absensi, $4)
       ON CONFLICT (pertemuan_id, generus_id)
       DO UPDATE SET
         status = EXCLUDED.status,
         dicatat_oleh = EXCLUDED.dicatat_oleh,
         updated_at = now()
       RETURNING *`,
      [
        pertemuanId,
        pengajuan.generus_id,
        pengajuan.alasan,
        auth.user.id
      ]
    );

    const hasilUpdate = await client.query(
      `UPDATE izin
       SET
         status = 'disetujui',
         diputuskan_oleh = $3,
         diputuskan_pada = now(),
         updated_at = now()
       WHERE id = $1 AND pertemuan_id = $2
       RETURNING *`,
      [izinId, pertemuanId, auth.user.id]
    );

    absensi = hasilAbsensi.rows[0];
    izin = hasilUpdate.rows[0];

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 200, { izin, absensi });
}

async function tolakIzin(req, res, auth, pertemuanId, izinId) {
  const hasilPertemuan = await db.query(
    'SELECT * FROM pertemuan WHERE id = $1',
    [pertemuanId]
  );

  if (!hasilPertemuan.rows[0]) {
    fail(404, 'Pertemuan tidak ditemukan.');
  }

  canManagePertemuan(auth, hasilPertemuan.rows[0]);

  const body = await readJson(req);

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail(400, 'Data penolakan tidak valid.');
  }

  let catatan = null;

  if (body.catatan !== undefined && body.catatan !== null) {
    if (typeof body.catatan !== 'string') {
      fail(400, 'Catatan harus berupa teks.');
    }

    if (body.catatan.trim() !== '') {
      catatan = requiredString(body.catatan, 'Catatan', 500);
    }
  }

  const client = await db.getClient();
  let izin;

  try {
    await client.query('BEGIN');

    const terkunci = await client.query(
      'SELECT * FROM pertemuan WHERE id = $1 FOR UPDATE',
      [pertemuanId]
    );

    if (!terkunci.rows[0]) {
      fail(404, 'Pertemuan tidak ditemukan.');
    }

    const pertemuan = terkunci.rows[0];
    canManagePertemuan(auth, pertemuan);

    if (pertemuan.selesai_pada !== null) {
      fail(409, 'Pertemuan sudah selesai. Gunakan koreksi.');
    }

    const hasilIzin = await client.query(
      `SELECT *
       FROM izin
       WHERE id = $1 AND pertemuan_id = $2
       FOR UPDATE`,
      [izinId, pertemuanId]
    );

    if (!hasilIzin.rows[0]) {
      fail(404, 'Izin tidak ditemukan.');
    }

    if (hasilIzin.rows[0].status !== 'menunggu') {
      fail(409, 'Izin sudah diputuskan.');
    }

    const hasilUpdate = await client.query(
      `UPDATE izin
       SET
         status = 'ditolak',
         catatan_penolakan = $3,
         diputuskan_oleh = $4,
         diputuskan_pada = now(),
         updated_at = now()
       WHERE id = $1 AND pertemuan_id = $2
       RETURNING *`,
      [izinId, pertemuanId, catatan, auth.user.id]
    );

    izin = hasilUpdate.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 200, { izin });
}

async function koreksiAbsensi(req, res, auth, pertemuanId, absensiId) {
  const existing = await db.query(
    'SELECT * FROM pertemuan WHERE id = $1',
    [pertemuanId]
  );

  if (existing.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');
  canManagePertemuan(auth, existing.rows[0]);

  const body = await readJson(req);
  const status = body.status;
  if (!STATUS_ABSENSI.has(status)) fail(400, 'Status absensi tidak valid.');

  const client = await db.getClient();
  let absensi;

  try {
    await client.query('BEGIN');

    const locked = await client.query(
      `SELECT id, koreksi_count
       FROM absensi
       WHERE id = $1 AND pertemuan_id = $2
       FOR UPDATE`,
      [absensiId, pertemuanId]
    );

    if (locked.rowCount !== 1) fail(404, 'Absensi tidak ditemukan.');

    // Diperiksa setelah memperoleh kunci, memakai waktu database saat ini.
    const meeting = await client.query(
      `SELECT p.*,
              clock_timestamp() <= p.selesai_pada + interval '24 hours'
                AS dalam_batas
       FROM pertemuan p
       WHERE p.id = $1`,
      [pertemuanId]
    );

    if (meeting.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');
    const pertemuan = meeting.rows[0];
    canManagePertemuan(auth, pertemuan);

    if (pertemuan.selesai_pada === null) {
      fail(409, 'Pertemuan belum selesai.');
    }
    if (!pertemuan.dalam_batas) {
      fail(409, 'Di luar batas 24 jam.');
    }
    if (locked.rows[0].koreksi_count !== 0) {
      fail(409, 'Sudah pernah dikoreksi.');
    }

    const result = await client.query(
      `UPDATE absensi
       SET status = $1, koreksi_count = 1,
           dicatat_oleh = $2, updated_at = now()
       WHERE id = $3 AND pertemuan_id = $4
       RETURNING id, pertemuan_id, generus_id, status, dicatat_oleh,
                 koreksi_count, created_at, updated_at`,
      [status, auth.user.id, absensiId, pertemuanId]
    );

    absensi = result.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  sendJson(res, 200, { absensi });
}

module.exports = {
  createPertemuan, listPertemuan, getPertemuan, updatePertemuan,
  deletePertemuan, listAbsensi, daftarPertemuan, recordAbsen,
  recordAbsenManual, syncAbsensi, selesaiPertemuan, linkIzin,
  linkIzinKelompok, listIzin, setujuiIzin, tolakIzin, koreksiAbsensi,
};
