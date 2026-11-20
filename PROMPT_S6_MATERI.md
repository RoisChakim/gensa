# Sesi 6 — Materi & Penilaian (GENSA, PRD §10)

## Konteks

Repo: `~/workspace/gensa-repo`. Server Node.js (stdlib http + `pg` +
`bcryptjs` + `qrcode` + `docx` + `jsqr`), port 3101, file
`server/index.js` (satu file, tanpa Express/ORM). Database
PostgreSQL 16. Migrasi di `server/migrations/` dijalankan semua
berurutan oleh `server/migrate.js` (`node server/migrate.js`,
butuh `DATABASE_URL` dari `.env`) — file migrasi harus idempotent
(`IF NOT EXISTS`, tipe enum dalam blok `DO $$ ... EXCEPTION WHEN
duplicate_object THEN NULL; END $$;` seperti `001_init.sql`).

Sesi 1–5 selesai dan lolos smoke test (akun/peran, QR + absensi,
jadwal, laporan Word, scan HP kamera).

Aturan: perubahan terkecil yang lengkap. Jangan ubah kode S1–S5
kecuali perlu untuk tugas ini. Jangan masukkan rahasia ke kode.
Bahasa Indonesia yang natural. Palet GENSA: krem `#F6F1E9`, coklat
`#8A5A33`, sage `#5F7A57/#7C9A6E`, tanpa gradasi, tanpa latar gelap.
Halaman HTML: pakai `textContent`/`createElement` saja, jangan
`innerHTML` dengan data dari server. Validasi di server, jangan
percaya input klien. Semua data lewat parameter SQL (`$1`, `$2`, …),
jangan string interpolation untuk nilai. Transaksi + `FOR UPDATE`
untuk tulis yang bisa berlomba (ikuti pola S2).

## Tugas 1 — Migrasi `server/migrations/003_materi_penilaian.sql`

```sql
-- Enum + tabel tugas (materi hafalan) + penilaian per generus.
-- Tugas dibuat Kelompok (untuk kelompoknya sendiri) atau Admin
-- (kelompok_id NULL = berlaku untuk semua kelompok).
-- Nilai: tugas doa_surat -> hafal/belum; makna_pegon &
-- praktik_solat -> bisa/tidak (dicek di kode, bukan di CHECK).
```

- Enum `kategori_tugas`: `doa_surat`, `makna_pegon`,
  `praktik_solat`. Enum `nilai_penilaian`: `hafal`, `belum`,
  `bisa`, `tidak`.
- Tabel `tugas`: `id SERIAL PRIMARY KEY`, `judul TEXT NOT NULL
  CHECK (btrim(judul) <> '')`, `kategori kategori_tugas NOT
  NULL`, `kelompok_id INTEGER REFERENCES kelompok(id)` (boleh
  NULL), `dibuat_oleh INTEGER NOT NULL REFERENCES users(id)`,
  `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
  `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
- Tabel `penilaian`: `id SERIAL PRIMARY KEY`, `generus_id INTEGER
  NOT NULL REFERENCES generus(id)`, `tugas_id INTEGER NOT NULL
  REFERENCES tugas(id)`, `nilai nilai_penilaian NOT NULL`,
  `diubah_count INTEGER NOT NULL DEFAULT 0`,
  `dicatat_oleh INTEGER NOT NULL REFERENCES users(id)`,
  `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
  `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
  `UNIQUE (generus_id, tugas_id)`.

## Tugas 2 — Endpoint di `server/index.js`

### Helper scope tugas

```js
function tugasScopeWhere(auth) {
  // Mengembalikan { sql, values } dengan alias `t` untuk tabel tugas.
  // Kelompok: tugas kelompoknya sendiri + tugas global Admin
  // (kelompok_id IS NULL). Desa: tugas kelompok-kelompok desanya +
  // global. Daerah/Admin: semua.
}
```

Gunakan `generusScopeWhere(auth)` yang sudah ada (alias `g` +
`k`) untuk scope generus.

### `POST /api/tugas` — buat tugas

- Body: `{ judul, kategori, kelompok_id? }`. `judul` wajib
  (string 1–255, trim). `kategori` wajib salah satu dari
  `doa_surat`, `makna_pegon`, `praktik_solat`.
- Peran `kelompok`: `kelompok_id` diabaikan — tugas selalu untuk
  kelompoknya sendiri. Peran `admin`: boleh isi `kelompok_id`
  (tugas untuk kelompok itu) atau kosong (tugas global).
  Peran `desa`/`daerah` → 403 ("Hanya kelompok dan Admin yang
  bisa membuat tugas.").
- `kelompok_id` yang diisi harus ada (bila tidak ada → 400).
- Respons 201 `{ tugas }`.

### `GET /api/tugas` — daftar tugas yang terlihat

- Pakai `tugasScopeWhere(auth)`. Urut: kategori, judul.
  Sertakan `kelompok_nama` (nama kelompok pemilik, atau null
  bila global). Respons `{ tugas: [...] }`.

### `DELETE /api/tugas/:id` — hapus tugas

- Hanya Admin atau pembuat tingkatnya (kelompok hanya tugas
  kelompoknya sendiri; tugas global hanya Admin). Bila tugas
  sudah punya baris `penilaian` → 409 ("Tugas sudah memiliki
  penilaian."). Respons 200 `{ ok: true }`.

### `POST /api/penilaian` — catat/ubah nilai (upsert)

- Body: `{ generus_id, tugas_id, nilai }`. Ketiganya wajib.
- Validasi (berurutan): generus harus `status = 'approved'` dan
  dalam scope pengguna (bila tidak ada → 404 "Generus tidak
  ditemukan."); tugas harus terlihat oleh pengguna (bila tidak
  ada → 404 "Tugas tidak ditemukan."); nilai harus cocok dengan
  kategori tugas — `doa_surat` hanya `hafal`/`belum`,
  `makna_pegon`/`praktik_solat` hanya `bisa`/`tidak` (bila tidak
  cocok → 400 "Nilai tidak sesuai dengan kategori tugas.").
- Hak tulis: peran `kelompok` hanya untuk generus kelompoknya
  sendiri; peran `admin` untuk semua; peran `desa`/`daerah` →
  403 ("Hanya pengurus kelompok dan Admin yang bisa memberi
  nilai.").
- Aturan ubah (PRD: boleh diubah 2 kali, lebih dari itu minta
  izin Admin): bila belum ada baris → INSERT (`diubah_count`
  0). Bila sudah ada → ini perubahan: bila `diubah_count >= 2`
  dan pengguna bukan Admin → 403 ("Nilai sudah diubah 2 kali.
  Minta izin Admin untuk mengubah lagi."). Bila Admin yang
  mengubah → `diubah_count` kembali 0. Bila bukan Admin →
  `diubah_count + 1`. Selalu perbarui `updated_at = now()` dan
  `dicatat_oleh`.
- Pakai transaksi: `SELECT ... FOR UPDATE` pada baris penilaian
  yang ada (bila ada) supaya dua perubahan bersamaan tidak
  mengacaukan hitungan. Bila INSERT menabrak UNIQUE karena
  lomba → 409 ("Penilaian sudah ada. Muat ulang halaman.").
- Respons 200 `{ penilaian }` (baris lengkap).

### `GET /api/penilaian` — daftar + hasil

- Parameter opsional `kelompok_id` (angka positif). Peran
  `kelompok` dipaksa ke kelompoknya sendiri (abaikan parameter).
  Peran `desa` hanya boleh mempersempit ke kelompok di desanya
  (bila kelompok di luar desanya → 403). Peran `admin`/`daerah`
  boleh mempersempit ke kelompok mana pun.
- Respons `{ tugas, penilaian, hasil }`:
  - `tugas`: seperti `GET /api/tugas` (hanya yang terlihat).
  - `penilaian`: baris penilaian untuk generus dalam scope
    (dan kelompok yang dipilih bila ada): `{ id, generus_id,
    tugas_id, nilai, diubah_count, dicatat_oleh, created_at,
    updated_at }`.
  - `hasil`: satu baris per generus `approved` dalam scope:
    `{ generus_id, nama, kelas_sekolah, jenjang, kelompok,
    ortu_nama, ortu_hp, hafal, total_hafalan, persen }`.
    `total_hafalan` = jumlah tugas kategori `doa_surat` yang
    berlaku untuk kelompok generus itu (tugas kelompoknya +
    tugas global). `hafal` = jumlah penilaian `nilai = 'hafal'`
    pada tugas-tugas itu. `persen` = `total_hafalan > 0` ?
    `Math.round(hafal / total_hafalan * 1000) / 10` : `null`.
    Urut: kelompok, jenjang, nama.

## Tugas 3 — Halaman `server/public/materi.html`

Ikuti konvensi `jadwal.html` / `laporan.html` (palet GENSA,
`textContent` saja, `fetch` dengan `credentials: 'same-origin'`,
alihkan ke `/login.html` bila 401). Judul: "Materi & Penilaian".
Tiga bagian:

1. **Tugas** — daftar tugas dikelompokkan per kategori (judul
   kategori: "Doa & Surat", "Makna Pegon", "Praktik Solat"),
   tiap baris ada tombol Hapus (hanya bila boleh menghapus;
   tampilkan pesan server bila 409). Form tambah (hanya untuk
   peran kelompok/admin; sembunyikan untuk desa/daerah): input
   judul + select kategori + tombol "Tambah tugas".
2. **Penilaian** — matriks: baris = generus (nama + kelas +
   jenjang), kolom = tugas. Sel berisi tombol nilai saat ini
   ("Hafal"/"Belum"/"Bisa"/"Tidak") atau "—" bila belum dinilai;
   klik mengubah ke nilai pasangan (Hafal↔Belum, Bisa↔Tidak)
   lalu POST `/api/penilaian`. Di bawah nama generus tampilkan
   sisa ubah per sel yang sudah dinilai ("diubah 1x" / "terkunci
   — minta Admin" bila `diubah_count >= 2` dan bukan Admin;
   tombol nonaktif bila terkunci). Bila belum ada tugas atau
   belum ada generus, tampilkan pesan yang jelas.
3. **Hasil** — tabel per generus: Nama | Kelas | Jenjang |
   Hafal | Total | % Hasil. Bila `total_hafalan = 0`, tampilkan
   peringatan di atas tabel: "Belum ada tugas hafalan (Doa &
   Surat). Tambahkan tugas dulu." — dan untuk generus jenjang
   caberawit beri penanda khusus "(PAUD–SD: wajib ada tugas)".
   Tiap baris hasil punya tombol "Kirim WA" (tautan
   `https://wa.me/<nomor>?text=<pesan>`, nomor = `ortu_hp`
   dibersihkan ke digit saja, awalan `0` diganti `62`; bila
   tidak ada nomor, tombol nonaktif) dan tombol "Salin" (salin
   teks hasil ke clipboard via `navigator.clipboard.writeText`,
   tampilkan "Tersalin."). Pesan WA: `Hasil hafalan <nama>
   (<kelas>): <hafal>/<total> tugas hafal (<persen>%).`

## Yang TIDAK dikerjakan di sesi ini

- Jangan buat smoke test — ditulis Muse setelah ini.
- Jangan sentuh login Google, absen offline, atau link izin.
- Jangan ubah PWA/manifest (itu sesi terpisah).

## Kutipan kode yang sudah ada

`generusScopeWhere(auth)` (alias `g` + `k`, lihat
`server/index.js` — dipakai `hitungLaporan`). `fail(status,
message)` melempar `HttpError`. `sendJson(res, status, data)`.
`readJson(req)`, `optionalId(value, label)`,
`positiveId(value)`, `checkOrigin(req)` (dipanggil di `handle()`
untuk non-GET). Tabel `generus`: `id`, `nama`,
`kelas_sekolah`, `jenjang` (enum `jenjang_generus`), `status`
(`pending`/`approved`/`rejected`/`delete_pending`),
`kelompok_id`, `ortu_nama`, `ortu_hp`, `created_at`.
`listGenerus` memakai pola scope inline (lihat file) —
`generusScopeWhere` setara dengan itu.

## Format keluaran

Jawab HANYA dengan blok kode, satu blok per file/penyisipan,
dengan judul file dan penanda sisip yang persis:

**`server/migrations/003_materi_penilaian.sql`** (file lengkap)

```sql
...file...
```

**`server/index.js` — sisipkan setelah `buatLaporanWord`, sebelum `async function createPertemuan`**

```js
...kode...
```

**`server/index.js` — sisipkan di `handle()`, tepat sebelum `if (req.method === 'POST' && pathname === '/api/pertemuan')`**

```js
...kode...
```

**`server/public/materi.html`** (file lengkap)

```html
...file...
```

Jangan sertakan penjelasan panjang di luar blok kode. Jangan
menjalankan tes atau mengakses file — Muse yang menulis file dan
menjalankan migrasi + tes.
