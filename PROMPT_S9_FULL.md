# Sesi 9 — Absen Offline (GENSA, PRD §7 "Offline") — PROMPT LENGKAP

Semua konteks yang dibutuhkan ada di file ini (Codex tidak boleh
mengakses file). Kerjakan Tugas 1–5 di bawah. Dua koreksi sudah
diterapkan di contoh: `Set` memakai `.add()`, dan antrean dikirim
bertahap maksimal 200 item per permintaan.

# Sesi 9 — Absen Offline (GENSA, PRD §7 "Offline")

## Konteks

Repo: `~/workspace/gensa-repo`. Server Node.js (stdlib http + `pg`),
port 3101, file `server/index.js`. Halaman statis di
`server/public/`, halaman scan di `server/public/scan.html`
(getUserMedia + jsQR, sudah jalan sejak Sesi 5).

Sesi 1–8 selesai dan lolos smoke test (akun/peran, QR + absensi,
jadwal, laporan Word, scan HP kamera, materi & penilaian, PWA +
reset password, login Google).

**Aturan dari PRD (jangan dilanggar):**
- Absensi tetap jalan saat offline; otomatis ter-upload ke database
  saat ada internet; pastikan tidak double kirim.
- Perangkat: HP dan web. Tidak perlu unduh data dulu sebelum
  offline — TAPI daftar generus (nama + kode) perlu diunduh SEKALI
  saat online supaya QR bisa dikenali saat offline. Itu satu-satunya
  persiapan yang dibutuhkan.
- Kalau dua perangkat mencatat generus yang sama / status beda:
  yang **"hadir" yang menang**.
- Risiko data hilang kalau HP ganti/hilang sebelum sempat sync —
  diterima sebagai batasan (catat di STATE.md oleh Muse, bukan
  di kode).

Aturan: perubahan terkecil yang lengkap. Jangan masukkan rahasia ke
kode. Bahasa Indonesia yang natural. Palet GENSA: krem `#F6F1E9`,
coklat `#8A5A33`, sage `#5F7A57/#7C9A6E`. Halaman HTML: pakai
`textContent`/`createElement` saja, jangan `innerHTML` dengan data
dari server. Validasi di server, jangan percaya input klien. Semua
query pakai parameter (`$1`, `$2`), jangan tempel string.

## Tugas 1 — Migrasi `server/migrations/005_absen_offline.sql` (file baru)

```sql
CREATE TABLE IF NOT EXISTS sync_items (
  id SERIAL PRIMARY KEY,
  pertemuan_id INTEGER NOT NULL REFERENCES pertemuan(id),
  generus_id INTEGER NOT NULL REFERENCES generus(id),
  client_id TEXT NOT NULL CHECK (btrim(client_id) <> ''),
  status status_absensi NOT NULL,
  dicatat_pada TIMESTAMPTZ,
  dicatat_oleh INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pertemuan_id, client_id)
);

CREATE INDEX IF NOT EXISTS sync_items_pertemuan_id_idx
  ON sync_items (pertemuan_id);

ALTER TABLE absensi ADD COLUMN IF NOT EXISTS dicatat_pada TIMESTAMPTZ;
```

## Tugas 2 — Endpoint daftar generus di `server/index.js`

Fungsi baru (letakkan tepat sebelum `recordAbsen`):

```js
async function daftarPertemuan(res, auth, id) {
  // Memuat pertemuan + cek kelola (404 bila tidak ada / tidak berhak).
  // Ambil SEMUA generus approved yang masuk lingkup + jenjang
  // pertemuan — logika SAMA seperti generusInScope di bawah,
  // hanya tanpa filter id:
  //   g.status = 'approved'
  //   AND g.jenjang = ANY(pertemuan.jenjang_target)
  //   AND ((tingkat='kelompok' AND g.kelompok_id = pertemuan.kelompok_id)
  //     OR (tingkat='desa' AND k.desa_id = pertemuan.desa_id)
  //     OR tingkat='daerah')
  // Kembalikan: { pertemuan: normalisasiPertemuan(pertemuan),
  //   generus: [{ id, nama, kelas_sekolah, jenjang, kode_manual, qr_token }] }
  //   (urut nama, id).
}
```

CATATAN KEAMANAN (jangan dihapus): respons ini memuat kode_manual
dan qr_token — data yang sama dengan yang sudah tampil di halaman
cetak-qr untuk pengurus yang sama. Hanya pengurus yang boleh
mengelola pertemuan ini yang boleh mengunduhnya (canManagePertemuan).

## Tugas 3 — Endpoint sync di `server/index.js`

Fungsi baru (letakkan tepat setelah `recordAbsenManual`):

```js
async function syncAbsensi(req, res, auth, id) {
  // 1. Muat pertemuan (404 bila tidak ada), canManagePertemuan.
  //    Bila pertemuan.selesai_pada !== null → fail 409,
  //    'Pertemuan sudah selesai. Gunakan koreksi.'
  // 2. Baca body: { items: [...] }. items HARUS array, 1–200 item,
  //    kalau tidak → fail 400, 'Daftar antrean tidak valid.'
  // 3. Transaksi + SELECT pertemuan ... FOR UPDATE (pola yang sama
  //    seperti recordAbsen/recordAbsenManual).
  // 4. Untuk tiap item, berurutan, hasilkan satu entri di `hasil`:
  //    - Validasi bentuk: generus_id = positiveId(item.generus_id),
  //      status HARUS salah satu dari 'hadir'/'izin'/'sakit'
  //      ('alfa' TIDAK boleh dikirim offline), client_id string
  //      1–64 karakter, dicatat_pada opsional (string ISO; bila
  //      tidak bisa diparse Date.parse ATAU lebih dari 24 jam di
  //      masa depan → pakai NULL). Bila tidak valid →
  //      { generus_id: <nilai apa adanya atau null>,
  //        diterima: false, alasan: 'Data antrean tidak valid.' }
  //    - Bila sudah ada baris sync_items dengan (pertemuan_id,
  //      client_id) yang sama → lewati, hasil
  //      { generus_id, diterima: true, sudah_ada: true,
  //        status: <status yang tersimpan di sync_items> }.
  //      (Ini yang mencegah double kirim saat klien mengulang.)
  //    - generusInScope(pertemuan, generus_id, client) → bila null →
  //      { generus_id, diterima: false,
  //        alasan: 'Generus tidak ditemukan dalam lingkup pertemuan.' }
  //      (jangan simpan ke sync_items — supaya percobaan ulang
  //      dengan client_id yang sama masih bisa diproses).
  //    - Aturan "hadir yang menang" pada tabel absensi:
  //      * Belum ada baris → INSERT (pertemuan_id, generus_id,
  //        status, dicatat_oleh, dicatat_pada).
  //      * Sudah ada dan status lama = 'hadir' → biarkan,
  //        hasil { diterima: true, status: 'hadir' }.
  //      * Sudah ada, status lama bukan 'hadir', status baru =
  //        'hadir' → UPDATE ke 'hadir' (+ dicatat_oleh,
  //        dicatat_pada, updated_at = now()).
  //      * Sudah ada, keduanya bukan 'hadir' → biarkan status lama,
  //        hasil { diterima: true, status: <status lama> }.
  //    - Simpan ke sync_items (pertemuan_id, generus_id, client_id,
  //      status = status AKHIR yang berlaku di absensi,
  //      dicatat_pada, dicatat_oleh) untuk tiap item yang diterima.
  // 5. COMMIT, lalu sendJson(res, 200, { hasil }).
  //    Respons 200 walau sebagian item ditolak — penolakan ada
  //    per item di `hasil`, bukan error HTTP.
}
```

## Tugas 4 — Routing di `handle()` (`server/index.js`)

Sisipkan tepat sebelum blok `const absenMatch = ...`:

```js
const daftarMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)\/daftar$/);
if (req.method === 'GET' && daftarMatch) {
  await daftarPertemuan(res, auth, positiveId(daftarMatch[1]));
  return;
}

const syncMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)\/sync$/);
if (req.method === 'POST' && syncMatch) {
  await syncAbsensi(req, res, auth, positiveId(syncMatch[1]));
  return;
}
```

## Tugas 5 — Offline di `server/public/scan.html`

Baca dulu file `scan.html` (Muse akan memberikannya di bawah
sebagai konteks — file lengkap). Ubah seminimal mungkin; jangan
tulis ulang halaman dari nol. Jangan ubah alur online yang sudah
jalan (POST /absen tetap dipakai saat online).

### 5a. HTML baru — sisipkan setelah `</section>` bagian "Hasil scan" (sebelum `<section class="kartu" aria-labelledby="judul-riwayat">`)

```html
<section class="kartu" aria-labelledby="judul-antrean">
  <h2 id="judul-antrean">Antrean offline</h2>
  <p id="pesan-antrean" role="status">Belum ada kehadiran offline.</p>
  <p id="pesan-daftar" role="status"></p>
  <button id="tombol-kirim" type="button" disabled>Kirim antrean</button>
</section>
```

### 5b. JavaScript baru — sisipkan tepat sebelum `async function muatHalaman() {`

```js
// --- Absen offline: antrean di localStorage, sync saat online. ---
const KUNCI_DAFTAR = (id) => 'gensa-daftar-' + id;
const KUNCI_ANTREAN = (id) => 'gensa-antrean-' + id;

const pesanAntrean = document.getElementById('pesan-antrean');
const pesanDaftar = document.getElementById('pesan-daftar');
const tombolKirim = document.getElementById('tombol-kirim');

let antrean = [];

function bacaAntrean(id) {
  try {
    const data = JSON.parse(localStorage.getItem(KUNCI_ANTREAN(id)) || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function simpanAntrean(id, daftar) {
  try {
    localStorage.setItem(KUNCI_ANTREAN(id), JSON.stringify(daftar));
  } catch {
    // Penyimpanan penuh — antrean tetap di memori sesi ini.
  }
}

function bacaDaftar(id) {
  try {
    const data = JSON.parse(localStorage.getItem(KUNCI_DAFTAR(id)) || 'null');
    return data && Array.isArray(data.generus) ? data : null;
  } catch {
    return null;
  }
}

function perbaruiAntrean() {
  const id = pertemuan.value;
  antrean = id ? bacaAntrean(id) : [];
  const jumlah = antrean.length;
  pesanAntrean.textContent = jumlah === 0
    ? 'Belum ada kehadiran offline.'
    : jumlah + ' kehadiran offline menunggu dikirim.';
  tombolKirim.disabled = jumlah === 0 || sedangMengirim;
  tombolKirim.textContent = jumlah === 0
    ? 'Kirim antrean'
    : 'Kirim antrean (' + jumlah + ')';
}

async function unduhDaftar(id) {
  try {
    const data = await api('/api/pertemuan/' + encodeURIComponent(id) + '/daftar');
    if (!Array.isArray(data?.generus)) return;
    try {
      localStorage.setItem(KUNCI_DAFTAR(id), JSON.stringify({
        diunduh_pada: new Date().toISOString(),
        generus: data.generus
      }));
    } catch {
      // Penyimpanan penuh — lanjut tanpa cache.
    }
    pesanDaftar.textContent = 'Daftar ' + data.generus.length +
      ' generus tersimpan di HP ini untuk absen offline.';
  } catch (error) {
    if (error.status === 401) return;
    const cache = bacaDaftar(id);
    pesanDaftar.textContent = cache
      ? 'Daftar generus memakai simpanan lama (' + cache.generus.length + ' generus).'
      : 'Daftar generus belum tersimpan — absen offline butuh unduh sekali saat online.';
  }
}

function cariGenerusOffline(id, kode) {
  const cache = bacaDaftar(id);
  if (!cache) return null;
  const kunci = String(kode).trim().toLowerCase();
  return cache.generus.find((item) =>
    (typeof item.kode_manual === 'string' &&
      item.kode_manual.toLowerCase() === kunci) ||
    (typeof item.qr_token === 'string' &&
      item.qr_token.toLowerCase() === kunci)
  ) || null;
}

function buatClientId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'offline-' + Date.now().toString(36) + '-' +
    Math.random().toString(36).slice(2, 10);
}

function simpanOffline(kode, waktuScan) {
  const id = pertemuan.value;
  if (!id) return null;
  const generus = cariGenerusOffline(id, kode);
  if (!generus) return null;

  const daftar = bacaAntrean(id);
  if (daftar.some((item) => item.generus_id === generus.id)) {
    return { nama: generus.nama, sudahAda: true };
  }
  daftar.push({
    generus_id: generus.id,
    status: 'hadir',
    client_id: buatClientId(),
    dicatat_pada: waktuScan.toISOString()
  });
  simpanAntrean(id, daftar);
  antrean = daftar;
  perbaruiAntrean();
  return { nama: generus.nama, sudahAda: false };
}

async function kirimAntrean() {
  const id = pertemuan.value;
  if (!id || sedangMengirim) return;
  const daftar = bacaAntrean(id);
  if (daftar.length === 0) return;

  sedangMengirim = true;
  perbaruiTombol();
  pesanAntrean.textContent = 'Mengirim ' + daftar.length + ' kehadiran…';

  let sisa = [...daftar];
  let ditolak = 0;
  let gagalJaringan = false;

  try {
    while (sisa.length > 0) {
      const sebelum = sisa.length;
      const potongan = sisa.slice(0, 200);
      let data;
      try {
        data = await api('/api/pertemuan/' + encodeURIComponent(id) + '/sync', {
          method: 'POST',
          body: JSON.stringify({ items: potongan })
        });
      } catch (error) {
        if (error.status === 401) return;
        gagalJaringan = true;
        break;
      }
      const hasil = Array.isArray(data?.hasil) ? data.hasil : [];
      const diterima = new Set();
      hasil.forEach((item, index) => {
        if (item?.diterima) diterima.add(potongan[index]?.client_id);
        else ditolak += 1;
      });
      sisa = sisa.filter((item) => !diterima.has(item.client_id));
      if (sisa.length === sebelum) break; // tidak ada kemajuan — hentikan
    }
  } finally {
    sedangMengirim = false;
    perbaruiTombol();
  }

  simpanAntrean(id, sisa);
  antrean = sisa;
  perbaruiAntrean();
  if (gagalJaringan) {
    pesanAntrean.textContent = 'Gagal mengirim antrean. Coba lagi saat online.';
  } else {
    pesanAntrean.textContent = sisa.length === 0
      ? (ditolak === 0
        ? 'Semua kehadiran offline sudah terkirim.'
        : 'Kehadiran terkirim, ' + ditolak + ' ditolak server.')
      : sisa.length + ' kehadiran belum terkirim — coba lagi saat online.';
  }
}```

### 5c. Wiring — ubah HANYA bagian berikut (sebut penanda sisipnya)

1. Di `catatAbsen`, di dalam `catch (error) {`, TEPAT SETELAH baris
   `if (sesi !== versiPertemuan || error.status === 401) return;`,
   sisipkan (sebelum `let pesan;`):

```js
if (!error.status) {
  // Gagal jaringan (bukan dari server) → simpan offline.
  const offline = simpanOffline(kode, waktuScan);
  if (offline) {
    const jam = formatJam.format(waktuScan);
    tampilkanHasil(
      '✓ Hadir tersimpan offline — ' + offline.nama + ' · ' + jam +
      (offline.sudahAda ? ' (sudah ada di antrean)' : ' · akan dikirim saat online.'),
      'sukses'
    );
    tambahRiwayat(jam, offline.nama, 'Hadir (offline)');
    if (manual) inputKode.value = '';
  } else {
    tampilkanHasil(
      'Tidak ada internet dan kode tidak dikenal offline. Unduh daftar generus dulu saat online.',
      'error'
    );
  }
  return;
}
```

2. Di handler `pertemuan.addEventListener('change', ...)`, TEPAT
   SETELAH baris `perbaruiTombol();` di akhir handler, sisipkan:

```js
perbaruiAntrean();
if (pertemuan.value) {
  void unduhDaftar(pertemuan.value);
  void kirimAntrean();
}
```

3. Tepat sebelum `void muatHalaman();` di akhir skrip, sisipkan:

```js
tombolKirim.addEventListener('click', () => { void kirimAntrean(); });
window.addEventListener('online', () => { void kirimAntrean(); });
```

4. Di akhir `muatHalaman()`, tepat sebelum `perbaruiTombol();`
   terakhir, sisipkan:

```js
perbaruiAntrean();
```

## Yang TIDAK dikerjakan di sesi ini

- Jangan buat smoke test — ditulis Muse setelah ini.
- Jangan sentuh login Google atau link izin.
- Jangan ubah `sw.js` (halaman scan sudah di-cache sejak Sesi 7;
  antrean memakai localStorage, bukan service worker).
- Jangan ubah alur online (POST /absen) atau endpoint lain.
- Jangan tambah dependensi baru.

## Kutipan kode yang sudah ada

`generusInScope` (sekitar baris 897):

```js
async function generusInScope(pertemuan, generusId, client = db) {
  const result = await client.query(
    `SELECT g.id, g.kelompok_id, g.nama, g.kelas_sekolah, g.jenjang, g.status
     FROM generus g
     JOIN kelompok k ON k.id = g.kelompok_id
     WHERE g.id = $1
       AND g.status = 'approved'
       AND g.jenjang = ANY($2::jenjang_generus[])
       AND (
         ($3::text = 'kelompok' AND g.kelompok_id = $4::integer)
         OR ($3::text = 'desa' AND k.desa_id = $5::integer)
         OR $3::text = 'daerah'
       )
     FOR SHARE OF g, k`,
    [
      generusId, pertemuan.jenjang_target, pertemuan.tingkat,
      pertemuan.kelompok_id, pertemuan.desa_id,
    ]
  );

  return result.rows[0] || null;
}
```

Pola transaksi + FOR UPDATE (dari `recordAbsen`, sekitar baris 1939):

```js
const client = await db.getClient();
try {
  await client.query('BEGIN');
  const locked = await client.query(
    'SELECT * FROM pertemuan WHERE id = $1 FOR UPDATE',
    [id]
  );
  // ... kerja ...
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

## Format keluaran

Jawab HANYA dengan blok kode, satu blok per file/penyisipan,
dengan judul file dan penanda sisip yang persis:

**`server/migrations/005_absen_offline.sql`** (file lengkap)

```sql
...file...
```

**`server/index.js` — daftarPertemuan (sebelum recordAbsen)**

```js
...fungsi...
```

**`server/index.js` — syncAbsensi (setelah recordAbsenManual)**

```js
...fungsi...
```

**`server/index.js` — routing daftar + sync (sebelum `const absenMatch`)**

```js
...baris...
```

**`server/public/scan.html` — section antrean offline (setelah section Hasil scan)**

```html
...tambahan...
```

**`server/public/scan.html` — fungsi offline (sebelum `async function muatHalaman()`)**

```js
...fungsi...
```

**`server/public/scan.html` — wiring (3 sisipan kecil, sebut penanda sisipnya)**

```js
...tambahan...
```

Jangan sertakan penjelasan panjang di luar blok kode. Jangan
menjalankan tes atau mengakses file — Muse yang menulis file
dan menjalankan tes.

## Status proyek (ringkas — dari STATE.md)

- GENSA: server Node.js stdlib http + `pg`, port 3101,
  `server/index.js` (~2.700 baris setelah Sesi 8), halaman statis
  di `server/public/`, migrasi di `server/migrations/`
  (001 akun/generus, 002 pertemuan/absensi, 003 materi,
  004 google_sub).
- Sesi 1–8 selesai, semua smoke test lulus (S1 11/11, S2 15/15,
  S3 11/11, S4 8/8, S5 7/7, S6 7/7, S7 6/6, S8 8/8).
- Tabel penting: `users` (id, email, password_hash, role
  admin/daerah/desa/kelompok, desa_id, kelompok_id,
  must_change_password, active, google_sub), `generus`
  (kelompok_id, nama, tanggal_lahir, kelas_sekolah, tingkat,
  jenjang GENERATED, ortu_*, status pending/approved/rejected/
  delete_pending, qr_token 32 hex, kode_manual 6 karakter),
  `pertemuan` (tingkat kelompok/desa/daerah, kelompok_id, desa_id,
  jenjang_target jenjang_generus[], tanggal, dibuat_oleh,
  selesai_pada), `absensi` (pertemuan_id, generus_id, status
  hadir/izin/sakit/alfa, dicatat_oleh, koreksi_count,
  UNIQUE(pertemuan_id, generus_id)), `sessions` (token, user_id,
  expires_at, revoked).
- Kontrak handler: fungsi menerima `(req, res, auth)` atau
  `(res, auth, ...)`; `auth = { user, token }` — akses peran
  lewat `auth.user.role`, `auth.user.kelompok_id`,
  `auth.user.desa_id`, `auth.user.id` (BUKAN `auth.role` atau
  `auth.id`). Query DB lewat `db.query(...)` / `db.getClient()`
  (BUKAN `pool`). Error lewat `fail(status, pesan)` (melempar
  HttpError). Respons lewat `sendJson(res, status, data)`.
- Pola transaksi: `db.getClient()` → `BEGIN` → `SELECT ...
  FOR UPDATE` → kerja → `COMMIT`, catch → `ROLLBACK`,
  finally → `client.release()`.
- `jenjang_target` dari pg datang sebagai string `'{a,b}'` —
  selalu lewatkan lewat `normalisasiPertemuan()` sebelum dikirim
  sebagai respons.

## Skill 1 — Keamanan web (wajib, ringkas tapi lengkap)

- Jangan pernah percaya input pengguna; validasi di server, bukan
  cuma di browser. Tolak yang tidak sesuai aturan.
- Jangan tampilkan data pengguna dengan `innerHTML`; pakai
  `textContent` atau escape HTML.
- Jangan gabungkan input ke query dengan tempel string; pakai
  parameter / prepared statement. Pesan error jangan bocorkan
  struktur database.
- Password di-hash (bcrypt) + salt. Session/token acak, punya masa
  berlaku, bisa dicabut. Peran dicek di server untuk SETIAP aksi
  (menyembunyikan tombol bukan pengaman). Satu kelompok hanya boleh
  lihat/ubah datanya sendiri — cek kepemilikan di server. Batasi
  percobaan login.
- Rahasia (API key, password, token) JANGAN di kode atau repo;
  pakai environment variable. Jangan tampilkan stack trace / path
  file ke pengguna.
- QR absensi hanya berisi ID acak yang tidak bisa ditebak, bukan
  data pribadi. Cek di server bahwa QR itu masih berlaku dan milik
  kelompok yang benar.
- Pakai HTTPS. Cookie sesi HttpOnly, Secure, SameSite. Logout
  benar-benar menghapus sesi di server.

## Skill 2 — Ponytail (perubahan terkecil)

- Kode terbaik adalah kode yang tidak ditulis. Selesaikan tugas
  dengan perubahan terkecil yang lengkap: pakai helper / pola yang
  sudah ada di codebase; jangan tambah fitur, opsi, abstraksi,
  atau dependensi yang tidak diminta; jangan buat file baru kalau
  bisa ubah file yang sudah ada.
- Jangan potong: validasi di batas kepercayaan, error handling
  yang mencegah kehilangan data, keamanan.
- Satu perubahan kecil per sesi; sertakan tes untuk logika baru
  yang tidak sepele.

## Skill 3 — UI/UX GENSA

- Palet: latar krem hangat `#F6F1E9`, tombol utama coklat
  `#8A5A33` tanpa gradasi, aksen sage `#5F7A57/#7C9A6E`. JANGAN
  latar gelap, JANGAN lime neon / warna neon. Satu gaya untuk
  semua halaman.
- Satu layar, satu tugas utama. Judul/tombol pakai kata kerja yang
  jelas. Bahasa Indonesia natural dan sederhana.
- Mobile-first: tombol dan area sentuh cukup besar, form sedikit
  saja, teks jangan terlalu kecil.
- Pesan sukses/gagal jelas dan ramah ("Data tersimpan", bukan
  "Operasi berhasil 200"). Konfirmasi dulu sebelum hapus.
- Kosong itu bukan error: tampilkan pesan ramah + ajakan
  ("Belum ada generus. Tambah dulu.").

## Helper yang sudah ada di server/index.js

```js
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new HttpError(status, message);
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

function requiredString(value, label, max = 255) {
  if (typeof value !== 'string') fail(400, `${label} wajib diisi.`);
  const result = value.trim();
  if (!result || result.length > max) {
    fail(400, `${label} tidak valid.`);
  }
  return result;
}

function positiveId(value, label = 'ID') {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    !/^[1-9]\d*$/.test(String(value))
  ) {
    fail(400, `${label} tidak valid.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > 2147483647) {
    fail(400, `${label} tidak valid.`);
  }
  return number;
}

async function readJson(req) {
  // Wajib Content-Type application/json; maks 100 KB (MAX_BODY);
  // mengembalikan objek JSON (bukan array, bukan null);
  // gagal → fail 415 / 413 / 400.
  // (Implementasi lengkap sudah ada — pakai apa adanya.)
}

// pg mengembalikan kolom jenjang_generus[] sebagai string '{a,b}'.
function normalisasiPertemuan(pertemuan) {
  if (!pertemuan) return pertemuan;
  if (typeof pertemuan.jenjang_target === 'string') {
    const isi = pertemuan.jenjang_target.slice(1, -1);
    pertemuan.jenjang_target = isi ? isi.split(',') : [];
  }
  return pertemuan;
}

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

function canManagePertemuan(auth, pertemuan) {
  const user = auth.user;
  if (user.role === 'admin') return;
  if (
    user.role === pertemuan.tingkat &&
    (
      (user.role === 'kelompok' && user.kelompok_id === pertemuan.kelompok_id) ||
      (user.role === 'desa' && user.desa_id === pertemuan.desa_id) ||
      user.role === 'daerah'
    )
  ) {
    return;
  }
  fail(403, 'Anda tidak memiliki akses untuk mengelola pertemuan ini.');
}

async function generusInScope(pertemuan, generusId, client = db) {
  const result = await client.query(
    `SELECT g.id, g.kelompok_id, g.nama, g.kelas_sekolah, g.jenjang, g.status
     FROM generus g
     JOIN kelompok k ON k.id = g.kelompok_id
     WHERE g.id = $1
       AND g.status = 'approved'
       AND g.jenjang = ANY($2::jenjang_generus[])
       AND (
         ($3::text = 'kelompok' AND g.kelompok_id = $4::integer)
         OR ($3::text = 'desa' AND k.desa_id = $5::integer)
         OR $3::text = 'daerah'
       )
     FOR SHARE OF g, k`,
    [
      generusId, pertemuan.jenjang_target, pertemuan.tingkat,
      pertemuan.kelompok_id, pertemuan.desa_id,
    ]
  );
  return result.rows[0] || null;
}
```

`recordAbsen` (lengkap — pola yang harus diikuti `syncAbsensi`):

```js
async function recordAbsen(req, res, auth, id) {
  const existing = await db.query(
    'SELECT * FROM pertemuan WHERE id = $1',
    [id]
  );
  if (existing.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');
  canManagePertemuan(auth, existing.rows[0]);

  const body = await readJson(req);
  if (typeof body.kode !== 'string') fail(404, 'Kode tidak ditemukan.');
  const kode = body.kode.trim();
  let qrToken = null;
  let kodeManual = null;
  if (/^[a-fA-F0-9]{32}$/.test(kode)) {
    qrToken = kode.toLowerCase();
  } else if (
    kode.length === 6 &&
    Array.from(kode).every((karakter) => MANUAL_ALPHABET.includes(karakter))
  ) {
    kodeManual = kode;
  } else {
    fail(404, 'Kode tidak ditemukan.');
  }

  const client = await db.getClient();
  let absensi;
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      'SELECT * FROM pertemuan WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (locked.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');
    const pertemuan = locked.rows[0];
    canManagePertemuan(auth, pertemuan);

    const found = await client.query(
      `SELECT id FROM generus
       WHERE status = 'approved'
         AND (
           ($1::text IS NOT NULL AND qr_token = $1::text)
           OR ($2::text IS NOT NULL AND kode_manual = $2::text)
         )`,
      [qrToken, kodeManual]
    );
    if (found.rowCount !== 1) fail(404, 'Kode tidak ditemukan.');

    const generus = await generusInScope(pertemuan, found.rows[0].id, client);
    if (!generus) fail(404, 'Kode tidak ditemukan.');
    if (pertemuan.selesai_pada !== null) fail(409, 'Gunakan koreksi.');

    const result = await client.query(
      `INSERT INTO absensi (pertemuan_id, generus_id, status, dicatat_oleh)
       VALUES ($1, $2, 'hadir', $3)
       ON CONFLICT (pertemuan_id, generus_id)
       DO UPDATE SET status = EXCLUDED.status,
                     dicatat_oleh = EXCLUDED.dicatat_oleh,
                     updated_at = now()
       RETURNING id, pertemuan_id, generus_id, status, dicatat_oleh,
                 koreksi_count, created_at, updated_at`,
      [id, generus.id, auth.user.id]
    );
    absensi = result.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  sendJson(res, 200, { absensi });
}
```

`recordAbsenManual` mengikuti pola yang SAMA persis, hanya
bedanya: body `{ generus_id, status }`, status harus salah satu
dari 'hadir'/'izin'/'sakit' (bukan 'alfa' — bila tidak, fail 400),
dan INSERT memakai `status` dari body.

Konstanta yang sudah ada: `MANUAL_ALPHABET =
'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'`, `STATUS_ABSENSI = new Set(
['hadir', 'izin', 'sakit', 'alfa'])`, `MAX_BODY = 100 * 1024`.

## scan.html lengkap (saat ini)

Salin persis file berikut — ini file yang harus diubah di Tugas 5
(jangan tulis ulang dari nol; ubah hanya bagian yang diminta di
prompt sebelumnya):

```html
<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#F6F1E9">
  <title>Scan Kehadiran — GENSA</title>
  <link rel="manifest" href="/manifest.json">
  <style>
    :root {
      color-scheme: light;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #49392c;
      background: #F6F1E9;
    }

    * { box-sizing: border-box; }
    body { margin: 0; }
    main { max-width: 680px; margin: auto; padding: 24px 16px 40px; }
    h1 { margin: 0 0 8px; color: #8A5A33; font-size: 1.85rem; }
    h2 { margin: 0 0 12px; font-size: 1.1rem; }
    p { line-height: 1.6; }
    a { color: #8A5A33; text-underline-offset: 3px; }
    label { display: block; margin-bottom: 8px; font-weight: 600; }

    .kartu {
      margin-top: 20px;
      padding: 18px;
      background: #fffdf8;
      border: 1px solid #d8ccbd;
      border-radius: 14px;
    }

    select, input, button {
      width: 100%;
      min-height: 48px;
      padding: 11px 12px;
      border-radius: 8px;
      font: inherit;
    }

    select, input {
      color: #49392c;
      background: #fffdf8;
      border: 1px solid #a89987;
    }

    button {
      border: 1px solid #5F7A57;
      background: #5F7A57;
      color: #fff;
      font-weight: 600;
      cursor: pointer;
    }

    button:disabled { opacity: .55; cursor: not-allowed; }
    :focus-visible { outline: 3px solid #8A5A33; outline-offset: 3px; }

    .peringatan {
      padding: 12px;
      border: 1px solid #8A5A33;
      border-radius: 8px;
      background: #f4e8d8;
      color: #674021;
    }

    .kamera {
      position: relative;
      overflow: hidden;
      margin-bottom: 12px;
      border-radius: 10px;
      border: 1px solid #7C9A6E;
      background: #e7ecdf;
    }

    video { display: block; width: 100%; }
    .panduan {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      pointer-events: none;
    }

    .bingkai {
      width: 56%;
      max-width: 240px;
      aspect-ratio: 1;
      border: 3px dashed #F6F1E9;
      outline: 2px solid #5F7A57;
      border-radius: 10px;
    }

    .panduan span {
      max-width: 94%;
      padding: 6px 10px;
      border-radius: 6px;
      background: #F6F1E9;
      color: #49392c;
      text-align: center;
      font-size: .9rem;
    }

    #hasil { margin: 0; overflow-wrap: anywhere; }
    #hasil[data-jenis="sukses"] { color: #46603e; }
    #hasil[data-jenis="error"], #pesan-kamera { color: #874324; }
    #riwayat { padding-left: 22px; margin-bottom: 0; }
    #riwayat li { padding: 7px 0; line-height: 1.5; overflow-wrap: anywhere; }
    .manual { display: grid; gap: 10px; }
    .tautan { font-size: .9rem; }
    [hidden] { display: none !important; }

    @media (min-width: 520px) {
      main { padding-top: 36px; }
      .manual { grid-template-columns: minmax(0, 1fr) auto; }
      .manual button { width: auto; }
    }
  </style>
</head>
<body>
  <main>
    <p id="peringatan-aman" class="peringatan" role="alert" hidden>
      Kamera hanya bisa dipakai lewat HTTPS atau localhost. Buka halaman ini lewat alamat yang aman.
    </p>

    <header>
      <h1>Scan Kehadiran</h1>
      <p>Arahkan kamera HP ke QR generus untuk mencatat hadir.</p>
    </header>

    <section class="kartu" aria-labelledby="label-pertemuan">
      <label id="label-pertemuan" for="pertemuan">Pilih pertemuan</label>
      <select id="pertemuan" disabled aria-describedby="pesan-pertemuan">
        <option value="">Memuat pertemuan…</option>
      </select>
      <p id="pesan-pertemuan" role="status">Memuat jadwal pengajian…</p>
    </section>

    <section class="kartu" aria-labelledby="judul-kamera">
      <h2 id="judul-kamera">Scan kamera</h2>
      <div id="wadah-kamera" class="kamera" hidden>
        <video id="video" autoplay playsinline muted aria-label="Pratinjau kamera"></video>
        <div class="panduan" aria-hidden="true">
          <div class="bingkai"></div>
          <span>Arahkan kamera ke QR generus</span>
        </div>
      </div>
      <canvas id="canvas" hidden></canvas>
      <button id="tombol-scan" type="button" disabled>Mulai Scan</button>
      <p id="pesan-kamera" role="status" aria-live="polite" hidden></p>
    </section>

    <section class="kartu" aria-labelledby="judul-manual">
      <h2 id="judul-manual">Input manual</h2>
      <form id="form-manual">
        <label for="kode">Kode QR generus</label>
        <div class="manual">
          <input id="kode" name="kode" type="text" required
            autocomplete="off" autocapitalize="none" spellcheck="false"
            placeholder="Masukkan kode QR" disabled>
          <button id="tombol-manual" type="submit" disabled>Catat manual</button>
        </div>
      </form>
      <p class="tautan"><a href="/cetak-qr.html">Cetak QR generus</a></p>
    </section>

    <section class="kartu" aria-labelledby="judul-hasil">
      <h2 id="judul-hasil">Hasil scan</h2>
      <p id="hasil" role="status" aria-live="polite">Pilih pertemuan untuk mulai mencatat hadir.</p>
    </section>

    <section class="kartu" aria-labelledby="judul-riwayat">
      <h2 id="judul-riwayat">Riwayat scan</h2>
      <p id="riwayat-kosong">Belum ada kehadiran yang dicatat.</p>
      <ul id="riwayat"></ul>
    </section>

    <noscript><p class="peringatan">Aktifkan JavaScript untuk menggunakan halaman ini.</p></noscript>
  </main>

  <script src="/jsQR.js"></script>
  <script>
    'use strict';

    const pertemuan = document.getElementById('pertemuan');
    const pesanPertemuan = document.getElementById('pesan-pertemuan');
    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const wadahKamera = document.getElementById('wadah-kamera');
    const tombolScan = document.getElementById('tombol-scan');
    const pesanKamera = document.getElementById('pesan-kamera');
    const formManual = document.getElementById('form-manual');
    const inputKode = document.getElementById('kode');
    const tombolManual = document.getElementById('tombol-manual');
    const hasil = document.getElementById('hasil');
    const riwayat = document.getElementById('riwayat');
    const riwayatKosong = document.getElementById('riwayat-kosong');

    const labelJenjang = {
      caberawit: 'Caberawit',
      pra_remaja: 'Pra Remaja',
      remaja: 'Remaja',
      usia_nikah: 'Usia Nikah'
    };
    const labelTingkat = {
      kelompok: 'Kelompok',
      desa: 'Desa',
      daerah: 'Daerah'
    };
    const formatJam = new Intl.DateTimeFormat('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    let siap = false;
    let sedangMengirim = false;
    let mulaiKamera = false;
    let aliran = null;
    let timerScan = null;
    let versiKamera = 0;
    let versiPertemuan = 0;
    let konteks = null;

    const terakhirDiproses = new Map();
    const sudahTercatat = new Map();

    const jsQRTersedia = typeof window.jsQR === 'function';
    const kameraTersedia = Boolean(
      window.isSecureContext &&
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia
    );

    document.querySelector('h1').textContent = 'Scan Kehadiran';
    document.getElementById('peringatan-aman').hidden = window.isSecureContext;

    function tampilkanHasil(pesan, jenis = '') {
      hasil.textContent = pesan;
      hasil.dataset.jenis = jenis;
    }

    function tampilkanPesanKamera(pesan) {
      pesanKamera.textContent = pesan;
      pesanKamera.hidden = !pesan;
    }

    function perbaruiTombol() {
      const bisaMencatat = siap && Boolean(pertemuan.value);
      tombolScan.disabled = !bisaMencatat || !jsQRTersedia || !kameraTersedia;
      tombolScan.textContent = aliran || mulaiKamera ? 'Berhenti' : 'Mulai Scan';
      tombolManual.disabled = !bisaMencatat || sedangMengirim;
      inputKode.disabled = !bisaMencatat || sedangMengirim;
    }

    async function api(url, options = {}) {
      const response = await fetch(url, {
        ...options,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {})
        }
      });

      if (response.status === 401) {
        siap = false;
        hentikanKamera();
        window.location.assign('/login.html');
        const error = new Error('Sesi Anda berakhir. Silakan masuk kembali.');
        error.status = 401;
        throw error;
      }

      let data = null;
      try {
        data = await response.json();
      } catch {
        // Status HTTP tetap digunakan bila respons bukan JSON.
      }

      if (!response.ok) {
        const pesan = typeof data?.error === 'string' ? data.error :
          typeof data?.message === 'string' ? data.message :
          'Permintaan gagal. Silakan coba lagi.';
        const error = new Error(pesan);
        error.status = response.status;
        throw error;
      }

      return data;
    }

    function tanggalIndonesia(nilai) {
      const tanggal = String(nilai).slice(0, 10).split('-');
      return tanggal.length === 3
        ? tanggal[2] + '/' + tanggal[1] + '/' + tanggal[0]
        : String(nilai);
    }

    function tambahRiwayat(jam, nama, status) {
      const item = document.createElement('li');
      item.textContent = jam + ' — ' + nama + ' — ' + status;
      riwayat.prepend(item);
      while (riwayat.children.length > 5) {
        riwayat.lastElementChild.remove();
      }
      riwayatKosong.hidden = true;
    }

    function hentikanKamera() {
      versiKamera += 1;
      mulaiKamera = false;
      window.clearTimeout(timerScan);
      timerScan = null;
      if (aliran) {
        aliran.getTracks().forEach(track => track.stop());
      }
      aliran = null;
      video.pause();
      video.srcObject = null;
      wadahKamera.hidden = true;
      perbaruiTombol();
    }

    async function catatAbsen(kode, manual = false) {
      if (!siap || !pertemuan.value || sedangMengirim) return;

      if (kode.length === 0) {
        tampilkanHasil('Masukkan kode QR terlebih dahulu.', 'error');
        return;
      }

      const sekarang = performance.now();
      const terakhir = terakhirDiproses.get(kode);
      if (terakhir !== undefined && sekarang - terakhir < 3000) {
        if (manual) {
          const nama = sudahTercatat.get(kode);
          tampilkanHasil(
            nama ? nama + ' sudah tercatat.' : 'Tunggu sebentar sebelum mencoba kode yang sama.',
            nama ? 'sukses' : ''
          );
          if (nama) inputKode.value = '';
        }
        return;
      }
      terakhirDiproses.set(kode, sekarang);

      if (sudahTercatat.has(kode)) {
        tampilkanHasil(sudahTercatat.get(kode) + ' sudah tercatat.', 'sukses');
        if (manual) inputKode.value = '';
        return;
      }

      const sesi = versiPertemuan;
      const id = pertemuan.value;
      const waktuScan = new Date();
      const url = '/api/pertemuan/' + encodeURIComponent(id);
      sedangMengirim = true;
      perbaruiTombol();
      tampilkanHasil('Mencatat kehadiran…');

      try {
        const data = await api(url + '/absen', {
          method: 'POST',
          body: JSON.stringify({ kode })
        });
        if (sesi !== versiPertemuan) return;
        if (!data?.absensi || data.absensi.generus_id == null) {
          throw new Error('Respons kehadiran tidak lengkap. Silakan coba lagi.');
        }

        const generusId = data.absensi.generus_id;
        let nama = 'Generus #' + String(generusId);
        let namaBelumTersedia = false;
        sudahTercatat.set(kode, nama);

        try {
          const daftar = await api(url + '/absensi');
          if (sesi !== versiPertemuan) return;
          const baris = Array.isArray(daftar?.absensi)
            ? daftar.absensi.find(item => String(item.generus_id) === String(generusId))
            : null;
          if (typeof baris?.nama === 'string' && baris.nama.length > 0) {
            nama = baris.nama;
          } else {
            namaBelumTersedia = true;
          }
        } catch (error) {
          if (error.status === 401) return;
          namaBelumTersedia = true;
        }

        if (sesi !== versiPertemuan) return;
        sudahTercatat.set(kode, nama);
        const jam = formatJam.format(waktuScan);
        tampilkanHasil(
          '✓ Hadir tercatat — ' + nama + ' · ' + jam +
          (namaBelumTersedia ? '. Nama belum berhasil dimuat.' : ''),
          'sukses'
        );
        tambahRiwayat(jam, nama, 'Hadir');
        if (manual) inputKode.value = '';
      } catch (error) {
        if (sesi !== versiPertemuan || error.status === 401) return;
        let pesan;
        if (error.status === 404) {
          pesan = 'Kode tidak dikenal. Pastikan QR-nya QR GENSA.';
        } else if (error.status === 403) {
          pesan = 'Anda tidak punya akses ke pertemuan ini.';
        } else {
          pesan = error.message || 'Kehadiran belum berhasil dicatat. Silakan coba lagi.';
        }
        tampilkanHasil(pesan, 'error');
      } finally {
        sedangMengirim = false;
        perbaruiTombol();
      }
    }

    function pindaiFrame(versi) {
      if (versi !== versiKamera || !aliran) return;

      try {
        if (!sedangMengirim && video.readyState >= 2 &&
            video.videoWidth > 0 && video.videoHeight > 0) {
          const skala = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
          const lebar = Math.max(1, Math.round(video.videoWidth * skala));
          const tinggi = Math.max(1, Math.round(video.videoHeight * skala));
          if (canvas.width !== lebar) canvas.width = lebar;
          if (canvas.height !== tinggi) canvas.height = tinggi;
          konteks.drawImage(video, 0, 0, lebar, tinggi);
          const frame = konteks.getImageData(0, 0, lebar, tinggi);
          const kode = window.jsQR(frame.data, lebar, tinggi);
          if (kode && typeof kode.data === 'string') {
            void catatAbsen(kode.data);
          }
        }
      } catch {
        hentikanKamera();
        tampilkanPesanKamera('Pemindaian QR gagal. Coba mulai lagi atau gunakan input manual.');
        return;
      }

      timerScan = window.setTimeout(() => pindaiFrame(versi), 200);
    }

    async function nyalakanKamera() {
      if (tombolScan.disabled) return;
      if (aliran || mulaiKamera) {
        hentikanKamera();
        return;
      }

      const versi = ++versiKamera;
      mulaiKamera = true;
      tampilkanPesanKamera('');
      perbaruiTombol();

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false
        });
        if (versi !== versiKamera) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        aliran = stream;
        video.srcObject = stream;
        wadahKamera.hidden = false;
        await video.play();
        if (versi !== versiKamera) return;

        konteks = canvas.getContext('2d', { willReadFrequently: true });
        if (!konteks) throw new Error('Pemrosesan gambar tidak tersedia');

        mulaiKamera = false;
        perbaruiTombol();
        pindaiFrame(versi);
      } catch (error) {
        if (versi !== versiKamera) return;
        hentikanKamera();

        if (error.name === 'NotAllowedError') {
          tampilkanPesanKamera('Izin kamera ditolak. Izinkan akses kamera di pengaturan browser, lalu coba lagi.');
        } else if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
          tampilkanPesanKamera('Kamera tidak ditemukan di perangkat ini.');
        } else {
          const pesan = String(error.message || 'Terjadi gangguan pada kamera').replace(/[.\s]+$/, '');
          tampilkanPesanKamera('Kamera tidak bisa dipakai: ' + pesan + '.');
        }
      }
    }

    pertemuan.addEventListener('change', () => {
      versiPertemuan += 1;
      hentikanKamera();
      terakhirDiproses.clear();
      sudahTercatat.clear();
      riwayat.replaceChildren();
      riwayatKosong.hidden = false;
      inputKode.value = '';
      tampilkanHasil('Pertemuan dipilih. Mulai scan atau masukkan kode secara manual.');
      perbaruiTombol();
    });

    tombolScan.addEventListener('click', nyalakanKamera);
    formManual.addEventListener('submit', event => {
      event.preventDefault();
      void catatAbsen(inputKode.value, true);
    });

    window.addEventListener('pagehide', () => {
      versiPertemuan += 1;
      hentikanKamera();
    });

    async function muatHalaman() {
      const kendala = [];
      if (!jsQRTersedia) {
        kendala.push('Pustaka pemindai QR gagal dimuat. Muat ulang halaman atau gunakan input manual.');
      }
      if (window.isSecureContext && !kameraTersedia) {
        kendala.push('Browser ini tidak mendukung akses kamera. Gunakan input manual.');
      }
      tampilkanPesanKamera(kendala.join(' '));

      try {
        await api('/api/me');
        const data = await api('/api/pertemuan');
        if (!Array.isArray(data?.pertemuan)) {
          throw new Error('Daftar pertemuan belum berhasil dimuat. Muat ulang halaman untuk mencoba lagi.');
        }

        const daftar = data.pertemuan
          .filter(item => item.selesai_pada === null)
          .sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)));

        pertemuan.replaceChildren();
        if (daftar.length === 0) {
          const opsi = document.createElement('option');
          opsi.value = '';
          opsi.textContent = 'Tidak ada pertemuan terbuka';
          pertemuan.append(opsi);
          pesanPertemuan.textContent = 'Belum ada jadwal pengajian yang dibuka.';
          tampilkanHasil('Belum ada jadwal pengajian yang dibuka.');
        } else {
          for (const item of daftar) {
            const opsi = document.createElement('option');
            opsi.value = String(item.id);
            const jenjang = item.jenjang_target
              .map(nilai => labelJenjang[nilai] || nilai)
              .join(', ');
            opsi.textContent = tanggalIndonesia(item.tanggal) + ' — ' +
              (labelTingkat[item.tingkat] || item.tingkat) +
              (jenjang ? ' — ' + jenjang : '');
            pertemuan.append(opsi);
          }
          pertemuan.disabled = false;
          pesanPertemuan.textContent = 'Pastikan pertemuan yang dipilih sesuai sebelum mencatat hadir.';
          tampilkanHasil('Pertemuan dipilih. Mulai scan atau masukkan kode secara manual.');
        }
        siap = true;
      } catch (error) {
        if (error.status === 401) return;
        pertemuan.replaceChildren();
        const opsi = document.createElement('option');
        opsi.value = '';
        opsi.textContent = 'Jadwal belum tersedia';
        pertemuan.append(opsi);
        pesanPertemuan.textContent = 'Jadwal gagal dimuat. Muat ulang halaman untuk mencoba lagi.';
        tampilkanHasil(error.message || 'Halaman belum berhasil dimuat.', 'error');
      }
      perbaruiTombol();
    }

    void muatHalaman();
  </script>
<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
</script>
</body>
</html>
```

## Format keluaran

Jawab HANYA dengan blok kode, satu blok per file/penyisipan,
dengan judul file dan penanda sisip yang persis (lihat "Format
keluaran" di bagian tugas di atas). Jangan sertakan penjelasan
panjang di luar blok kode. Jangan menjalankan tes atau mengakses
file — Muse yang menulis file dan menjalankan tes.
