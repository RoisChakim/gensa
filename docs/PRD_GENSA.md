# PRD GENSA — Sistem Manajemen Generus

**Versi:** 1.0 (final untuk MVP)
**Tanggal:** 20 November 2026
**Pemilik:** Aufa Roisul Chakim (Admin Utama)

---

## 1. Gambaran Umum

GENSA adalah sistem manajemen generus (anggota pengajian) untuk komunitas
berjenjang **Daerah → Desa → Kelompok**. Sistem ini mengelola data generus,
absensi QR, jadwal pengajian, penilaian materi/hafalan, dan laporan
kehadiran.

**Skala:** 1 daerah, 3 desa, masing-masing desa 5–6 kelompok (nama kelompok
tiap desa berbeda-beda).

**Target selesai MVP:** minggu ini (minggu 20 November 2026).

---

## 2. Peran & Hak Akses

| Peran | Hak akses |
|---|---|
| **Admin Utama** | Semua. Membuat akun, menyetujui/menolak pengajuan (tambah/hapus generus), mengelola struktur kelas, dan semua yang dilakukan peran lain. |
| **Daerah** | Seperti Admin, TAPI tidak bisa menambah generus dan tidak bisa menyetujui pengajuan. Melihat data di wilayah daerahnya. Punya laporan rekap sendiri. |
| **Desa** | Mengelola desa + kelompok di dalamnya. TIDAK bisa menambah generus. Bisa mengajukan penghapusan generus (dengan alasan, perlu persetujuan Admin Utama). |
| **Kelompok** | CRUD kelompoknya sendiri. Satu-satunya yang bisa mengajukan generus baru. Bisa mengajukan penghapusan generus. |
| **Generus** | Tidak punya akun. Hanya menunjukkan QR untuk absensi. |

**Aturan akses:** setiap pengurus hanya boleh melihat dan mengubah data
dalam wilayahnya.

**Akun:** 1 akun = 1 peran. Akun dibuat oleh Admin Utama. Pengurus mengirim
email ke Admin; Admin mengirim email berisi nama email dan password ke
email pengurus tersebut. Password bisa diubah 1 kali saat login pertama
dengan password dari Admin. Email wajib untuk semua pengurus (kalau belum
punya, bikin dulu). Reset password lewat email, seperti web/aplikasi pada
umumnya. Login Google adalah tambahan yang dianjurkan (bukan wajib MVP);
hanya email yang sudah didaftarkan Admin yang boleh masuk.

---

## 3. Data Generus

**Data generus:** nama, umur, kelas, tanggal lahir, jenis kelamin.

**Data orang tua:** nama, hubungan, nomor HP. (Ditambahkan — diperlukan
untuk tombol Kirim WA ke orang tua.)

**Jenjang otomatis:** PAUD–SD caberawit, SMP pra remaja, SMA remaja,
Kuliah/Kerja usia nikah.

**Kelas:** di dalam PAUD–SD ada kelas terperinci lagi — dibuat menu baru
khusus PAUD–SD; Admin yang menambahkan kelas-kelasnya. Struktur kelas
lainnya di-input Admin Utama (belum diputuskan, menyusul). Perubahan kelas
seorang generus menyimpan riwayat (datanya kecil, tidak memenuhi database).

**Tidak ada data lama:** mulai dari kosong; pengguna input sendiri.

---

## 4. Fitur MVP (minggu ini)

1. **Akun & peran** — login, pembuatan akun oleh Admin, hak akses per
   wilayah.
2. **Data generus + persetujuan** — pengajuan generus baru oleh Kelompok,
   persetujuan Admin Utama, penghapusan dengan alasan + persetujuan.
3. **QR + absensi** — QR per generus, scan oleh pengurus, cegah double,
   input manual, koreksi 24 jam.
4. **Jadwal** — dibuat per tingkatan (kelompok/desa/daerah), target
   jenjang, manual per pertemuan.
5. **Laporan Word** — laporan kehadiran (format ikut rekomendasi Codex).

**Yang ditunda (bukan MVP):** login Google, absen offline, link izin.
(Dikonfirmasi pengguna: setuju ditunda.)

---

## 5. Alur Persetujuan Generus Baru

1. Kelompok mengajukan generus baru (submit).
2. Admin Utama meninjau. Kalau data belum lengkap, Admin memberi alasan
   (bukan langsung ditolak) — Kelompok melengkapi dan mengajukan ulang.
3. Kalau disetujui, generus masuk ke daftar anggota kelompok dan bisa
   absen. Kalau belum disetujui, generus belum bisa absen (harus nunggu).
4. Admin Utama bisa menyetujui/menolak dengan catatan; pemohon diberi
   tahu hasilnya.

**Catatan:** hanya Kelompok yang punya fitur pengajuan. Desa dan Daerah
tidak bisa mengajukan generus baru (generus berasal dari kelompok-kelompok).

---

## 6. Alur Penghapusan & Pindah Generus

**Penghapusan:**
1. Kelompok mengajukan penghapusan, disertai alasan.
2. Admin Utama meninjau alasan. Kalau ditolak, data tetap ada.
3. Selama masih dalam proses pengajuan, di halaman Kelompok ada tulisan
   "dalam proses pengajuan".
4. Kalau disetujui dan dihapus: riwayat absen dan nilai ikut hilang.
5. Yang boleh melihat alasan penghapusan: hanya Kelompok.

**Pindah kelompok/desa:**
- Generus yang pindah harus daftar ke kelompok yang baru, tetap meminta
  persetujuan seperti awal (seperti pengajuan baru).

---

## 7. QR & Absensi

**QR:**
- Satu QR per generus, untuk absen; tidak bisa berubah.
- Kalau hilang: cetak ulang yang sama dari aplikasi (tidak perlu QR baru).
- Ada tombol cetak 1 per 1, dan tombol cetak semua, di akun pengurus
  kelompok.

**Scan absensi:**
- Yang memindai: pengurus sesuai tingkat pengajiannya.
- Hanya boleh memindai generus yang termasuk sasaran kegiatan tersebut.
- Kode bisa diketik manual (pendek, tapi tetap unik dan sulit).
- Satu generus hanya tercatat 1 kali per pengajian (cegah double — walau
  absen 2 kali, masuk 1 kali).
- Kalau pengurus lupa bawa HP: tulis di kertas, nanti dimasukkan manual.

**Status kehadiran:** hadir, izin, sakit, alfa.
- Jika mengisi link izin/sakit → status izin/sakit.
- Jika tidak scan dan tidak mengisi link → alfa.
- Izin dan sakit digabung jadi 1 kategori "izin" di laporan %.
- Pengurus boleh koreksi hasil 1 kali, dalam 24 jam setelah pengajian
  selesai.

**Offline:**
- Absensi tetap jalan saat offline; otomatis ter-upload ke database
  saat ada internet; pastikan tidak double kirim.
- Perangkat: HP dan web. Tidak perlu unduh data dulu sebelum offline.
- Kalau dua perangkat mencatat generus yang sama / status berbeda:
  yang "hadir" yang menang.
- (Catatan: risiko data hilang kalau HP ganti/hilang sebelum sempat
  sync — diterima sebagai batasan.)

---

## 8. Jadwal Pengajian

- Dibuat oleh tingkatan masing-masing:
  - Kelompok: untuk kelompoknya sendiri.
  - Desa: untuk remaja 1 desa (kelompok-kelompok di desa itu).
  - Daerah: untuk semua generus sesuai jenjang (seluruh kelompok di
    daerah).
- Target peserta dipilih dengan centang jenjang (caberawit, pra remaja,
  remaja). Satu pengajian bisa khusus caberawit saja, gabungan pra
  remaja + remaja, atau remaja saja.
- Jadwal dibuat manual 1 per 1 (tidak usah berulang otomatis). Bisa juga
  tiap minggu di hari yang sama, tapi enaknya manual.
- Yang bisa ubah/hapus jadwal: yang bikin dan Admin.

---

## 9. Izin (Link)

- Link izin dibuat per kelompok, lalu di-share.
- Siapa saja yang punya link boleh membuka. Setelah klik nama, verifikasi
  dengan scan barcode / isi kode.
- Alur pilihan: kalau kelompok yang share → nama-nama anggota kelompoknya;
  kalau desa → pilih kelompok mana dulu, baru pilih nama; kalau pengajian
  daerah → pilih desa mana, kelompok mana, baru nama siapa.
- Setelah pilih nama: kolom alasan — sakit, izin (kalau izin harus ada
  alasannya).
- Link izin hanya untuk 1 kegiatan yang akan dilaksanakan; tidak bisa
  pilih tanggal / jadwal.
- Izin yang masuk harus disetujui pengurus kelompok dulu, baru masuk ke
  absen.

---

## 10. Materi & Penilaian

**Matriks penilaian (dipakai dulu, bisa berubah):**
- Doa & Surat → Hafal / Belum
- Makna Pegon & Praktik Solat → Bisa / Tidak

**Yang input nilai:** pengurus sesuai tingkatnya.

**% Hasil:** (jumlah tugas Hafal) / (total tugas hafalan) × 100%.
- Hafalan di sini dihitung sebagai tugas dalam 1 tahun.
- Kalau mau naik kelas harus menyelesaikan tugas-tugasnya.
- Setiap kelas tugasnya sama semua; perbedaannya dia bisa mengerjakan
  atau tidak.
- Ada peringatan khusus untuk PAUD–SD (harus ada tugas).

**Ubah nilai:** boleh diubah 2 kali; kalau mau diubah lagi, minta izin
Admin.

**Siapa yang buat materi/tugas hafalan:** masing-masing Kelompok / Admin
Utama yang menyediakan.

**Orang tua:** hanya pengurus yang bisa lihat nilai. Kalau orang tua mau
lihat nilai, pengurus yang kirim laporan KBM anak-anaknya lewat WA /
dokumen.

---

## 11. Laporan

**Format:** Word saja.

**Isi & akses (mengikuti jawaban pengguna):**
- Kelompok: hanya kelompoknya sendiri.
- Desa: desanya.
- Daerah: lihat semua. Daerah ada rekap langsung 1 daerah tanpa
  terperinci nama-namanya, tapi juga bisa terperinci nama-nama generus
  sesuai jenjang.

**Periode:** bisa mingguan, bisa bulanan. Format detail mengikuti
rekomendasi Codex (pengguna akan benerin lagi).

**% Kehadiran:** rumus mengikuti rekomendasi Codex.
Rumus dasar: jumlah hadir ÷ jumlah pertemuan wajib × 100%.

---

## 12. Teknis

- **Hosting:** server pribadi. Untuk MVP, jalan di Vercel (gratis, seperti
  portfolio) untuk pengembangan/pengujian; nanti pindah ke server sendiri
  (rencana beli PC mini).
- **PWA:** harus bisa di-install di semua device (HP dan web).
- **Database:** PostgreSQL 16 (bukan SQLite). Sudah jalan di container
  `gensa-postgres` (127.0.0.1:5432, DB+user `gensa`). Backup harian.
- **Keamanan:** ikuti skill web-security (validasi server-side, cegah
  XSS/SQL injection, periksa peran & kepemilikan data di server untuk
  setiap aksi, password di-hash, tanpa rahasia di kode/repo).

**Privasi & retensi:**
- Yang boleh lihat nomor HP orang tua dan alasan izin: pengurus sesuai
  kegiatan.
- Retensi data & riwayat: 1 bulan.

---

## 13. Hal yang Masih Terbuka

- Isi file Word laporan (detail kolom) — nanti dulu.
- Struktur kelas lengkap (selain PAUD–SD) — di-input Admin Utama, menyusul.
- Item yang ditunda minggu ini — perlu konfirmasi item persisnya (login
  Google, absen offline, link izin).
- Detail rumus % kehadiran untuk kasus izin/sakit/kegiatan dibatalkan/
  generus baru bergabung — ikut rekomendasi Codex.
