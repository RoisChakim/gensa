---
name: uiux
description: >
  Prinsip UI/UX untuk aplikasi web GENSA (dan sejenisnya). Pakai ini setiap
  kali membuat atau mengubah tampilan: layout, warna, teks, form, dan alur.
  Tujuannya: tampilan yang santai, jelas, dan gampang dipakai di HP oleh
  siapa pun — bukan yang terlihat "AI banget".
---

# UI/UX (GENSA)

## Palet & rasa (jangan diubah tanpa persetujuan pengguna)

- Latar: krem hangat `#F6F1E9`.
- Tombol utama: coklat `#8A5A33`, tanpa gradasi.
- Aksen: sage `#5F7A57` / `#7C9A6E`.
- JANGAN pakai latar gelap dan JANGAN pakai lime neon / warna neon.
- Satu gaya untuk semua halaman. Jangan tiap halaman beda gaya.

## Jelas dulu, bagus kemudian

- Satu layar, satu tugas utama. Jangan tumpuk banyak hal dalam satu layar.
- Judul dan tombol pakai kata kerja yang jelas ("Tambah Generus",
  "Cetak QR", "Kirim Laporan"), bukan kata yang ambigu.
- Bahasa Indonesia yang natural dan sederhana, seperti ngomong biasa.
  Bukan bahasa kaku dan bukan gaya AI.
- Angka penting (jumlah generus, persen kehadiran) tampil besar dan
  langsung kelihatan, jangan disembunyikan di balik klik.

## Gampang dipakai di HP

- Utamakan HP dulu (mobile-first). Semua harus bisa dipakai dengan
  satu tangan.
- Tombol dan area sentuh cukup besar, jangan terlalu rapat.
- Form sedikit saja: hanya minta data yang benar-benar dibutuhkan.
- Kalau ada langkah panjang, pecah jadi beberapa langkah pendek
  dengan penanda "Langkah 1 dari 3".
- Teks jangan terlalu kecil. Kontras cukup supaya terbaca di bawah
  sinar matahari.

## Konsisten

- Pakai komponen yang sama untuk hal yang sama (tombol, kartu, tabel,
  form). Jangan buat gaya baru untuk tiap halaman.
- Warna punya arti yang tetap: satu warna untuk aksi utama, satu
  untuk bahaya/hapus, satu untuk info. Jangan ganti-ganti.
- Pesan sukses/gagal selalu jelas dan muncul di tempat yang sama,
  dengan kata yang dimengerti ("Data tersimpan", bukan "Operasi
  berhasil 200").

## Jangan bikin bingung

- Jangan sembunyikan fungsi penting di balik menu yang dalam.
- Kalau suatu aksi tidak bisa dilakukan (misalnya peran Daerah
  baca-saja), jelaskan kenapa — jangan cuma tombolnya hilang tanpa
  penjelasan.
- Kosong itu bukan error: kalau belum ada data, tampilkan pesan
  yang ramah dan ajakan yang jelas ("Belum ada generus. Tambah dulu."),
  bukan halaman kosong atau error.
- Konfirmasi dulu sebelum hapus data. Tuliskan apa yang akan hilang.

## Sebelum selesai, cek ini

- [ ] Palet sesuai (krem, coklat, sage; tanpa gelap/neon).
- [ ] Bisa dipakai penuh dari HP.
- [ ] Teks natural, bukan gaya AI.
- [ ] Satu layar, satu tugas utama.
- [ ] Pesan sukses/gagal jelas dan ramah.
- [ ] Aksi hapus selalu minta konfirmasi.

Kalau ada yang belum terpenuhi, sebutkan dan perbaiki sebelum
diserahkan ke pengguna.
