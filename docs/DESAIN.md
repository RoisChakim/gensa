# Referensi desain SIM Generus (simgenerus.com) — dicatat 13 Nov 2026, 09.30 WIB

Sumber: penangkapan visual via browser cloud. Situs TIDAK punya landing
page — root (/) selalu redirect ke /login. Satu-satunya halaman publik:
login + /lupa-password. Dashboard di balik login TIDAK terlihat publik.

## Struktur — satu layar login, tanpa scroll (100vh, konten terpusat)
Latar solid gelap + pola dot-grid halus + glow radial hijau-limau lembut
di kiri atas, di belakang kartu. Tanpa header/menu/footer halaman.

Isi kartu (atas ke bawah):
1. Logo (kotak membulat ±32px, gradien kuning–limau, ikon centang gelap)
   + "SIM Generus" (tebal, putih) + subjudul "Platform Manajemen Generus"
2. Badge pill "● Masuk ke Platform" (teks limau, latar hijau gelap
   transparan, border limau tipis)
3. H1 "Selamat Datang" (putih, tebal, ±28–32px)
4. Form login (lihat bawah)
5. Garis pemisah tipis
6. Footer kartu: kiri "Sistem Informasi Manajemen Generus" (kecil, redup);
   kanan pill "v 2.0" (teks/border limau)

## Palet (diukur dari piksel screenshot)
- --bg: #060D07 (latar halaman)
- --bg2/dot: #071208
- glow: #19300E / #1B330E memudar ke #13280D
- --card: #0D1F0F, border hijau gelap sangat tipis, radius ±20–24px
- --input: #172819, border hijau-abu gelap tipis, radius ±10–12px
- --text: #FFFFFF; label/teks redup: abu-abu kehijauan
- --lime: #A3E635 (Tailwind lime-400) — badge, "Lupa password?", pill v2.0
- --btn-gradien: linear-gradient(90deg, #DFC018, #BBCA24, #9AD530);
  teks tombol hijau sangat gelap (±#060D07)

## Font
Nama font tidak tertera di UI publik. Ciri: sans-serif modern/geometris,
judul tebal spasi rapat, label form uppercase letter-spacing lebar.
Rebuild: Inter / Plus Jakarta Sans / system-ui.

## Form login (detail)
- Label "ALAMAT EMAIL" (uppercase, kecil, tebal, redup), field required,
  placeholder "nama@simgenerus.id"
- Label "PASSWORD" + tautan "Lupa password?" (limau, semibold) → /lupa-password
- Field password required, placeholder "••••••••", tombol mata (eye)
  di sisi kanan field
- Tombol submit "Masuk ke Sistem →": lebar penuh kartu, ±48px, gradien
  kuning–limau, teks gelap tebal, radius ±10–12px, glow limau lembut
- Tanpa tombol daftar, login sosial, "ingat saya", atau CAPTCHA

## /lupa-password
Layout dan kartu sama persis. Judul "Lupa Password", teks "Kami akan
mengirimkan tautan untuk mengatur ulang kata sandi Anda.", label
"ALAMAT EMAIL", field email placeholder "nama@simgenerus.id", tombol
"Kirim Tautan Reset", tautan "Kembali ke Login".

## Catatan rebuild
Yang bisa dibangun ulang persis dari referensi publik: layar login +
lupa-password di atas. Dashboard (statistik kehadiran, QR scan,
munaqosyah digital — disebut di hasil pencarian lama) TIDAK terlihat
publik; kalau mau dashboard, desain dari nol mengikuti fitur tersebut,
atau minta screenshot dashboard asli dari pengguna.
Logo asli (/logo.svg) TIDAK disalin — buat logo baru sesuai nama/brand
pengguna.
