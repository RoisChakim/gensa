# GENSA — Sistem Manajemen Generus

GENSA adalah aplikasi web untuk mengelola data generus (anak didik pengajian)
berjenjang kelompok – desa – daerah, lengkap dengan absensi QR code, jadwal
mengaji, penilaian materi, dan laporan kehadiran.

Dibangun sebagai demo front-end yang langsung bisa dibuka dan dipakai, tanpa
server, tanpa build, dan tanpa database. Semua data tersimpan di browser
(localStorage). Cocok untuk pengurus kelompok, desa, dan daerah yang butuh
alat pencatatan kehadiran dan perkembangan generus yang sederhana.

Status: demo v1 (front-end). Backend multi-user (PHP + MariaDB) direncanakan
sebagai tahap berikutnya.

## Cara Menjalankan

Tidak ada instalasi dan tidak ada build.

1. Unduh atau clone repositori ini.
2. Buka file `index.html` langsung di browser (klik dua kali, atau seret ke
   jendela browser). Bisa juga dijalankan lewat server statis apa pun.
3. Di layar login, pilih peran demo (Admin / Daerah / Desa / Kelompok),
   lalu masuk.

Tidak butuh koneksi internet untuk memakai aplikasinya. Satu-satunya fitur
yang membuka tautan luar adalah tombol kirim WhatsApp (membuka wa.me).

## Peran dan Lingkup

Ada 4 peran. Hanya pengurus yang bisa login; generus tidak bisa login —
mereka hanya menunjukkan QR code saat hadir.

| Peran | Lingkup | Akses |
| --- | --- | --- |
| Admin | Semua desa dan kelompok | Penuh (tambah, ubah, hapus, semua menu) |
| Daerah | Semua desa dan kelompok | Lihat semua, tapi baca saja di sebagian fitur (tidak bisa menambah/mengubah data) |
| Desa | Desanya sendiri + kelompok di dalamnya | Lihat, tambah, dan ubah kegiatan desanya dan kelompok di bawahnya |
| Kelompok | Kelompoknya sendiri | CRUD hanya di kelompoknya sendiri |

Hierarki wilayah: 1 daerah membawahi beberapa desa, 1 desa membawahi
beberapa kelompok, 1 kelompok adalah 1 akun dan tidak bisa melihat data
kelompok lain.

## Data Generus

Setiap generus dicatat: nama, umur, kelas sekolah, tanggal lahir, dan jenis
kelamin. Jenjang ditentukan otomatis dari kelas/status:

- PAUD sampai SD → caberawit
- SMP → pra remaja
- SMA/sederajat → remaja
- Kuliah atau sudah bekerja → usia nikah

Daftar Generus menampilkan jumlah total, jumlah laki-laki dan perempuan,
serta hitungan per jenjang. Angka-angka itu mengikuti filter yang sedang
aktif (filter Desa lalu Kelompok). Setiap generus punya nomor unik
(G-001, G-002, dan seterusnya) yang dipakai di QR code dan surat izin.

Data yang disertakan di repo ini adalah data contoh yang berlabel CONTOH.
Bukan data asli. Silakan hapus dan isi dengan data sendiri lewat menu
Tambah Generus.

## Absensi QR Code

- Setiap generus punya kartu QR code yang bisa dicetak (menu Cetak QR).
  Kartu dicetak lalu dibawa generus.
- Saat pengajian, generus menunjukkan QR-nya. Pengurus memindai lewat
  menu Scan QR di jadwal yang sedang berlangsung (butuh kamera), atau
  menandai hadir secara manual di daftar.
- Kehadiran dicatat per jadwal. Ada juga halaman Izin: generus yang
  berhalangan mengisi izin lewat tautan publik per jadwal, dan izin itu
  tampil di menu Izin (nama, nomor unik, alasan, keterangan, jadwal,
  kelompok, tanggal kirim). Izin bisa dihapus pengurus (kecuali peran
  Daerah).
- Menu Riwayat di tiap baris generus menampilkan persentase kehadiran,
  jumlah izin, dan tabel per jadwal yang sudah selesai (tanggal,
  pengajian, status Hadir / Izin beserta alasan / Tidak hadir).

## Jadwal Mengaji dan Pengingat

- Pengurus membuat jadwal mengaji: jenjang, tempat, materi, catatan,
  hari dan jam. Tempat dan materi wajib diisi.
- Formulir jadwal menampilkan pratinjau pesan pengingat secara langsung.
- Setiap kartu jadwal yang belum berakhir punya tombol Kirim Pengingat
  (membuka WhatsApp dengan pesan yang sudah terisi: salam, hari/tanggal,
  jam mulai–selesai, tempat, materi, catatan, dan tautan izin) dan tombol
  Salin Pesan.
- Pola umum: kelompok mengadakan pengajian remaja 3x seminggu, desa 1x
  seminggu, daerah 1x sebulan. Frekuensi bisa diatur per jadwal.

## Laporan Kehadiran via WhatsApp

Setelah jadwal selesai (1–2 jam setelah jam yang diatur), sistem menyiapkan
laporan persentase kehadiran:

- Kelompok → laporan dikirim ke grup WhatsApp kelompoknya.
- Desa → persentase rata-rata kelompok-kelompok dalam satu desa.
- Daerah → persentase kehadiran tiap-tiap kelompok.
- Desa dan daerah bisa meminta rekap mingguan atau bulanan, karena jadwal
  tiap kelompok berbeda-beda.

Catatan jujur: pengiriman WhatsApp otomatis yang sebenarnya butuh jalur
resmi Meta (WhatsApp Business API: nomor khusus, akun Meta Business, dan
token). Di demo ini laporan disiapkan sebagai draf pesan siap kirim plus
tombol kirim (tautan wa.me). Pengiriman otomatis penuh menyusul lewat
jalur resmi.

Menu Laporan Kehadiran juga menyediakan pratinjau tabel Rekap Sesi dan
Rekap per Generus (periode Harian, Mingguan, atau Bulanan), lalu tombol
Unduh Excel (.xlsx asli), Unduh Word (.docx asli), Cetak, serta Kirim via
WhatsApp dan Salin Pesan sebagai opsi.

## Menu Materi

Menu Materi menilai pencapaian target mengaji per anak.

- Dashboard menampilkan persentase target keseluruhan dan per jenjang
  (caberawit, pra remaja, remaja, usia nikah). Filter jenjang membuat
  jenjang lain tampil "-".
- Filter jenjang lalu kelas. Struktur kelas (contoh): caberawit AUD dan
  A–F; pra remaja dan remaja A–C; usia nikah A–B.
- Daftar target per jenis: Doa dan Surat dinilai Hafal/Belum; Makna
  Pegon dan Praktik Solat dinilai Bisa/Tidak.
- Matriks penilaian per anak: setiap sel bisa diubah dan tersimpan
  langsung; hitungan dan persentase ikut berubah tanpa memuat ulang.
- Tab Hasil: tabel persentase per generus (urut dari tertinggi) lengkap
  dengan progress bar, tombol Kirim WA ke orang tua, dan tombol Salin.
  Pesan WA berisi yang sudah hafal/bisa, yang masih perlu dihafal atau
  dilatih, dan persentase pencapaian. Karena nomor orang tua belum ada
  di data, tautan wa.me dibuka tanpa nomor dan pengurus memilih chat
  orang tua secara manual.
- Form Tambah Target untuk menambah target baru (jenjang, kelas, jenis,
  nama).
- Demo ini menyertakan 66 target contoh dan nilai contoh (keseluruhan
  sekitar 62 persen). Bukan data asli.

## Teknologi

- Satu file HTML (`index.html`): HTML, CSS, dan JavaScript dalam satu
  berkas, tanpa build step dan tanpa server.
- Tanpa CDN. Semua library dimuat lokal:
  - `lib/qrcode.js` (qrcode-generator 1.4.4) — membuat QR code.
  - `lib/jsqr.js` — membaca QR code dari kamera.
- Penyimpanan: localStorage di browser. Data hanya bertahan di browser
  itu selama tidak dihapus. Tidak ada akun, tidak ada sinkronisasi
  antar-perangkat di demo ini.
- Palet: krem hangat (#F6F1E9), kartu putih hangat, tombol coklat
  (#8A5A33) tanpa gradasi, aksen sage (#5F7A57 / #7C9A6E).
- Font: Plus Jakarta Sans / Inter / system-ui.
- Bahasa antarmuka: Bahasa Indonesia.

## Struktur Berkas

```
index.html                  Aplikasi lengkap (satu file, buka langsung)
landing.html                Halaman pengantar
lib/
  qrcode.js                 Pembuat QR code (qrcode-generator 1.4.4)
  jsqr.js                   Pembaca QR code dari kamera
docs/
  SPESIFIKASI.md            Spesifikasi fitur dan peran
  DESAIN.md                 Referensi dan catatan desain
  CATATAN-BUILD.md          Catatan pembangunan per versi (v1–v10)
README.md                   Berkas ini
.gitignore                  Berkas yang tidak ikut ke repo
.env.example                Contoh variabel lingkungan (tidak dipakai demo ini)
```

`index.html` adalah salinan dari `sistem-generus-standalone.html`
(demo v1 yang sama). Dinamai `index.html` supaya bisa dibuka langsung
sebagai halaman utama, termasuk lewat GitHub Pages.

## Batasan Demo

- Data contoh saja. Semua nama, jadwal, dan nilai di dalamnya adalah
  contoh berlabel CONTOH. Hapus dan isi ulang sebelum dipakai sungguhan.
- Data hanya tersimpan di browser (localStorage). Membuka di browser
  atau perangkat lain berarti data kosong lagi. Tidak ada sinkronisasi.
- Kirim WhatsApp masih berupa draf (tautan wa.me), belum pengiriman
  otomatis lewat API resmi.
- Scan QR butuh kamera dan izin kamera di browser. Di sebagian
  lingkungan pratinjau/tes, kamera tidak tersedia.
- Peran Daerah yang baca-saja masih berupa tafsiran dan belum
  dikonfirmasi sebagai aturan final.
- Struktur kelas pra remaja, remaja, dan usia nikah masih contoh dan
  belum dikonfirmasi.
- Karena tiap kelompok baru punya 1 jadwal selesai di data contoh,
  persentase kehadiran awal bisa terlihat ekstrem (100 persen atau
  0 persen) sampai ada sesi berikutnya.

## Rencana Berikutnya

- Backend multi-user (PHP + MariaDB) supaya data tersinkron antar
  pengurus dan perangkat, dengan akun per kelompok/desa/daerah.
- Pengiriman laporan WhatsApp otomatis lewat jalur resmi Meta.
- Rekap bulanan per kelompok.
- Konfirmasi aturan peran Daerah dan struktur kelas tiap jenjang.
- Penggantian data contoh dengan data asli.

## Lisensi

Demo ini dibuat untuk dipakai pengurus generus. Silakan dipakai dan
diubah untuk kebutuhan internal. Data contoh di dalamnya bukan data
nyata dan tidak boleh disajikan sebagai data asli.
