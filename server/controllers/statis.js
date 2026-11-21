'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fail } = require('../middleware/errors');
const { PUBLIC_DIR } = require('../config');

async function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    fail(400, 'Alamat tidak valid.');
  }

  if (
    decoded.includes('\0') ||
    decoded.includes('\\') ||
    decoded.split('/').some((part) => part === '.' || part === '..')
  ) {
    fail(404, 'Halaman tidak ditemukan.');
  }

  const extension = path.extname(decoded).toLowerCase();
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/manifest+json',
    '.png': 'image/png',
  };

  if (!contentTypes[extension]) fail(404, 'Halaman tidak ditemukan.');

  const requested = path.resolve(PUBLIC_DIR, `.${decoded}`);
  if (!requested.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    fail(404, 'Halaman tidak ditemukan.');
  }

  let realPath;
  try {
    realPath = await fs.promises.realpath(requested);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      fail(404, 'Halaman tidak ditemukan.');
    }
    throw error;
  }

  const realPublicDir = await fs.promises.realpath(PUBLIC_DIR);
  if (!realPath.startsWith(`${realPublicDir}${path.sep}`)) {
    fail(404, 'Halaman tidak ditemukan.');
  }

  let content;
  try {
    content = await fs.promises.readFile(realPath);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      fail(404, 'Halaman tidak ditemukan.');
    }
    throw error;
  }

  res.writeHead(200, {
    'Content-Type': contentTypes[extension],
    'Content-Length': content.length,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
  });
  res.end(content);
}

module.exports = { serveStatic };
