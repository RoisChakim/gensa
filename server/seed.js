'use strict';

const { Client } = require('pg');
const bcrypt = require('bcryptjs');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@gensa.local')
    .trim()
    .toLowerCase();

  if (!databaseUrl || !adminPassword || !adminPassword.trim() || !adminEmail) {
    throw new Error('DATABASE_URL, ADMIN_PASSWORD, dan email admin wajib diisi.');
  }

  // Bcrypt hanya memakai 72 byte pertama; tolak agar password tidak terpotong.
  if (Buffer.byteLength(adminPassword, 'utf8') > 72) {
    throw new Error('ADMIN_PASSWORD tidak boleh melebihi 72 byte.');
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      'INSERT INTO daerah (nama) VALUES ($1) ON CONFLICT DO NOTHING',
      ['Daerah Contoh']
    );

    const daerahResult = await client.query(
      'SELECT id FROM daerah WHERE nama = $1',
      ['Daerah Contoh']
    );
    const daerahId = daerahResult.rows[0].id;

    const organisasi = [
      ['Desa Contoh 1', 'Kelompok Contoh A'],
      ['Desa Contoh 2', 'Kelompok Contoh B'],
      ['Desa Contoh 3', 'Kelompok Contoh C'],
    ];

    for (const [namaDesa, namaKelompok] of organisasi) {
      await client.query(
        'INSERT INTO desa (daerah_id, nama) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [daerahId, namaDesa]
      );

      const desaResult = await client.query(
        'SELECT id FROM desa WHERE daerah_id = $1 AND nama = $2',
        [daerahId, namaDesa]
      );

      await client.query(
        'INSERT INTO kelompok (desa_id, nama) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [desaResult.rows[0].id, namaKelompok]
      );
    }

    const adminResult = await client.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [adminEmail, passwordHash, 'admin']
    );

    // Konflik email tidak boleh diam-diam menghasilkan seed tanpa admin.
    if (adminResult.rowCount === 0) {
      const existingUser = await client.query(
        'SELECT role FROM users WHERE lower(email) = lower($1)',
        [adminEmail]
      );
      if (existingUser.rowCount !== 1 || existingUser.rows[0].role !== 'admin') {
        throw new Error('Email admin sudah digunakan oleh akun dengan peran lain.');
      }
    }

    await client.query('COMMIT');
    console.log('Seed selesai: 1 daerah, 3 desa, dan 3 kelompok contoh tersedia.');
    console.log(
      adminResult.rowCount === 1
        ? 'Akun admin dibuat; password wajib diganti saat login pertama.'
        : 'Akun admin sudah ada; kredensialnya tidak diubah.'
    );
    console.log('Seed tidak menambahkan data generus.');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Pertahankan kegagalan awal tanpa menampilkan detail database.
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const knownMessages = new Set([
    'DATABASE_URL, ADMIN_PASSWORD, dan email admin wajib diisi.',
    'ADMIN_PASSWORD tidak boleh melebihi 72 byte.',
    'Email admin sudah digunakan oleh akun dengan peran lain.',
  ]);

  console.error(
    knownMessages.has(error.message)
      ? error.message
      : 'Seed gagal. Periksa konfigurasi dan pastikan migrasi sudah dijalankan.'
  );
  process.exitCode = 1;
});
