Baik, ubah cara: JANGAN pakai diff. Saya yang akan memverifikasi
dengan membandingkan file lama dan baru.

Keluarkan DUA output ini dalam satu jawaban:

1. `server/index.js` — SELURUH isi file yang baru, lengkap tanpa
   potongan. Salin persis isi `server/index.js` yang sudah saya
   berikan (jangan ubah satu baris pun dari kode Sesi 1 yang sudah
   jalan), lalu TAMBAHKAN:
   - `const QRCode = require('qrcode');` di bawah require bcryptjs.
   - Konstanta baru setelah STATUSES: JENJANG, STATUS_ABSENSI,
     TINGKAT_PERTEMUAN.
   - Fungsi-fungsi baru (pertemuanScopeWhere, canManagePertemuan,
     generusInScope, createPertemuan, listPertemuan, getPertemuan,
     listAbsensi, recordAbsen, recordAbsenManual, selesaiPertemuan,
     koreksiAbsensi, qrSvg) — disisipkan di antara akhir fungsi
     rejectDelete dan `async function serveStatic`, mengikuti
     spesifikasi di prompt Sesi 2.
   - Routing baru di handle(), disisipkan sebelum
     `fail(404, 'Rute tidak ditemukan.');` — mengikuti spesifikasi
     di prompt Sesi 2.
   Saya akan membandingkan dengan file lama untuk memastikan hanya
   ada tambahan, tidak ada perubahan pada kode Sesi 1.

2. `server/smoke-test-s2.js` — lengkap (file baru). Semua tes memakai
   Kelompok Contoh B (Desa Contoh 2, Daerah Contoh) supaya terisolasi
   dari sisa tes Sesi 1 di Kelompok Contoh A. Akun desa untuk cek 10
   dibuat untuk Desa Contoh 2. Ikuti pola smoke-test.js Sesi 1.

Jangan tambah file lain, jangan tanya lagi. Akhiri dengan ringkasan
8 baris seperti yang diminta di prompt Sesi 2.
