# Spesifikasi — GENSA (Sistem Manajemen Generus)

Disusun 13 Nov 2026 dari penjelasan pengguna. Referensi visual: login
SIM Generus (lihat DESAIN.md). BUKAN salinan kode/aset mereka — tampilan
login mengikuti gayanya, isi & nama dari pengguna.

**Nama: GENSA.** Logo asli pengguna (monogram G, coklat) di `logo.png`.

**Hierarki (dikonfirmasi pengguna 13 Nov): 1 daerah → beberapa desa →
1 desa → beberapa kelompok.**

## Peran (4) — hanya pengurus yang bisa login
- **Admin (pengguna sendiri)**: akses penuh.
- **Daerah**: lihat SEMUA (semua desa + semua kelompok di dalamnya),
  tapi ada beberapa fitur yang TIDAK bisa diakses.
- **Desa**: lihat + edit + input kegiatan desanya sendiri dan beberapa
  kelompok dalam desa tersebut.
- **Kelompok**: CRUD hanya di kelompoknya sendiri.
- Siswa/generus TIDAK bisa akses web — mereka hanya absen dengan
  menunjukkan QR code mereka.

## Data generus (diinput dari kelompok)
- Nama, umur, kelas sekolah, tanggal lahir.
- Jenjang OTOMATIS dari kelas/status (aturan pengguna):
  - PAUD–SD = caberawit
  - SMP = pra remaja
  - SMA sederajat = remaja
  - Kuliah = usia nikah
  - Kerja = usia nikah
- Daftar nama tampil sesuai lingkup: kelompok → kelompoknya sendiri;
  desa → kelompok-kelompok dalam desanya; daerah → semua kelompok.
  Ada jumlah generus + hitungan per jenjang.

## QR code absensi
- Menu cetak QR code per generus (kartu QR untuk dicetak/dibawa).
- Generus menunjukkan QR saat hadir; pengurus mencatat kehadiran.

## Jadwal mengaji & laporan WhatsApp otomatis
- Pengurus (semua tingkat) membuat jadwal mengaji: hari ini, jam tertentu.
- Setelah 1–2 jam (durasi diatur pengurus), sistem OTOMATIS mengirim
  data persentase kehadiran ke grup WhatsApp:
  - Kelompok → ke grup kelompoknya.
  - Desa → persentase RATA-RATA kelompok-kelompok dalam 1 desa.
  - Daerah → persentase kehadiran TIAP-TIAP kelompok.
- Desa & daerah bisa dikirim MINGGUAN atau BULANAN (karena jadwal
  pengajian/KBM tiap kelompok berbeda-beda).
- Pola jadwal umum: kelompok = pengajian remaja 3x seminggu;
  desa = 1x seminggu; daerah = 1x sebulan.

## Catatan teknis jujur
- Kirim WA OTOMATIS beneran butuh jalur resmi Meta (WhatsApp Business
  API: nomor khusus + akun Meta Business + token) — sama seperti bot
  arus kas yang diparkir. Demo v1: laporan WA dibuat sebagai draf pesan
  siap kirim + tombol kirim (wa.me), pengiriman otomatis penuh menyusul
  lewat jalur resmi.
- Demo v1 = front-end kerja (login gaya SIM Generus + 4 peran + data
  contoh berlabel CONTOH + QR + absensi + laporan WA). Backend
  multi-user beneran (PHP+MariaDB di Docker / VPS) tahap berikutnya.

## Masih ditunggu dari pengguna
- NAMA/BRAND sistem (tampil di layar login).
- Organisasi/wilayah contoh untuk data demo (nama desa/kelompok contoh),
  atau pakai nama generik berlabel CONTOH.
