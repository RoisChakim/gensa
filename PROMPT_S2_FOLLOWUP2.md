Lanjutkan. Dua hal yang kamu angkat sudah diputuskan:

1. **Konflik cek 11 (data sisa Sesi 1):** Pakai kelompok yang
   TERISOLASI dari sisa tes Sesi 1. Semua tes Sesi 2 memakai
   **Kelompok Contoh B (Desa Contoh 2, Daerah Contoh)** — bukan
   Kelompok Contoh A (di sana ada 1 generus approved sisa tes
   Sesi 1). Fungsi findKelompok di smoke-test-s2.js harus mencari
   `['Daerah Contoh', 'Desa Contoh 2', 'Kelompok Contoh B']`.
   Akun desa untuk cek 10 juga dibuat untuk Desa Contoh 2
   (desa dari Kelompok Contoh B). Dengan begitu asumsi cek 11
   benar: setelah tutup pertemuan kedua, tepat 3 baris (A hadir,
   B alfa, C alfa) dan tidak ada generus lain yang ikut tertandai.

2. **HTTPS dan cookie Secure:** di luar lingkup MVP ini. Server
   hanya jalan lokal di 127.0.0.1 dan cookie Secure sudah
   diaktifkan otomatis bila request lewat HTTPS (keputusan Sesi 1).
   Jangan bahas lagi, jangan ubah.

Sekarang kerjakan SISANYA dari prompt Sesi 2 yang sudah saya kirim:
- Diff unified `server/index.js` (require qrcode, konstanta baru,
  fungsi-fungsi baru, routing baru) — pakai jangkar yang sudah
  diberikan.
- `server/public/cetak-qr.html` lengkap.
- `server/smoke-test-s2.js` lengkap (dengan kelompok terisolasi
  di atas).
Akhiri dengan ringkasan 8 baris seperti yang diminta di prompt
Sesi 2. Jangan tambah file lain, jangan tanya lagi.
