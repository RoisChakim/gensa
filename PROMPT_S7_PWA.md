# Sesi 7 — PWA + Halaman Reset Password (GENSA, PRD §12)

## Konteks

Repo: `~/workspace/gensa-repo`. Server Node.js (stdlib http + `pg`),
port 3101, file `server/index.js`. Halaman statis di
`server/public/`, disajikan oleh `serveStatic` (hanya ekstensi
`.html`, `.css`, `.js` — lihat kutipan di bawah; CSP:
`script-src 'self' 'unsafe-inline'`).

Sesi 1–6 selesai dan lolos smoke test (akun/peran, QR + absensi,
jadwal, laporan Word, scan HP kamera, materi & penilaian).
Endpoint reset password SUDAH ada sejak Sesi 1
(`POST /api/reset-password` {email} → 200 `{ ok: true }`,
tautan reset hanya dicatat di log server; `POST
/api/reset-password/confirm` {token, new_password} (min 8
karakter) → 200 `{ ok: true }`, token berlaku 1 jam) — yang
belum ada hanya HALAMAN-nya.

Aturan: perubahan terkecil yang lengkap. Jangan masukkan rahasia
ke kode. Bahasa Indonesia yang natural. Palet GENSA: krem
`#F6F1E9`, coklat `#8A5A33`, sage `#5F7A57/#7C9A6E`. Halaman HTML:
pakai `textContent`/`createElement` saja, jangan `innerHTML`
dengan data dari server. Validasi di server, jangan percaya
input klien.

Ikon PWA **sudah dibuat** (Muse): `server/public/icon-192.png`
dan `server/public/icon-512.png` (huruf G krem di atas coklat
`#8A5A33`, sesuai logo GENSA).

## Tugas 1 — `server/public/manifest.json` (file baru)

```json
{
  "name": "GENSA — Sistem Manajemen Generus",
  "short_name": "GENSA",
  "description": "Kelola generus, absensi QR, jadwal, dan penilaian.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#F6F1E9",
  "theme_color": "#8A5A33",
  "lang": "id",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

## Tugas 2 — `server/public/sw.js` (file baru)

Service worker, cache-first untuk aset statis, network-only
untuk API:

- `const CACHE_NAME = 'gensa-v1';`
- `const CORE = ['/', '/login.html', '/jadwal.html',
  '/cetak-qr.html', '/laporan.html', '/scan.html',
  '/materi.html', '/reset-password.html', '/manifest.json',
  '/icon-192.png', '/icon-512.png', '/jsQR.js'];`
- `install`: `event.waitUntil(caches.open(CACHE_NAME).then(
  (cache) => cache.addAll(CORE)).then(() => self.skipWaiting()))`.
  Bila satu aset gagal di-cache, jangan gagalkan seluruh
  install (tangkap error per aset — pakai `Promise.allSettled`
  atau `cache.add` satu per satu dalam try/catch).
- `activate`: hapus semua cache yang namanya bukan
  `CACHE_NAME`, lalu `self.clients.claim()`.
- `fetch`: hanya tangani `GET`. Bila URL diawali `/api/` →
  teruskan ke network apa adanya (jangan cache, jangan baca
  cache). Selain itu: cari di cache dulu; bila ada, kembalikan;
  bila tidak ada, ambil dari network, simpan salinannya ke
  cache (hanya bila respons `status === 200` dan
  `type === 'basic'`), lalu kembalikan. Bila network gagal dan
  tidak ada di cache: bila `event.request.mode === 'navigate'`,
  kembalikan cache `/login.html`; bila bukan navigasi,
  teruskan error-nya (biarkan gagal).

## Tugas 3 — Perluas `serveStatic` di `server/index.js`

Tambahkan ke peta `contentTypes` (lihat kutipan di bawah):

```js
'.json': 'application/manifest+json',
'.png': 'image/png',
```

Jangan ubah logika lain di `serveStatic`.

## Tugas 4 — `server/public/reset-password.html` (file baru)

Baca dulu `server/public/login.html` dan ikuti gaya +
strukturnya (palet, form, pesan). Dua keadaan dalam satu
halaman (pilih dari `new URLSearchParams(location.search).get('token')`):

- **Tanpa token:** judul "Lupa Password", form email + tombol
  "Kirim tautan reset" → `POST /api/reset-password`
  `{ email }` → selalu tampilkan pesan yang sama persis dengan
  pesan server: "Jika akun tersedia, petunjuk reset akan
  disiapkan." (jangan bocorkan apakah email terdaftar).
  Tautan kembali ke `/login.html`.
- **Dengan token:** judul "Atur Password Baru", form password
  baru (min 8 karakter) + konfirmasi password + tombol "Simpan
  password baru" → cek kedua password sama di halaman dulu →
  `POST /api/reset-password/confirm` `{ token, new_password }`
  → sukses: tampilkan "Password berhasil diubah. Silakan masuk."
  + tautan ke `/login.html`; gagal: tampilkan pesan error dari
  server.
- `fetch` dengan `credentials: 'same-origin'`,
  `Content-Type: 'application/json'`. Pesan error/sukses lewat
  `textContent` pada elemen `role="status"`.

## Tugas 5 — Pasang PWA di semua halaman

Untuk tiap halaman `login.html`, `jadwal.html`,
`cetak-qr.html`, `laporan.html`, `scan.html`, `materi.html`,
`reset-password.html` (baca tiap file dulu sebelum mengubah):

- Di `<head>`, tepat setelah `<title>...</title>`: tambahkan
  `<link rel="manifest" href="/manifest.json">`. Bila halaman
  itu belum punya `<meta name="theme-color" ...>`, tambahkan
  juga `<meta name="theme-color" content="#8A5A33">` di baris
  yang sama (lewati bila sudah ada — `scan.html` sudah punya).
- Tepat sebelum `</body>`, tambahkan blok ini (satu-satunya
  skrip tambahan; jangan ubah skrip halaman yang sudah ada):

```html
<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
</script>
```

- Khusus `login.html`: tambahkan tautan "Lupa password?"
  yang mengarah ke `/reset-password.html`, di bawah tombol
  masuk (di dalam/di bawah form login — sesuaikan dengan
  struktur form yang ada).

## Yang TIDAK dikerjakan di sesi ini

- Jangan buat smoke test — ditulis Muse setelah ini.
- Jangan sentuh login Google, absen offline, atau link izin.
- Jangan ubah endpoint reset password atau logika sesi.

## Kutipan kode yang sudah ada

`serveStatic` (peta tipe, `server/index.js` sekitar baris 1810):

```js
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};
```

## Format keluaran

Jawab HANYA dengan blok kode, satu blok per file/penyisipan,
dengan judul file dan penanda sisip yang persis:

**`server/public/manifest.json`** (file lengkap)

```json
...file...
```

**`server/public/sw.js`** (file lengkap)

```js
...file...
```

**`server/index.js` — tambahkan dua baris ke peta `contentTypes` di `serveStatic`**

```js
...baris...
```

**`server/public/reset-password.html`** (file lengkap)

```html
...file...
```

**Per halaman** (satu blok per halaman, sebut nama file dan
penanda sisipnya, hanya baris yang ditambah/diubah):

**`server/public/login.html` — setelah `<title>...</title>` dan sebelum `</body>`, plus tautan lupa password**

```html
...tambahan...
```

...dan seterusnya untuk `jadwal.html`, `cetak-qr.html`,
`laporan.html`, `scan.html`, `materi.html`,
`reset-password.html`.

Jangan sertakan penjelasan panjang di luar blok kode. Jangan
menjalankan tes atau mengakses file — Muse yang menulis file
dan menjalankan tes.
