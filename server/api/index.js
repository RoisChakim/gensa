'use strict';

// Entri serverless Vercel: teruskan (req, res) mentah ke handler yang sama
// dengan yang dipakai server HTTP lokal (server/index.js mengekspor
// handler dan hanya listen bila dijalankan langsung).
module.exports = require('../index.js');
