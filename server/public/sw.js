const CACHE_NAME = 'gensa-v1';
const CORE = [
  '/',
  '/login.html',
  '/jadwal.html',
  '/cetak-qr.html',
  '/laporan.html',
  '/scan.html',
  '/materi.html',
  '/reset-password.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/jsQR.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(
        CORE.map((url) => cache.add(url))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;

    let response;
    try {
      response = await fetch(event.request);
    } catch (error) {
      if (event.request.mode === 'navigate') {
        const fallback = await cache.match('/login.html');
        if (fallback) return fallback;
      }
      throw error;
    }

    if (response.status === 200 && response.type === 'basic') {
      try {
        await cache.put(event.request, response.clone());
      } catch {
        // Respons jaringan tetap dikembalikan jika penyimpanan cache gagal.
      }
    }

    return response;
  })());
});
