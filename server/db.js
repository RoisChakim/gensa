'use strict';

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL wajib diisi.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

module.exports = {
  query(text, params = []) {
    return pool.query(text, params);
  },

  getClient() {
    return pool.connect();
  },
};
