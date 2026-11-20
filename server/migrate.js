'use strict';
// Runner migrasi GENSA (ditambahkan Muse, 2026-11-20).
// Jalankan: DATABASE_URL=... node server/migrate.js
// Menjalankan semua file .sql di server/migrations/ secara berurutan.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL wajib diisi.');
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query(sql);
      console.log('Migrasi OK:', file);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Migrasi gagal:', error.message);
  process.exitCode = 1;
});
