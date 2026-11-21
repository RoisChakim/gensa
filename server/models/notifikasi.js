'use strict';

async function buatNotifikasi(client, {
  userId,
  jenis,
  generusId,
  generusNama,
  judul,
  pesan,
}) {
  await client.query(
    `INSERT INTO notifikasi
       (user_id, jenis, generus_id, generus_nama, judul, pesan)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, jenis, generusId, generusNama, judul, pesan]
  );
}

module.exports = { buatNotifikasi };
