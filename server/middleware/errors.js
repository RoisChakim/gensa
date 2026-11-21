'use strict';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new HttpError(status, message);
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

function sendError(res, error) {
  if (res.headersSent || res.destroyed) return;

  if (error instanceof HttpError) {
    sendJson(res, error.status, { error: error.message });
    return;
  }

  console.error('Terjadi kesalahan saat memproses permintaan.');
  sendJson(res, 500, { error: 'Terjadi kesalahan pada server.' });
}

module.exports = { HttpError, fail, sendJson, sendError };
