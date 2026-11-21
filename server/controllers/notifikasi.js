'use strict';

const db = require('../db');
const { fail, sendJson } = require('../middleware/errors');
const { positiveId } = require('../middleware/validate');

async function listNotifikasi(req, res, auth) {
  const params = new URL(req.url, 'http://localhost').searchParams;

  if (
    params.getAll('belum_dibaca').length > 1 ||
    params.getAll('batas').length > 1
  ) {
    fail(400, 'Parameter pemberitahuan tidak boleh berulang.');
  }

  const belumDibaca = params.get('belum_dibaca');
  if (belumDibaca !== null && belumDibaca !== '1') {
    fail(400, 'Parameter belum_dibaca harus bernilai 1.');
  }

  const batasInput = params.get('batas');
  let batas = 20;

  if (batasInput !== null) {
    if (!/^[1-9]\d*$/.test(batasInput)) {
      fail(400, 'Batas harus berupa bilangan bulat positif, maksimal 50.');
    }

    batas = Number(batasInput);
    if (!Number.isSafeInteger(batas) || batas > 50) {
      fail(400, 'Batas harus berupa bilangan bulat positif, maksimal 50.');
    }
  }

  const result = await db.query(
    `SELECT id, jenis, generus_id, generus_nama, judul, pesan,
            dibaca, created_at
     FROM notifikasi
     WHERE user_id = $1
       AND ($2::boolean = false OR dibaca = false)
     ORDER BY dibaca ASC, created_at DESC, id DESC
     LIMIT $3`,
    [auth.user.id, belumDibaca === '1', batas]
  );

  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 200, { notifikasi: result.rows });
}

async function hitungBelumDibaca(res, auth) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS belum_dibaca
     FROM notifikasi
     WHERE user_id = $1 AND dibaca = false`,
    [auth.user.id]
  );

  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 200, { belum_dibaca: result.rows[0].belum_dibaca });
}

async function tandaiDibaca(req, res, auth, id) {
  const result = await db.query(
    `UPDATE notifikasi
     SET dibaca = true
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [positiveId(id), auth.user.id]
  );

  if (result.rowCount !== 1) {
    fail(404, 'Notifikasi tidak ditemukan.');
  }

  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 200, { ok: true });
}

async function tandaiSemuaDibaca(res, auth) {
  const result = await db.query(
    `UPDATE notifikasi
     SET dibaca = true
     WHERE user_id = $1 AND dibaca = false`,
    [auth.user.id]
  );

  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 200, { ok: true, diubah: result.rowCount });
}

// pg mengembalikan kolom jenjang_generus[] sebagai string '{a,b}'
// karena OID array enum kustom tidak dikenal parser bawaannya.
// Ubah ke array JS supaya respons API konsisten.

module.exports = {
  listNotifikasi, hitungBelumDibaca, tandaiDibaca, tandaiSemuaDibaca,
};
