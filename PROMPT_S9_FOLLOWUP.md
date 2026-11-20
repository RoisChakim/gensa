# Sesi 9 (lanjutan) — Absen Offline, dengan konteks lengkap

Ini lanjutan dari `PROMPT_S9_OFFLINE.md` (tugasnya SAMA: migrasi 005,
endpoint `GET /api/pertemuan/:id/daftar`, endpoint
`POST /api/pertemuan/:id/sync`, routing, dan offline di
`server/public/scan.html`). Kerjakan SEMUA tugas dari prompt itu.

## Dua koreksi atas contoh di prompt sebelumnya (terapkan!)

1. `Set` memakai `.add()`, bukan `.set()`. Di `kirimAntrean`, yang
   benar: `diterima.add(daftar[index]?.client_id);`
2. Antrean dikirim BERTAHAP maksimal 200 item per permintaan
   (endpoint menolak lebih dari 200). Di `kirimAntrean`, potong
   `daftar` jadi potongan-potongan 200 item, kirim satu per satu
   secara berurutan; tiap potongan yang berhasil menghapus item
   yang diterimanya dari antrean; bila satu potongan gagal
   jaringan, berhenti dan biarkan sisanya untuk percobaan
   berikutnya.

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

## Tugas yang dikerjakan (dari PROMPT_S9_OFFLINE.md)

Kerjakan Tugas 1–5 dari prompt itu, dengan DUA koreksi di atas
(`diterima.add(...)`, kirim antrean bertahap maks 200 item).
Jangan buat smoke test. Jangan sentuh login Google atau link izin.
Jangan ubah `sw.js`. Jangan tambah dependensi baru.

## Format keluaran

Sama seperti prompt sebelumnya: HANYA blok kode, satu blok per
file/penyisipan, dengan judul file dan penanda sisip yang persis.
Jangan sertakan penjelasan panjang di luar blok kode. Jangan
menjalankan tes atau mengakses file — Muse yang menulis file
dan menjalankan tes.
