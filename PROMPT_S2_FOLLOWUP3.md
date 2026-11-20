Bagus — migrasi 002 dan cetak-qr.html sudah saya simpan. Sekarang
kerjakan DUA output yang tersisa dari prompt Sesi 2, keduanya dalam
satu jawaban ini:

1. Diff unified `server/index.js` (--- a/server/index.js +++
   b/server/index.js) berisi SEMUA perubahan: require qrcode,
   konstanta baru (JENJANG, STATUS_ABSENSI, TINGKAT_PERTEMUAN),
   fungsi-fungsi baru (pertemuanScopeWhere, canManagePertemuan,
   generusInScope, createPertemuan, listPertemuan, getPertemuan,
   listAbsensi, recordAbsen, recordAbsenManual, selesaiPertemuan,
   koreksiAbsensi, qrSvg), dan routing baru. Pakai jangkar A–D
   yang sudah diberikan di prompt Sesi 2. Jangan output seluruh
   isi index.js — hanya diff-nya.

2. `server/smoke-test-s2.js` lengkap (file baru). Ingat: semua tes
   memakai Kelompok Contoh B (Desa Contoh 2, Daerah Contoh) —
   cari dengan findKelompok memakai nama-nama itu — supaya
   terisolasi dari sisa tes Sesi 1 di Kelompok Contoh A. Akun desa
   untuk cek 10 dibuat untuk Desa Contoh 2. Ikuti pola
   smoke-test.js Sesi 1 (request, check, suffix acak, domain
   @tes.gensa.local, biarkan data tes).

Jangan tambah file lain, jangan tanya lagi. Akhiri dengan ringkasan
8 baris seperti yang diminta di prompt Sesi 2.
