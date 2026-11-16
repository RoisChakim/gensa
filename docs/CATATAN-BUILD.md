# Catatan build — Sistem Manajemen Generus (demo v1)

Dibaca 13 Nov 2026 dari skill yang terpasang, sebelum membangun.

## Mode (Impeccable): Operate
Ini aplikasi admin/dashboard — yang utama scanability, konsistensi, dan
ekspektasi pola yang sudah dikenal. Brand hidup di detail yang presisi.
Login mengikuti brief yang dipatok (tampilan SIM Generus, DESAIN.md);
dashboard mengikuti pola admin yang sudah dikenal, bukan pamer visual.

## Aturan RYUX Build yang berlaku
- Halaman produk lain = referensi, BUKAN spec — KECUALI pengguna minta
  dibuat ulang ("recreate/match") seperti di sini: maka samakan
  tampilannya, QC bandingkan di viewport yang sama, tapi TETAP buang
  brand, logo, dan konten produk lain (RX-AS-11). Logo SIM Generus
  tidak disalin; buat logo baru sesuai nama/brand pengguna.
- Jangan mengarang aturan bisnis atau data yang disajikan seolah nyata
  (RX-FE-02, RX-PR-02): semua data demo berlabel CONTOH yang jelas.
- Pertanyaan tahap-1 dulu, maksimal 3, dalam satu pesan, lalu tunggu:
  NAMA/BRAND sistem (sudah ditanyakan 13 Nov 09:53 — menunggu jawaban).
- Verifikasi dengan render nyata: screenshot desktop + mobile, perbaiki
  penyimpangan dari desain, baru laporkan selesai.

## Aturan lokal (standar-desain-web)
- Tanpa pola `opacity: 0` + `gsap.from`; konten harus tampil tanpa JS.
- Bahasa Indonesia yang benar; tanpa CDN (library lokal: lib/qrcode.js
  sudah teruji; GSAP lokal bila perlu).

## Stack demo v1
- Satu file HTML + CSS/JS lokal (pola undangan-standalone), data di
  localStorage, 4 peran dengan login demo (pilih peran).
- QR: qrcode-generator 1.4.4 (lib/qrcode.js, teruji).
- Laporan WA: draf pesan siap kirim + tombol kirim (wa.me); kirim
  otomatis penuh butuh jalur resmi Meta (tahap berikutnya).

## v8 — Riwayat Kehadiran per generus (13 Nov 2026, ~17:45 WIB)
- Daftar Generus kini punya kolom Kehadiran: % + "n/total hadir" (+ jumlah izin), tombol Riwayat per baris.
- Klik Riwayat membuka modal: ringkasan % kehadiran / izin / tidak hadir + tabel per jadwal selesai (tanggal, pengajian, status Hadir/Izin—alasan/Tidak hadir + keterangan izin).
- Dihitung dari data yang sudah ada: DB.hadir (scan QR / tandai hadir) + DB.izin (jadwalId). Hanya jadwal selesai yang dihitung; yang berlangsung/akan datang tidak masuk. Mengikuti lingkup generus (kelompok/desa/daerah).
- Batasan data contoh: tiap kelompok baru punya 1 jadwal selesai di seed, jadi % awal terlihat ekstrem (100% atau 0%, cth Rina G-004 0/1) sampai ada sesi berikutnya — J-101 hari ini (16:00–18:00) jadi sesi ke-2 setelah pukul 18:00.
- QC tahap ini: node --check pada skrip aplikasi lolos; hitungan disimulasikan dari seed dan cocok. Belum diuji klik di browser — buka GENSA_Demo_v1.html, login Admin, Daftar Generus, klik Riwayat di baris mana pun.

## v9 — Menu Materi (tampilan kasar, 2026-11-15)
- Permintaan pengguna 04:41: menu Materi + dashboard % target keseluruhan & per jenjang + tambah target + jenjang → kelas (caberawit: AUD, A–F) + per kelas target doa/surat (dropdown Hafal/Belum), makna pegon (Bisa/Tidak), praktik solat. Status nilai PER ANAK (dipilih pengguna via opsi).
- Data: `DB.materi` [{id M-001.., jenjang, kelas, jenis, nama}], `DB.materiNilai` {targetId: {generusId: 1}}. Generus punya `kls` (kelas mengaji) — diisi di seed + bisa diubah di modal Ubah/Tambah Generus (select ikut jenjang). Migrasi `ensureGenerusKls()` di loadDB untuk data lama tanpa kls (round-robin termuda dulu).
- Kelas per jenjang (TEBAKAN, belum dikonfirmasi pengguna): caberawit AUD,A–F; pra remaja A–C; remaja A–C; usia nikah A–B.
- Seed: 66 target (18 doa, 18 surat, 15 makna, 15 praktik). Nilai contoh deterministik ((gi*7+ti*3)%5)<3 → keseluruhan 62% (56/90), caberawit 66%, pra remaja 56%, remaja 69%, usia nikah 55%.
- UI: sidebar "Materi" (setelah Daftar Generus). Dashboard kartu % keseluruhan + 4 kartu jenjang (filter jenjang aktif → jenjang lain "-"). Tab Penilaian | Hasil. Filter jenjang → kelas (value "jenjang|kelas"). Tanpa kelas: ringkasan per kelas + tombol Buka. Kelas dipilih: daftar target per jenis + hitungan "x dari y anak hafal/bisa" + tombol Hapus, lalu matriks generus × target (select per sel, simpan langsung, statistik + hitungan ikut berubah tanpa reload penuh). Tab Hasil: tabel per generus (nama, kelompok, jenjang, kelas, n/m, % + progress bar), urut % tertinggi, ikut filter. Form Tambah Target (jenjang, kelas, jenis, nama) → lompat ke kelas itu. Daerah baca-saja (select disabled, form tambah disembunyikan, catatan kunci).
- QC klik 2026-11-15: dashboard 62% (56/90) + per-jenjang sesuai simulasi; buka caberawit A → matriks 2 baris × 7 kolom; ubah An-Nas Sari 0→1 → hitungan 1/2→2/2, keseluruhan 62%→63% (57/90); tab Hasil: Sari 5/6 = 83% teratas; tambah target "Doa Masuk Rumah" (remaja B) muncul di daftar. Screenshot qc/v9-materi-{dashboard,matrix,hasil}.png.
- Status: TAMPILAN KASAR — menunggu persetujuan/koreksi pengguna (kelas tiap jenjang, daftar target, letak tab Hasil).
- Tombol Kirim WA ke orang tua (2026-11-15, lolos QC isi pesan): tab Hasil kini punya kolom Kirim per generus — "Kirim WA" (tautan wa.me tanpa nomor, pesan sudah terisi; pengurus memilih chat orang tua karena nomor orang tua belum ada di data) + "Salin". Pesan (`materiWaText`): salam, "Laporan Perkembangan Materi — [nama]", kelompok · jenjang · kelas, daftar sudah hafal/bisa dikelompokkan per jenis, daftar yang masih perlu dihafal/dilatih, "Pencapaian: n dari m target (pct%)", penutup + "_Dikirim dari GENSA (demo)_". QC: isi pesan Sari Puspita terverifikasi lengkap (hafal 4: Doa Sebelum Tidur, Doa Bangun Tidur, Al-Falaq, Praktik Solat Subuh; belum 2: An-Nas, Makna Pegon: An-Nas; 4 dari 6 target (67%)). Tombol Salin memakai clipboard API — TIDAK bisa diverifikasi di Chromium headless (clipboard diblokir, toast "Gagal menyalin."); di perangkat asli dengan ketukan nyata mestinya jalan.
- Menu Pengingat digabung ke Jadwal (2026-11-15, lolos QC klik): menu Pengingat dihapus; form Buat Jadwal kini berisi Jenjang + Tempat + Materi + Catatan (tempat & materi wajib, seperti pengingat) + pratinjau pesan langsung di form. Tiap kartu jadwal (yang belum berakhir) punya tombol "Kirim Pengingat" (wa.me, teks sama persis dengan format pengingat lama: salam, 📆 hari/tanggal, ⏰ jam mulai–selesai, 🕌 tempat, 📒 materi, Nb + link izin jadwal) + "Salin Pesan". Data pengingat lama (P-001) + halaman izin publiknya tetap jalan; halaman Izin tetap ada.
- Halaman Izin (2026-11-15, lolos QC klik): menu Izin menampilkan semua izin masuk (nama + no unik, alasan, keterangan, jadwal/pengingat + tanggal, kelompok, tanggal kirim) dengan filter per jadwal/pengingat dan tombol Hapus (kecuali Daerah). Lingkup mengikuti peran. PELAJARAN: penghapusan section pengingat sempat ikut menghapus section Izin (satu rentang baris) sehingga aplikasi mati total (DB undefined karena skrip berhenti sebelum loadDB) — perbaikan: section Izin dipulihkan; penghapusan UI ke depan harus diverifikasi dengan grep section, bukan nomor baris.
- Laporan: pratinjau + unduh Excel/Word + cetak (2026-11-15, lolos QC klik): menu Laporan kini "Laporan Kehadiran" — pratinjau tabel Rekap Sesi + Rekap per Generus (periode Harian/Mingguan/Bulanan) di atas, lalu tombol Unduh Excel (.xlsx asli, ZIP+XML ditulis sendiri, tanpa library), Unduh Word (.docx asli), Cetak (lembar cetak di dalam halaman), Kirim via WhatsApp + Salin Pesan tetap ada sebagai opsi. QC: pratinjau bulanan 15 dari 20 kehadiran (75%), 4 sesi; file xlsx (12.358 byte) & docx (18.697 byte) terverifikasi ZIP valid (PK) + berisi judul & isi laporan; tombol Cetak memanggil window.print dengan lembar terisi.
