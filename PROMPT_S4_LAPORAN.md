# Sesi 4 — Laporan Kehadiran Word (GENSA)

## Konteks

Repo: `~/workspace/gensa-repo`. Server Node.js (stdlib http + `pg` +
`bcryptjs` + `qrcode`), port 3101, file `server/index.js` (satu file,
tanpa Express/ORM). Database PostgreSQL 16, tabel sudah ada
(`daerah`, `desa`, `kelompok`, `users`, `generus`, `pertemuan`,
`absensi`) — **tidak ada migrasi baru di sesi ini**.

Sesi 1–3 selesai dan lolos smoke test:
- S1: akun, peran, tambah generus + persetujuan (QR + kode manual).
- S2: pertemuan + absensi (hadir/izin/sakit/alfa, koreksi 1x/24 jam).
- S3: jadwal (PATCH/DELETE pertemuan, halaman `jadwal.html`).

Aturan: perubahan terkecil yang lengkap. Jangan ubah kode S1–S3
kecuali perlu untuk tugas ini. Jangan masukkan rahasia ke kode.
Bahasa Indonesia yang natural. Palet GENSA: krem `#F6F1E9`, coklat
`#8A5A33`, sage `#5F7A57/#7C9A6E`, tanpa gradasi, tanpa latar gelap.
Halaman HTML: pakai `textContent`/`createElement` saja, jangan
`innerHTML` dengan data dari server. Validasi di server, jangan
percaya input klien. Semua data lewat parameter SQL (`$1`, `$2`, …),
jangan string interpolation untuk nilai.

Paket `docx` v9 **sudah terpasang** di `server/node_modules`
(`require('docx')` bisa dipakai langsung).

## Tugas 1 — Endpoint laporan kehadiran

### 1a. Fungsi hitung (dipakai kedua endpoint)

Buat satu fungsi `hitungLaporan(auth, dari, sampai, rincian)` yang
mengembalikan objek laporan. Aturan hitung (keputusan produk, jangan
diubah):

- Parameter: `dari` dan `sampai` tanggal `YYYY-MM-DD` (wajib).
  Validasi dengan `validPertemuanDate`. Tolak bila `dari > sampai`
  (400, "Tanggal awal tidak boleh setelah tanggal akhir.") dan bila
  rentang lebih dari 62 hari (400, "Rentang laporan maksimal 62 hari.").
- **Wilayah (scope):** peran `kelompok` hanya melihat generus di
  kelompoknya sendiri; `desa` hanya generus di kelompok-kelompok
  desanya; `daerah` dan `admin` melihat semua. Buat helper
  `generusScopeWhere(auth)` yang mengembalikan `{ sql, values }`
  dengan alias `g` untuk tabel `generus` dan `k` untuk `kelompok`
  yang di-JOIN — cerminan dari `pertemuanScopeWhere(auth)` yang
  sudah ada (lihat kutipan di bawah).
- **Baris per generus** (hanya generus `status = 'approved'` dalam
  scope, diurutkan kelompok, jenjang, nama):
  - `wajib` = jumlah baris `absensi` milik generus yang terikat ke
    `pertemuan` yang: `selesai_pada IS NOT NULL`, `tanggal` di
    antara `dari`–`sampai`, berada dalam scope pengguna
    (`pertemuanScopeWhere`, alias `p`), jenjang generus cocok
    (`g.jenjang = ANY(p.jenjang_target)`), DAN
    `p.tanggal >= DATE(g.decided_at)` (generus baru tidak dihitung
    wajib untuk pertemuan sebelum ia disetujui).
  - `hadir` = jumlah `absensi` dengan `status = 'hadir'` (dari
    himpunan wajib di atas). `izin` = jumlah `status` `izin` ATAU
    `sakit` (keduanya digabung jadi satu kategori "izin" di laporan).
    `alfa` = jumlah `status = 'alfa'`.
  - `persen` = `wajib > 0` ? `Math.round(hadir / wajib * 1000) / 10`
    : `null` (satu desimal; tampilkan "-" bila null).
  - Generus dengan `wajib = 0` tetap muncul di rincian.
  - Kolom baris: `id`, `nama`, `kelompok`, `desa`, `kelas_sekolah`,
    `jenjang`, `hadir`, `izin`, `alfa`, `wajib`, `persen`.
- **Baris rekap** (satu baris per kelompok dalam scope, diurutkan
  desa lalu kelompok): `kelompok`, `desa`, `generus` (jumlah generus
  approved di kelompok itu), `pertemuan` (jumlah pertemuan
  `selesai_pada IS NOT NULL` dengan `tanggal` di antara
  `dari`–`sampai` yang "milik" kelompok itu: tingkat kelompok dengan
  `kelompok_id` = kelompok itu, ATAU tingkat desa dengan `desa_id` =
  desa kelompok itu, ATAU tingkat daerah), `rata_persen` (rata-rata
  `persen` generus kelompok itu yang `wajib > 0`, satu desimal,
  `null` bila tidak ada).
- **Label wilayah** untuk judul: peran `kelompok` → nama kelompoknya;
  `desa` → nama desanya; `daerah`/`admin` → "Seluruh Daerah"
  (ambil nama dengan satu query sederhana; bila tidak ketemu,
  pakai label peran).
- Bentuk hasil: `{ periode: { dari, sampai }, wilayah, rekap: [...],
  rincian: [...] }`. Bila `rincian` false, kunci `rincian` dihapus
  (rekap saja).

### 1b. `GET /api/laporan?dari=...&sampai=...&rincian=0|1`

- Login wajib (pakai `auth` seperti handler lain). `rincian`
  opsional, default `0`; hanya `0`/`1` yang diterima.
- Kembalikan JSON dari `hitungLaporan`.

### 1c. `GET /api/laporan.docx?dari=...&sampai=...&rincian=0|1`

- Login wajib. Parameter dan hitung sama seperti 1b.
- Buat dokumen Word dengan paket `docx` (`Document`, `Packer`,
  `Paragraph`, `TextRun`, `Table`, `TableRow`, `TableCell`,
  `HeadingLevel`, `AlignmentType`, `WidthType`):
  - Judul: "Laporan Kehadiran Generus".
  - Baris info: `Periode: DD/MM/YYYY – DD/MM/YYYY`, `Wilayah:
    <label>`, `Dibuat: DD/MM/YYYY` (tanggal hari ini).
  - Tabel rekap dengan header: Kelompok | Desa | Generus |
    Pertemuan | Rata-rata % Hadir. Nilai null tampil "-".
  - Bila `rincian = 1`, tabel rincian setelah rekap dengan header:
    Nama | Kelompok | Kelas | Jenjang | Hadir | Izin | Alfa |
    Wajib | % Hadir. Label jenjang berbahasa Indonesia
    (caberawit → Caberawit, pra_remaja → Pra Remaja, remaja →
    Remaja, usia_nikah → Usia Nikah).
  - Kirim sebagai berkas: `Packer.toBuffer(document)` lalu
    `res.writeHead(200, { 'Content-Type':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'Content-Disposition': 'attachment; filename="laporan-kehadiran-<dari>_sd_<sampai>.docx"',
    'Content-Length': buffer.length, 'Cache-Control': 'no-store' })`
    lalu `res.end(buffer)`. Jangan lewat `sendJson`.
- Routing: sisipkan kedua GET ini di `handle()`, tepat sebelum
  `if (req.method === 'POST' && pathname === '/api/pertemuan')`.

## Tugas 2 — Halaman `server/public/laporan.html`

Ikuti konvensi `server/public/jadwal.html` (palet GENSA, `textContent`
saja, `fetch` dengan `credentials: 'same-origin'`, alihkan ke
`/login.html` bila 401):

- Form: input tanggal `dari` dan `sampai` (default: 7 hari lalu
  sampai hari ini), checkbox "Tampilkan rincian per generus",
  tombol preset "Minggu ini" (Senin–Minggu minggu berjalan) dan
  "Bulan ini" (tanggal 1 sampai hari ini) yang mengisi kedua input.
- Tombol "Tampilkan" → `GET /api/laporan?...` → tampilkan tabel
  rekap, dan tabel rincian bila diminta (tampilkan "-" untuk null).
- Tombol "Unduh Word" → arahkan browser ke
  `/api/laporan.docx?...` dengan parameter yang sama (unduhan
  langsung). Validasi di halaman: `dari` tidak boleh setelah
  `sampai`.
- Judul halaman: "Laporan Kehadiran".

## Yang TIDAK dikerjakan di sesi ini

- Jangan buat `server/smoke-test-s4.js` — smoke test ditulis Muse
  setelah ini.
- Jangan sentuh login Google, absen offline, atau link izin.
- Jangan ubah skema database.

## Kutipan kode yang sudah ada (jangan salin mentah — sesuaikan)

`pertemuanScopeWhere(auth)` (alias `p` untuk tabel `pertemuan`):

```js
function pertemuanScopeWhere(auth) {
  return {
    sql: `(
      $1::text IN ('admin', 'daerah')
      OR (
        $1::text = 'desa'
        AND (
          p.desa_id = $2::integer
          OR EXISTS (
            SELECT 1 FROM kelompok k
            WHERE k.id = p.kelompok_id AND k.desa_id = $2::integer
          )
        )
      )
      OR (
        $1::text = 'kelompok'
        AND (
          p.kelompok_id = $3::integer
          OR p.desa_id = (
            SELECT k.desa_id FROM kelompok k WHERE k.id = $3::integer
          )
          OR p.tingkat = 'daerah'
        )
      )
    )`,
    values: [auth.user.role, auth.user.desa_id, auth.user.kelompok_id],
  };
}
```

`validPertemuanDate(value)` — validasi `YYYY-MM-DD` (lihat
`server/index.js` baris ~863; pakai ulang apa adanya).

`sendJson(res, status, data, extraHeaders = {})` — kirim JSON.

Kolom tabel `generus` (relevan): `id`, `nama`, `kelas_sekolah`,
`jenjang` (enum `jenjang_generus`: `caberawit`, `pra_remaja`,
`remaja`, `usia_nikah`), `status` (`pending`/`approved`/`rejected`),
`decided_at` (timestamp, terisi saat disetujui/ditolak),
`kelompok_id`. Kolom `pertemuan`: `id`, `tingkat` (`kelompok`/
`desa`/`daerah`), `kelompok_id`, `desa_id`, `jenjang_target`
(`jenjang_generus[]` — di JS sudah dinormalisasi jadi array oleh
`normalisasiPertemuan`), `tanggal` (date), `selesai_pada`
(timestamp, null bila belum selesai). Kolom `absensi`: `id`,
`pertemuan_id`, `generus_id`, `status` (`hadir`/`izin`/`sakit`/
`alfa`).

## Format keluaran

Jawab HANYA dengan blok kode, satu blok per file/penyisipan, dengan
judul file dan penanda sisip yang persis. Contoh:

**`server/index.js` — sisipkan setelah `validPertemuanDate`, sebelum `async function createPertemuan`**

```js
...kode...
```

**`server/index.js` — sisipkan di `handle()`, tepat sebelum `if (req.method === 'POST' && pathname === '/api/pertemuan')`**

```js
...kode...
```

**`server/public/laporan.html`** (file lengkap)

```html
...file...
```

Jangan sertakan penjelasan panjang di luar blok kode. Jangan
menjalankan tes atau mengakses file — Muse yang menulis file dan
menjalankan tes.
