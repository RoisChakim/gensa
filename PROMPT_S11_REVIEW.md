# Sesi 11 — Review Codex: "Apa yang kurang?" (GENSA)

## CARA KERJA (PENTING — baca dulu, jangan dilewati)

- Kamu TIDAK PERLU membaca file repo — semua konteks yang
  dibutuhkan sudah ada di prompt ini. Kerjakan HANYA dari
  konteks di sini.
- Kamu TIDAK BISA menulis file langsung (lingkungan ini hanya
  baca). Itu NORMAL dan BUKAN halangan — keluarkan SELURUH
  jawabanmu sebagai teks di jawaban. Muse yang akan menyimpan
  hasilnya.
- JANGAN minta akses tulis, JANGAN minta dibuka sesi dengan
  akses file, dan JANGAN berhenti karena tidak bisa menulis
  file.
- JANGAN memakai alat akses file apa pun. Jawaban berupa teks
  sudah cukup.

## Tugas (HANYA melapor — JANGAN perbaiki apa pun)

Bandingkan PRD + jawaban pengguna (Bagian A dan B di bawah)
dengan ringkasan implementasi yang sudah dibangun (Bagian C).
Hasilkan DAFTAR KONKRET per item — bukan saran umum — dengan
format berikut:

### 1. Yang belum dibangun (PRD minta, kode belum ada)
Satu baris per item: apa, di PRD bagian berapa, seberapa penting.

### 2. Yang dibangun beda dari PRD
Satu baris per item: PRD bilang apa, implementasi sekarang apa,
apakah bedanya masalah atau tidak.

### 3. Kemungkinan bug / kelemahan / risiko
Satu baris per item: di bagian mana (endpoint/halaman/tabel),
apa risikonya, seberapa parah. Termasuk celah keamanan (pakai
checklist skill web-security di bawah sebagai acuan).

### 4. Prioritas
Pisahkan jelas: (a) WAJIB diperbaiki sebelum dipakai pengguna,
(b) bisa menyusul, (c) tidak perlu / di luar PRD.

Jangan menulis kode. Jangan mengarang fitur baru. Kalau suatu
bagian PRD tidak bisa dinilai dari ringkasan di Bagian C, tulis
"TIDAK BISA DINILAI — butuh baca kode" dan sebut file/fungsinya.

Checklist keamanan (acuan Bagian 3):
- Semua form divalidasi di server.
- Tidak ada innerHTML dengan data pengguna.
- Tidak ada query tempel string.
- Setiap aksi dicek peran + kepemilikan datanya di server.
- Tidak ada rahasia di kode / repo.
- Pesan error tidak bocorkan info dalam.
- Endpoint publik (tanpa login) tidak membocorkan data dan
  tidak bisa disalahgunakan (tebak token, spam, enumerasi).

---

## Bagian A — PRD GENSA v1.0 (final untuk MVP, 20 Nov 2026)

# PRD GENSA — Sistem Manajemen Generus

**Versi:** 1.0 (final untuk MVP)
**Tanggal:** 20 November 2026
**Pemilik:** Aufa Roisul Chakim (Admin Utama)

## 1. Gambaran Umum

GENSA adalah sistem manajemen generus (anggota pengajian) untuk komunitas
berjenjang **Daerah → Desa → Kelompok**. Sistem ini mengelola data generus,
absensi QR, jadwal pengajian, penilaian materi/hafalan, dan laporan
kehadiran.

**Skala:** 1 daerah, 3 desa, masing-masing desa 5–6 kelompok (nama kelompok
tiap desa berbeda-beda).

**Target selesai MVP:** minggu ini (minggu 20 November 2026).

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
(Dikonfirmasi pengguna: setuju ditunda — TAPI ketiganya SUDAH dibangun
di Sesi 8–10, lihat Bagian C.)

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

## 13. Hal yang Masih Terbuka

- Isi file Word laporan (detail kolom) — nanti dulu.
- Struktur kelas lengkap (selain PAUD–SD) — di-input Admin Utama, menyusul.
- Item yang ditunda minggu ini — perlu konfirmasi item persisnya (login
  Google, absen offline, link izin).
- Detail rumus % kehadiran untuk kasus izin/sakit/kegiatan dibatalkan/
  generus baru bergabung — ikut rekomendasi Codex.

---

## Bagian B — Jawaban pengguna (ringkas, dari PRD_JAWABAN.md)

- Daerah: seperti Admin, TAPI tidak bisa menambah generus. Daerah punya
  laporan sendiri: rekap persentase semua kegiatan di kelompok, desa,
  dan kegiatan daerah.
- Desa: TIDAK bisa menambah generus. Desa BOLEH mengajukan penghapusan
  (dengan alasan, perlu persetujuan Admin).
- Akun dibuat Admin saja. 1 akun = 1 peran. Pengurus kirim email; Admin
  kirim email berisi nama email dan password. Password bisa diubah 1 kali
  saat login pertama dengan password dari Admin.
- Login Google: untuk semua peran; hanya email yang sudah didaftarkan
  Admin yang boleh masuk. Reset password bisa via email / Google.
- Data orang tua: nama, hubungan, nomor HP — ditambahkan.
- QR: satu per generus, tidak bisa berubah; kalau hilang cetak ulang
  yang sama dari aplikasi.
- Kode manual: pendek tapi unik dan sulit.
- Double absen: dicegah — 1 kali saja.
- Lupa bawa HP: tulis di kertas, masukkan manual nanti.
- Offline hilang (HP ganti/hilang sebelum sync): pengguna bertanya
  "enaknya gimana?" — belum diputuskan (risiko diterima sebagai
  batasan di PRD §7).
- Jadwal: centang jenjang; manual 1 per 1, tidak usah berulang.
  Ubah/hapus jadwal: yang bikin + Admin.
- Link izin: siapa saja yang punya link boleh buka; setelah klik nama,
  scan barcode / isi kode untuk verifikasi. Link hanya untuk 1 kegiatan
  yang akan dilaksanakan; tidak bisa pilih tanggal/jadwal. Izin
  disetujui pengurus kelompok dulu, baru masuk absen. Izin+sakit jadi
  1 kategori "izin" di laporan %.
- Ubah nilai: boleh 2 kali; lebih dari itu minta izin Admin.
- Orang tua lihat nilai: hanya pengurus; kalau orang tua mau lihat,
  pengurus yang kirim laporan KBM lewat WA/dokumen.
- % hafalan: (jumlah Hafal) / (total tugas) × 100%. Peringatan khusus
  untuk PAUD–SD. Harus ada tugas (hafalan = tugas dalam 1 tahun);
  naik kelas harus menyelesaikan tugasnya; setiap kelas tugasnya sama.
- Isi file Word: nanti dulu (ditunda).
- Download laporan: kelompok hanya kelompoknya, desa desanya, daerah
  lihat semua. Daerah ada rekap langsung 1 daerah tanpa nama-nama,
  tapi juga bisa terperinci nama-nama generus sesuai jenjang.
- Server pribadi: belum ada, masih proses — nanti beli PC mini.
- MVP disetujui: akun & peran, tambah generus + persetujuan, QR +
  absensi, jadwal, laporan Word. Yang ditunda disetujui: login Google,
  absen offline, link izin.
- 19 pertanyaan Codex sudah dijawab: Desa TIDAK bisa nambah generus;
  akun dibuat Admin saja. Generus ditolak = dikasih alasan (bukan
  langsung ditolak) — Kelompok melengkapi dan ajukan ulang. Sebelum
  disetujui: belum bisa absen. Hapus: alasan dari kelompok; kalau
  ditolak data tetap ada; selama proses, di halaman Kelompok ada
  tulisan "dalam proses pengajuan". Setelah dihapus: riwayat absen
  dan nilai ikut hilang. Pindah: daftar ke kelompok baru, minta
  persetujuan seperti awal. Yang boleh lihat alasan penghapusan:
  hanya Kelompok. Jenjang & PAUD–SD: simpan riwayat perubahan kelas
  juga bisa (pengguna bertanya "tapi nggak memenuhi database?").
  Offline: HP dan web; tidak perlu unduh dulu; yang hadir yang menang.
  Server & PWA: belum punya apa-apa ("enaknya gimana, gunakan sesuai
  kebutuhan"). Privasi & retensi: pengurus sesuai kegiatan; retensi
  1 bulan.

---

## Bagian C — Ringkasan implementasi yang sudah dibangun (Sesi 1–10)

Server Node.js stdlib http + `pg` + `bcryptjs`, port 3101, file
`server/index.js` (~3.607 baris). PostgreSQL 16, migrasi
001–006. Semua smoke test S1, S3–S10 lulus (S2 re-run gagal 3
pemeriksaan karena data tes lama — lihat "Caveat" di bawah).

### Tabel database

- `daerah` (id, nama), `desa` (id, daerah_id, nama),
  `kelompok` (id, desa_id, nama).
- `users` (id, email unik case-insensitive, password_hash
  bcryptjs, role admin/daerah/desa/kelompok, desa_id,
  kelompok_id, must_change_password, active, google_sub
  nullable UNIQUE, created_at). CHECK peran↔scope.
- `generus` (id, kelompok_id, nama, tanggal_lahir,
  kelas_sekolah TEXT, tingkat paud/sd/smp/sma/kuliah/kerja,
  jenjang GENERATED dari tingkat, ortu_nama, ortu_hubungan,
  ortu_hp, status pending/approved/rejected/delete_pending,
  alasan_penolakan, alasan_penghapusan, requested_by,
  decided_by, decided_at, qr_token 32 hex UNIQUE,
  kode_manual 6 karakter UNIQUE). TIDAK ADA kolom umur,
  TIDAK ADA kolom jenis kelamin, TIDAK ADA tabel riwayat
  perubahan kelas.
- `sessions` (token, user_id, expires_at, revoked).
- `pertemuan` (id, tingkat kelompok/desa/daerah, kelompok_id,
  desa_id, jenjang_target jenjang_generus[], tanggal,
  dibuat_oleh, selesai_pada, izin_token 32 hex UNIQUE
  nullable, CHECK scope sesuai tingkat).
- `absensi` (id, pertemuan_id, generus_id, status
  hadir/izin/sakit/alfa, dicatat_oleh, koreksi_count,
  dicatat_pada, UNIQUE pertemuan+generus).
- `sync_items` (id, pertemuan_id, generus_id, client_id,
  status, dicatat_pada, dicatat_oleh, UNIQUE
  pertemuan+client_id).
- `tugas` (id, judul, kategori doa_surat/makna_pegon/
  praktik_solat, kelompok_id NULL = global Admin,
  dibuat_oleh). `penilaian` (id, generus_id, tugas_id, nilai
  hafal/belum/bisa/tidak, diubah_count, dicatat_oleh, UNIQUE
  generus+tugas).
- `izin` (id, pertemuan_id, generus_id, alasan sakit/izin,
  keterangan wajib bila izin, status menunggu/disetujui/
  ditolak, diputuskan_oleh, diputuskan_pada,
  catatan_penolakan).

### Endpoint API (semua pakai parameter $1/$2, error via fail())

- Auth: POST /api/login (rate limit 5 gagal/15 menit → 429;
  cookie HttpOnly SameSite=Lax), POST /api/logout, GET /api/me,
  POST /api/change-password (akun must_change_password hanya
  boleh /api/me, logout, ganti password), POST
  /api/reset-password + POST /api/reset-password/confirm
  (token HMAC 1 jam dari SESSION_SECRET + password_hash;
  tautan reset HANYA tampil di console server — SMTP belum
  ada, email tidak benar-benar terkirim), GET
  /api/auth/google + GET /api/auth/google/callback (state
  HMAC 10 menit; tukar kode via fetch; verifikasi ID token
  via tokeninfo: aud, email_verified, exp, iss; hanya email
  yang sudah terdaftar Admin + aktif yang boleh masuk; ikat
  google_sub sekali, tolak bila sudah terikat akun Google
  lain; 503 bila Google belum dikonfigurasi).
- Akun: POST /api/users (admin saja; password awal acak 12
  karakter dikembalikan di respons API — admin yang
  meneruskannya manual ke pengurus, tidak ada pengiriman
  email otomatis).
- Generus: POST /api/generus (kelompok saja), GET
  /api/generus (ikut scope wilayah), POST
  /api/generus/:id/approve (admin; isi qr_token + kode_manual),
  reject (admin; catatan wajib), delete-request (kelompok;
  alasan wajib), delete-approve / delete-reject (admin).
  TIDAK ADA halaman HTML untuk pengajuan/persetujuan/
  penghapusan generus — semua hanya lewat API.
- Pertemuan: POST/GET /api/pertemuan, GET /api/pertemuan/:id
  (+ringkasan hadir/izin/sakit/alfa), PATCH /api/pertemuan/:id
  (ubah tanggal/jenjang; 409 bila selesai), DELETE
  /api/pertemuan/:id (409 bila selesai/ada absensi). Kelola
  hanya pembuat tingkat + Admin (canManagePertemuan).
- Absensi: GET /api/pertemuan/:id/absensi, GET
  /api/pertemuan/:id/daftar (nama + kode_manual + qr_token,
  hanya pengelola pertemuan — untuk unduh offline), POST
  .../absen (kode manual 6 karakter ATAU qr_token 32 hex;
  transaksi + FOR UPDATE; 409 bila selesai; ON CONFLICT
  update = tidak double), POST .../absen-manual (generus_id +
  status hadir/izin/sakit), POST .../sync (1–200 item,
  idempotensi via sync_items/client_id, aturan "hadir yang
  menang", item di luar lingkup ditolak per item, dicatat_pada
  dari klien divalidasi ISO + maks 24 jam ke depan; 409 bila
  selesai), POST .../selesai (tandai alfa semua approved
  dalam lingkup+jenjang yang belum ada barisnya), POST
  .../absensi/:id/koreksi (1x dalam 24 jam setelah selesai),
  GET /api/generus/:id/qr.svg.
- Izin: GET /api/izin?t=token (PUBLIK tanpa login: info
  pertemuan + daftar desa/kelompok/generus berjenjang; nama
  saja, TANPA kode), POST /api/izin?t=token (PUBLIK: verifikasi
  kode harus cocok dengan generus_id yang dipilih; duplikat
  menunggu/disetujui 409; 409 bila pertemuan selesai; TIDAK
  ADA rate limit), GET /api/pertemuan/:id/link-izin (buat
  token malas bila null), GET /api/pertemuan/:id/izin,
  POST .../izin/:id/setujui (masuk absensi status = alasan),
  POST .../izin/:id/tolak (catatan opsional maks 500).
- Materi: POST/GET /api/tugas, DELETE /api/tugas/:id (409 bila
  ada penilaian), POST /api/penilaian (upsert; nilai harus
  cocok kategori; ubah maks 2x lalu 403; Admin mengubah =
  reset count ke 0), GET /api/penilaian (tugas + penilaian +
  hasil % hafalan per generus).
- Laporan: GET /api/laporan (JSON) dan GET /api/laporan.docx
  (paket docx v9; rekap per kelompok + rincian per generus;
  % = hadir/wajib; izin+sakit digabung "izin"; hanya pertemuan
  selesai; generus baru tidak dihitung wajib sebelum
  decided_at; rentang maks 62 hari; akses ikut scope wilayah).
- Static: serveStatic melayani .html/.css/.js/.json/.png
  dengan CSP default-src 'self'.

### Halaman HTML (semua: palet krem/coklat/sage, textContent saja, manifest + registrasi service worker)

- login.html (tombol "Masuk dengan Google", tautan "Lupa
  password?"), reset-password.html (minta tautan / atur baru),
  jadwal.html (daftar + buat + ubah + hapus + tombol "Salin
  link izin" + "Kelola izin"), cetak-qr.html (cetak 1 per 1 +
  cetak semua), laporan.html (form periode + preset Minggu/
  Bulan ini + pratinjau + Unduh Word), scan.html (pilih
  pertemuan terbuka, getUserMedia kamera belakang + jsQR loop
  200 ms, input manual cadangan, section "Antrean offline"
  localStorage + tombol Kirim antrean), materi.html (daftar
  tugas, matriks penilaian, tabel Hasil + Kirim WA wa.me nomor
  ortu + Salin), izin.html (publik: info kegiatan, pilih
  berjenjang, alasan sakit/izin, scan barcode jsQR + input
  kode), izin-kelola.html (salin link + daftar pengajuan +
  Setujui/Tolak), manifest.json, sw.js (cache-first aset
  statis, network-only /api/*, fallback /login.html untuk
  navigasi offline), icon-192.png + icon-512.png.

### Yang TIDAK ada / belum diuji (fakta)

- TIDAK ADA halaman HTML untuk: daftar/mengajukan generus,
  menyetujui/menolak generus, mengajukan/menyetujui hapus
  generus, membuat akun pengurus, mengelola struktur kelas
  (termasuk menu khusus PAUD–SD), melihat riwayat perubahan
  kelas. Semua itu hanya tersedia lewat API.
- TIDAK ADA pengiriman email (SMTP): reset password hanya
  lewat tautan di console server; password awal akun baru
  hanya di respons API; pemohon TIDAK diberi tahu hasil
  persetujuan generus/hapus/izin (tidak ada notifikasi).
- TIDAK ADA riwayat perubahan kelas generus (tidak ada tabel
  riwayat; kelas_sekolah hanya TEXT yang ditimpa).
- TIDAK ADA menu/struktur kelas yang di-input Admin (selain
  kolom kelas_sekolah bebas isi).
- TIDAK ADA pembersihan/retensi 1 bulan (tidak ada job hapus
  data lama).
- TIDAK ADA pemberitahuan "dalam proses pengajuan" di halaman
  mana pun (status delete_pending hanya ada di data).
- Login Google: alur penuh sampai Google BELUM bisa diuji
  (butuh kredensial OAuth asli dari Google Cloud Console).
- Scan kamera HP: BELUM diuji dari HP sungguhan (tidak ada
  perangkat di VM); butuh HTTPS/localhost.
- Server belum di-deploy ke mana pun; jalan lokal
  127.0.0.1:3101. Backup DB harian ada (cron 03:00 WIB).
- `updated_at` tidak ada trigger — di-SET manual di tiap
  UPDATE (sudah dipatuhi di semua handler baru).
- Penolakan hapus menyimpan catatan di alasan_penolakan;
  belum ada riwayat keputusan terpisah.

### Caveat tes yang sudah diketahui

- Smoke test S2 re-run gagal 3 pemeriksaan karena 12 generus
  approved menumpuk di Kelompok Contoh B (9 sisa putaran S2
  lama): penutupan menandai semuanya alfa, tes berhenti
  sebelum pertemuanKedua dibuat. Bukan regresi — data tes.
- S8 butuh GOOGLE_CLIENT_ID di proses TES juga, bukan cuma
  di server.
- S10: 16/16 lulus; S1 11/11, S3 11/11, S4 8/8, S5 7/7, S6 7/7,
  S7 6/6, S8 8/8, S9 10/10 lulus (tidak ada regresi).
