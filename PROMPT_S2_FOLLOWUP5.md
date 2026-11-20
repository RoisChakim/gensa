Baik — kekhawatiranmu soal balapan antara pencatatan absen dan
penutupan pertemuan valid. Berikut desain penguncian yang WAJIB
dipakai, supaya tidak ada balapan. Pakai ini persis, lalu keluarkan
kodenya. Jangan tolak lagi karena hal ini — desainnya sudah
ditetapkan di sini.

## Desain transaksi + penguncian (wajib)

Semua operasi tulis absensi memakai SATU transaksi dengan
`SELECT ... FOR UPDATE` pada baris pertemuan, supaya pencatatan
dan penutupan saling mengunci (serial). Pola yang sudah ada di
Sesi 1 (changePassword, confirmReset) memakai `db.getClient()`,
BEGIN, COMMIT/ROLLBACK, `finally { client.release() }` — pakai
pola yang sama.

1. `recordAbsen` / `recordAbsenManual`:
   - BEGIN; `SELECT id, selesai_pada FROM pertemuan WHERE id = $1
     FOR UPDATE` (kunci baris pertemuan; bila tidak ada → ROLLBACK,
     404).
   - Cek generus (approved + dalam lingkup + jenjang cocok) — bila
     tidak cocok → ROLLBACK, 404.
   - Bila `selesai_pada` NULL: INSERT baris absensi bila belum ada,
     atau UPDATE status bila sudah ada. COMMIT.
   - Bila `selesai_pada` sudah terisi: ROLLBACK, 409 'Gunakan
     koreksi.'
   - Karena baris pertemuan dikunci, `selesaiPertemuan` tidak bisa
     berjalan bersamaan — tidak ada balapan.

2. `selesaiPertemuan`:
   - BEGIN; `SELECT id, selesai_pada, ... FROM pertemuan
     WHERE id = $1 FOR UPDATE` (kunci baris; bila tidak ada →
     ROLLBACK, 404; bila sudah selesai → ROLLBACK, 409).
   - UPDATE pertemuan SET selesai_pada = now().
   - INSERT alfa (satu INSERT ... SELECT ... WHERE NOT EXISTS
     seperti spesifikasi Sesi 2).
   - COMMIT.

3. `koreksiAbsensi`:
   - BEGIN; `SELECT ... FROM absensi WHERE id = $1 AND
     pertemuan_id = $2 FOR UPDATE` (kunci baris absensi);
     lalu cek pertemuan (selesai_pada + batas 24 jam) dan
     koreksi_count = 0; bila tidak memenuhi → ROLLBACK, 409.
   - UPDATE status + koreksi_count = 1. COMMIT.

## Yang diminta sekarang (satu jawaban, dua output)

1. `server/index.js` — SELURUH isi file yang baru, lengkap. Salin
   persis isi Sesi 1, tambahkan require qrcode, konstanta baru,
   fungsi-fungsi baru DENGAN transaksi + FOR UPDATE seperti di atas,
   dan routing baru. Ikuti spesifikasi prompt Sesi 2 untuk
   detail tiap fungsi.
2. `server/smoke-test-s2.js` — lengkap. Kelompok Contoh B
   (Desa Contoh 2) untuk isolasi. Ikuti pola smoke-test.js Sesi 1.

Jangan tambah file lain, jangan tanya lagi.
