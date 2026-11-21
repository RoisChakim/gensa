'use strict';

const http = require('node:http');
const { PORT } = require('./config');
const { sendError } = require('./middleware/errors');
const { handle } = require('./routes');

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => sendError(res, error));
});

// Jalan sebagai proses HTTP hanya bila berkas ini dijalankan langsung
// (node server/index.js). Bila di-require (mis. dari serverless function
// Vercel), jangan listen — pemanggil yang meneruskan (req, res).
if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Server GENSA berjalan di http://127.0.0.1:${PORT}`);
  });
}

module.exports = (req, res) => {
  handle(req, res).catch((error) => sendError(res, error));
};
