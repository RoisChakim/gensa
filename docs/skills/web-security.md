---
name: web-security
description: >
  Keamanan web anti-bobol untuk aplikasi web (GENSA dan sejenisnya). Pakai ini
  setiap kali menulis, mengubah, atau mereview kode web: login, peran (role),
  form, database, dan apa pun yang menyentuh data pengguna. Tujuannya satu:
  web tidak bisa dibobol lewat input, akun, atau celah umum.
---

# Keamanan Web (Anti-Bobol)

Aturan ini tidak boleh dipotong demi kecepatan atau kemudahan. Kalau ada
konflik antara "gampang" dan "aman", pilih aman, lalu jelaskan ke pengguna.

## 1. Jangan pernah percaya input pengguna

- Semua data dari form, URL, QR, file upload, dan API adalah input yang
  belum dipercaya — walau datang dari pengguna yang sudah login.
- Validasi di server, bukan cuma di browser. Cek di browser itu untuk
  kenyamanan saja; penyerang bisa melewatinya dengan mudah.
- Tolak yang tidak sesuai aturan (tipe, panjang, format), jangan coba
  "membersihkan" lalu tetap dipakai.

## 2. Cegah XSS (script jahat lewat input)

- Jangan pernah menampilkan data pengguna dengan `innerHTML` atau
  sejenisnya tanpa escape. Pakai `textContent` atau escape HTML.
- Jangan simpan lalu tampilkan HTML mentah dari pengguna.
- Kalau butuh menampilkan format, pakai daftar tag yang diizinkan saja,
  sisanya dibuang.

## 3. Cegah SQL injection & kebocoran database

- Jangan pernah gabungkan input pengguna ke query dengan tempel string.
  Pakai parameter / prepared statement.
- Akun database untuk aplikasi hanya boleh akses tabel yang ia butuhkan,
  bukan semua.
- Pesan error jangan bocorkan struktur database (nama tabel, kolom, query).

## 4. Login & peran (role) harus dicek di server

- Password jangan disimpan polos. Pakai hashing yang kuat (misalnya
  bcrypt/argon2) + salt.
- Session/token harus acak, punya masa berlaku, dan bisa dicabut.
- Peran (Admin, Daerah, Desa, Kelompok) dicek di server untuk SETIAP
  aksi — bukan cuma disembunyikan di tampilan. Menyembunyikan tombol
  bukan pengaman.
- Satu kelompok hanya boleh lihat/ubah datanya sendiri. Cek kepemilikan
  data di server sebelum tampilkan atau ubah.
- Batasi percobaan login (misalnya kunci sementara setelah beberapa kali
  gagal) supaya tidak bisa ditebak paksa (brute force).

## 5. Rahasia jangan masuk ke kode

- API key, password, token, dan kredensial JANGAN ditulis di kode,
  apalagi di kode yang dikirim ke browser atau di-push ke GitHub.
- Pakai environment variable / secret store. Kalau rahasia pernah
  bocor ke repo, anggap sudah diketahui orang dan segera ganti.
- Jangan tampilkan detail error server ke pengguna (stack trace,
  path file, versi library).

## 6. File upload & QR

- Upload hanya terima tipe file yang diizinkan, cek isi file bukan
  cuma ekstensinya, dan batasi ukurannya.
- File upload jangan bisa dijalankan sebagai kode. Simpan di luar
  folder yang bisa dieksekusi, dan beri nama acak.
- QR absensi hanya berisi ID acak yang tidak bisa ditebak, bukan data
  pribadi. Cek di server bahwa QR itu masih berlaku dan milik
  kelompok yang benar.

## 7. Komunikasi & sesi

- Pakai HTTPS selalu. Jangan kirim password/token lewat HTTP.
- Cookie sesi: `HttpOnly`, `Secure`, `SameSite`.
- Logout harus benar-benar menghapus sesi di server.

## 8. Sebelum selesai, cek ini

- [ ] Semua form divalidasi di server.
- [ ] Tidak ada `innerHTML` dengan data pengguna.
- [ ] Tidak ada query tempel string.
- [ ] Setiap aksi dicek peran + kepemilikan datanya di server.
- [ ] Tidak ada rahasia di kode / repo.
- [ ] Pesan error tidak bocorkan info dalam.

Kalau ada satu yang belum terpenuhi, sebutkan dengan jelas apa risikonya
dan jangan klaim web sudah aman.
