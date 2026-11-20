# Sesi 5 — Scan QR pakai Kamera HP (GENSA)

## Konteks

Repo: `~/workspace/gensa-repo`. Server Node.js (stdlib http + `pg`),
port 3101, file `server/index.js`. Halaman statis di
`server/public/`, disajikan apa adanya (CSP: `script-src 'self'
'unsafe-inline'` — skrip lokal diizinkan, CDN tidak).

Sesi 1–4 selesai dan lolos smoke test (akun/peran, QR + absensi,
jadwal, laporan Word). **Sesi ini TIDAK mengubah backend sama
sekali** — endpoint absensi sudah ada dan dipakai halaman ini.

Aturan: perubahan terkecil yang lengkap. Jangan masukkan rahasia ke
kode. Bahasa Indonesia yang natural. Palet GENSA: krem `#F6F1E9`,
coklat `#8A5A33`, sage `#5F7A57/#7C9A6E`, tanpa gradasi, tanpa latar
gelap. Halaman HTML: pakai `textContent`/`createElement` saja,
jangan `innerHTML` dengan data dari server. Mobile-first, tombol
besar (min-height 44px).

Pustaka `jsQR` v1.4.0 **sudah di-vendor** ke
`server/public/jsQR.js` (UMD, global `jsQR`, 256 KB). Muat dengan
`<script src="/jsQR.js"></script>` sebelum skrip halaman.

## Tugas — Halaman `server/public/scan.html` (file lengkap, baru)

Halaman absensi dengan kamera HP untuk pengurus (kelompok/desa/
daerah/admin). Alur:

### 1. Pilih pertemuan
- Saat halaman dimuat: `GET /api/me` (bila 401 → alihkan ke
  `/login.html`), lalu `GET /api/pertemuan` → isi `<select>` dengan
  pertemuan yang `selesai_pada === null` (belum ditutup), urut
  tanggal menaik. Tiap opsi menampilkan tanggal (DD/MM/YYYY) +
  tingkat + jenjang (label Indonesia: Caberawit, Pra Remaja,
  Remaja, Usia Nikah).
- Bila tidak ada pertemuan yang bisa dipilih: tampilkan pesan
  "Belum ada jadwal pengajian yang dibuka." dan nonaktifkan tombol
  scan.
- Ganti pertemuan di tengah jalan: hentikan kamera bila sedang
  berjalan, kosongkan riwayat scan.

### 2. Scan kamera
- Tombol "Mulai Scan" → `navigator.mediaDevices.getUserMedia({
  video: { facingMode: 'environment' }, audio: false })` →
  tampilkan `<video autoplay playsinline muted>`. Tombol berubah
  jadi "Berhenti" (mematikan semua track).
- Loop scan: tiap ~200 ms gambar frame video ke `<canvas>`
  (ukuran mengikuti `video.videoWidth/videoHeight`, maksimal sisi
  panjang 640 px supaya ringan), ambil `ImageData`, panggil
  `jsQR(data, width, height)`. Bila ketemu kode, teruskan ke
  langkah 3. Bila `jsQR` tidak termuat (skrip gagal), tampilkan
  pesan kesalahan dan nonaktifkan scan (tapi input manual tetap
  jalan).
- **Cooldown:** kode yang sama persis tidak diproses ulang dalam
  3 detik (cegah dobel kirim saat QR masih di depan kamera).
- Penanganan gagal kamera (pesan jelas, bahasa natural):
  - `NotAllowedError` → "Izin kamera ditolak. Izinkan akses kamera
    di pengaturan browser, lalu coba lagi."
  - `NotFoundError`/`OverconstrainedError` → "Kamera tidak
    ditemukan di perangkat ini."
  - Bila `!window.isSecureContext` → tampilkan peringatan di atas
    halaman: "Kamera hanya bisa dipakai lewat HTTPS atau localhost.
    Buka halaman ini lewat alamat yang aman."
  - Gagal lain → "Kamera tidak bisa dipakai: <pesan>."
- Tampilkan bingkai panduan di atas video (kotak garis putus-putus
  di tengah, teks "Arahkan kamera ke QR generus").

### 3. Catat absen dari hasil scan
- Kirim `POST /api/pertemuan/:id/absen` dengan body JSON
  `{ kode: <teks hasil scan> }` (teks QR adalah `qr_token` mentah,
  32 karakter heksa — jangan diubah/dipotong).
- Respons sukses (200): `{ absensi: { generus_id, status, ... } }`
  — status selalu `hadir` untuk jalur ini. Ambil nama generus
  dengan `GET /api/pertemuan/:id/absensi` lalu cari baris dengan
  `generus_id` yang sama (respons berisi `nama` per baris).
  Tampilkan di panel hasil: "✓ Hadir tercatat — <nama>"
  (tanda ✓ sebagai teks, bukan emoji) + jam scan.
- Bila server menjawab 404 → tampilkan "Kode tidak dikenal.
  Pastikan QR-nya QR GENSA." Bila 403 → "Anda tidak punya akses
  ke pertemuan ini." Bila gagal lain → tampilkan pesan error dari
  server bila ada.
- Simpan riwayat scan di halaman (maksimal 5 terakhir, terbaru di
  atas): jam + nama + status. Jangan kirim ulang kode yang sudah
  tercatat sukses dalam sesi ini (tandai "sudah tercatat" bila
  kode yang sama ter-scan lagi).
- Selama satu permintaan absen sedang berjalan, jangan kirim
  permintaan lain (flag `sedangMengirim`).

### 4. Input manual (cadangan bila kamera tidak bisa)
- Di bawah video: input teks + tombol "Catat manual" → kirim ke
  endpoint yang sama (`{ kode: <isi input> }`), tampilkan hasil
  yang sama seperti hasil scan. Kosongkan input bila sukses.
- Tautan kecil ke `/cetak-qr.html` ("Cetak QR generus").

### 5. Struktur halaman
- Judul: "Scan Kehadiran". Penjelasan singkat di atas: "Arahkan
  kamera HP ke QR generus untuk mencatat hadir."
- Elemen: `<select id="pertemuan">`, `<video>` + `<canvas>`
  (canvas disembunyikan), tombol Mulai/Berhenti, panel hasil
  (`<p id="hasil" role="status" aria-live="polite">`), daftar
  riwayat (`<ul id="riwayat">`), form input manual.
- Ikuti konvensi `server/public/jadwal.html` / `laporan.html`
  (palet GENSA, `fetch` dengan `credentials: 'same-origin'`,
  `Accept: 'application/json'`, `Content-Type: 'application/json'`
  untuk POST).

## Kontrak endpoint (SUDAH ADA — jangan diubah, jangan ditebak ulang)

- `GET /api/me` → `{ user: { id, email, role, desa_id,
  kelompok_id, must_change_password } }`.
- `GET /api/pertemuan` → `{ pertemuan: [{ id, tingkat,
  kelompok_id, desa_id, jenjang_target: [...], tanggal:
  'YYYY-MM-DDT00:00:00.000Z', selesai_pada: null | timestamp,
  dibuat_oleh }] }`. `jenjang_target` sudah array JS.
- `POST /api/pertemuan/:id/absen`, body `{ kode }` → 200
  `{ absensi: { id, pertemuan_id, generus_id, status, ... } }`.
  Bila kode sudah pernah tercatat, server mengembalikan baris yang
  sama (200, bukan error). 404 bila kode tidak dikenal, 403 bila
  tidak ada akses.
- `GET /api/pertemuan/:id/absensi` → `{ absensi: [{ id,
  pertemuan_id, generus_id, status, nama, kelas_sekolah, jenjang,
  ... }] }`.

## Yang TIDAK dikerjakan di sesi ini

- Jangan ubah `server/index.js` sama sekali.
- Jangan buat smoke test — ditulis Muse setelah ini.
- Jangan pakai CDN atau pustaka lain selain `jsQR` yang sudah
  di-vendor.

## Format keluaran

Jawab HANYA dengan satu blok kode berisi file lengkap:

**`server/public/scan.html`** (file lengkap)

```html
...file...
```

Jangan sertakan penjelasan panjang di luar blok kode. Jangan
menjalankan tes atau mengakses file — Muse yang menulis file dan
menjalankan tes.
