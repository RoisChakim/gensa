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

  try {
    const data = await api('/api/pertemuan/' + encodeURIComponent(id) + '/sync', {
      method: 'POST',
      body: JSON.stringify({ items: daftar })
    });
    const hasil = Array.isArray(data?.hasil) ? data.hasil : [];
    const diterima = new Set();
    let ditolak = 0;
    hasil.forEach((item, index) => {
      if (item?.diterima) diterima.set(daftar[index]?.client_id);
      else ditolak += 1;
    });
    const sisa = daftar.filter((item) => !diterima.has(item.client_id));
    simpanAntrean(id, sisa);
    antrean = sisa;
    perbaruiAntrean();
    pesanAntrean.textContent = sisa.length === 0
      ? (ditolak === 0
        ? 'Semua kehadiran offline sudah terkirim.'
        : 'Kehadiran terkirim, ' + ditolak + ' ditolak server.')
      : sisa.length + ' kehadiran belum terkirim — coba lagi saat online.';
  } catch (error) {
    if (error.status === 401) return;
    pesanAntrean.textContent = 'Gagal mengirim antrean. Coba lagi saat online.';
  } finally {
    sedangMengirim = false;
    perbaruiTombol();
    perbaruiAntrean();
  }
}
```

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
