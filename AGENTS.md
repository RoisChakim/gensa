# GENSA — Aturan Kerja (dibaca Codex sebelum mulai)

## WAJIB: baca 3 skill ini dulu sebelum menulis atau mengubah kode apa pun

1. `docs/skills/web-security.md` — keamanan web anti-bobol. Tidak boleh
   dipotong demi kecepatan. Setiap form, login, peran, dan query harus
   lolos checklist di file itu.
2. `docs/skills/ponytail.md` — cara kerja: perubahan terkecil yang
   menyelesaikan tugas, tanpa fitur tambahan, tanpa abstraksi yang
   tidak diminta.
3. `docs/skills/uiux.md` — tampilan GENSA: krem hangat, coklat, sage.
   Tanpa latar gelap, tanpa neon. Bahasa natural, mobile-first.

Kalau ada konflik antar skill, urutannya: keamanan dulu, lalu Ponytail,
lalu UI/UX. Jangan langgar keamanan demi tampilan atau demi kode pendek.

## Cara kerja (hemat token, anti-ilang)

- Sebelum mulai, baca `STATE.md` (progres terakhir) — jangan baca ulang
  semua file.
- Satu perubahan kecil per sesi. Selesai → tes → tulis hasilnya ke
  `STATE.md` (apa yang berubah, apa yang belum, langkah berikut).
- Kalau limit hampir habis (~1%), berhenti dan simpan `STATE.md` dulu.
  Jangan paksakan lanjut.
- Jangan buat file baru kalau bisa ubah file yang sudah ada.
- Jangan masukkan rahasia (API key, password, token) ke kode atau repo.

## Aturan dari pengguna (wajib)

- SETIAP sebelum prompt ke Codex, kabari pengguna dulu. Jangan kirim
  prompt ke Codex tanpa memberitahu pengguna sebelumnya.
