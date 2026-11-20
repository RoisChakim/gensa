# Codex — GENSA MVP Sesi 3: Jadwal (SESI BARU, model Astra High)

Kamu adalah Codex. Kerjakan SATU tugas ini sampai selesai: lengkapi
fitur Jadwal untuk aplikasi GENSA. Kamu TIDAK bisa membaca/menulis
file — OUTPUT isi file dalam blok kode berlabel nama file. Saya yang
menulis file-nya dan menjalankan tesnya. Jangan tanya apa pun; semua
keputusan sudah ditetapkan di bawah.

## Yang sudah selesai (jangan dibuat ulang)

- Sesi 1: backend fondasi (akun, peran, generus + persetujuan,
  login, ganti password, reset password). Smoke test 11/11 lulus.
- Sesi 2: QR + absensi (tabel pertemuan + absensi, endpoint absen,
  selesai, koreksi, qr.svg, halaman cetak-qr.html). Smoke test
  S2 15/15 lulus, S1 11/11 lulus.
- Tabel `pertemuan` SUDAH ada (tingkat kelompok/desa/daerah,
  kelompok_id, desa_id, jenjang_target jenjang_generus[], tanggal,
  dibuat_oleh, selesai_pada). TIDAK perlu migrasi baru.
- Endpoint SUDAH ada: POST /api/pertemuan, GET /api/pertemuan,
  GET /api/pertemuan/:id. TIDAK perlu diubah.

## Stack dan aturan (wajib)

- Node.js 24 stdlib `http` + `pg` + `bcryptjs` + `qrcode`. Tanpa
  Express, tanpa ORM.
- Semua query pakai parameter. Cek peran + kepemilikan scope di
  server untuk SETIAP aksi. Jangan kembalikan password_hash.
  Error jangan bocorkan detail database.
- Validasi server yang ketat. Tanpa innerHTML dengan data pengguna
  (pakai textContent / createElement seperti cetak-qr.html).
  Tanpa rahasia di kode/repo.
- `updated_at` tidak ada trigger — SET manual di tiap UPDATE.
- Palet halaman: krem `#F6F1E9`, coklat `#8A5A33`, sage
  `#5F7A57/#7C9A6E`. Tanpa latar gelap, tanpa neon. Mobile-first,
  tombol min-height 44px.
- JANGAN bangun: link izin, absen offline, login Google, laporan
  Word, materi/penilaian. Jadwal dibuat manual 1 per 1 — TIDAK
  ada pengulangan otomatis.

## Keputusan yang sudah ditetapkan (PRD)

- Jadwal = pertemuan. Yang bisa ubah/hapus jadwal: yang bikin
  (pengurus tingkat penyelenggara) + Admin. Selain itu 403.
- Ubah jadwal (PATCH): boleh ubah `tanggal` dan/atau `jenjang`
  (centang jenjang: caberawit, pra_remaja, remaja, usia_nikah).
  TIDAK boleh ubah tingkat/wilayah. Pertemuan yang sudah selesai
  (selesai_pada terisi) TIDAK boleh diubah → 409.
- Hapus jadwal (DELETE): TIDAK boleh bila pertemuan sudah selesai
  → 409. TIDAK boleh bila sudah ada baris absensi → 409 (jangan
  hapus data kehadiran). Selain itu hapus dan response 200.
- Halaman jadwal: daftar pertemuan yang akan datang (tanggal >=
  hari ini DAN belum selesai), urut tanggal naik. Ada form buat
  jadwal baru dan tombol Ubah/Hapus per baris (hanya tampil bila
  pengguna boleh mengelola — server tetap yang menegakkan).

## Kode yang sudah ada (kutipan persis — pakai pola yang sama)

Helper dan handler pertemuan yang sudah ada di `server/index.js`:

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

function validPertemuanDate(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith('0000-')
  ) {
    fail(400, 'Tanggal pertemuan tidak valid.');
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    fail(400, 'Tanggal pertemuan tidak valid.');
  }

  return value;
}

async function createPertemuan(req, res, auth) {
  const body = await readJson(req);
  const tingkat = body.tingkat;

  if (!TINGKAT_PERTEMUAN.has(tingkat)) {
    fail(400, 'Tingkat pertemuan tidak valid.');
  }

  const kelompokId = optionalId(body.kelompok_id, 'Kelompok');
  const desaId = optionalId(body.desa_id, 'Desa');

  if (
    !Array.isArray(body.jenjang) ||
    body.jenjang.length === 0 ||
    !body.jenjang.every((jenjang) => JENJANG.has(jenjang))
  ) {
    fail(400, 'Jenjang pertemuan tidak valid.');
  }

  const jenjang = [...new Set(body.jenjang)];
  const tanggal = validPertemuanDate(body.tanggal);

  const validScope =
    (tingkat === 'kelompok' && kelompokId !== null && desaId === null) ||
    (tingkat === 'desa' && desaId !== null && kelompokId === null) ||
    (tingkat === 'daerah' && kelompokId === null && desaId === null);

  if (!validScope) fail(400, 'Wilayah tidak sesuai dengan tingkat pertemuan.');

  canManagePertemuan(auth, {
    tingkat,
    kelompok_id: kelompokId,
    desa_id: desaId,
  });

  let result;
  try {
    result = await db.query(
      `INSERT INTO pertemuan
         (tingkat, kelompok_id, desa_id, jenjang_target, tanggal, dibuat_oleh)
       VALUES ($1, $2, $3, $4::jenjang_generus[], $5::date, $6)
       RETURNING *`,
      [tingkat, kelompokId, desaId, jenjang, tanggal, auth.user.id]
    );
  } catch (error) {
    if (error.code === '23503') fail(400, 'Wilayah atau pengguna tidak ditemukan.');
    throw error;
  }

  sendJson(res, 201, { pertemuan: result.rows[0] });
}

async function listPertemuan(res, auth, url) {
  const tingkat = url.searchParams.get('tingkat');
  const tanggalValue = url.searchParams.get('tanggal');

  if (tingkat !== null && !TINGKAT_PERTEMUAN.has(tingkat)) {
    fail(400, 'Tingkat pertemuan tidak valid.');
  }

  const tanggal = tanggalValue === null ? null : validPertemuanDate(tanggalValue);
  const scope = pertemuanScopeWhere(auth);

  const result = await db.query(
    `SELECT p.*
     FROM pertemuan p
     WHERE ${scope.sql}
       AND ($4::text IS NULL OR p.tingkat = $4::text)
       AND ($5::date IS NULL OR p.tanggal = $5::date)
     ORDER BY p.tanggal DESC, p.id DESC`,
    [...scope.values, tingkat, tanggal]
  );

  sendJson(res, 200, { pertemuan: result.rows });
}

async function getPertemuan(res, auth, id) {
  const scope = pertemuanScopeWhere(auth);
  const result = await db.query(
    `SELECT p.*
     FROM pertemuan p
     WHERE ${scope.sql} AND p.id = $4`,
    [...scope.values, id]
  );

  if (result.rowCount !== 1) fail(404, 'Pertemuan tidak ditemukan.');

  const ringkasan = await db.query(
    `SELECT
       (count(*) FILTER (WHERE status = 'hadir'))::integer AS hadir,
       (count(*) FILTER (WHERE status = 'izin'))::integer AS izin,
       (count(*) FILTER (WHERE status = 'sakit'))::integer AS sakit,
       (count(*) FILTER (WHERE status = 'alfa'))::integer AS alfa
     FROM absensi
     WHERE pertemuan_id = $1`,
    [id]
  );

  sendJson(res, 200, {
    pertemuan: result.rows[0],
    ringkasan: ringkasan.rows[0],
  });
}
```

Routing pertemuan yang sudah ada di `handle()` (sisipkan cabang baru
tepat setelah blok ini):

```js
  const pertemuanMatch = pathname.match(/^\/api\/pertemuan\/([1-9]\d*)$/);
  if (req.method === 'GET' && pertemuanMatch) {
    await getPertemuan(res, auth, positiveId(pertemuanMatch[1]));
    return;
  }
```

Helper lain yang tersedia: `fail(status, pesan)`, `sendJson(res, status,
data)`, `readJson(req)`, `positiveId(value)`, `optionalId(value, label)`,
`db.query(...)`, `auth.user` berisi `{id, email, role, desa_id,
kelompok_id, must_change_password}`. Konstanta: `JENJANG` (Set
caberawit/pra_remaja/remaja/usia_nikah), `TINGKAT_PERTEMUAN` (Set
kelompok/desa/daerah).

## Tugas 1: ubah + hapus pertemuan di `server/index.js`

Output DUA blok kode (jangan kirim ulang seluruh file):

### Blok A — fungsi baru (sisipkan tepat setelah akhir fungsi `getPertemuan`, sebelum `async function listAbsensi`)

1. `updatePertemuan(req, res, auth, id)` — PATCH.
   - Ambil pertemuan: `SELECT * FROM pertemuan WHERE id = $1`;
     bila tidak ada → 404 'Pertemuan tidak ditemukan.'
   - `canManagePertemuan(auth, pertemuan)` (403 bila bukan yang
     berhak).
   - Bila `pertemuan.selesai_pada !== null` → 409 'Pertemuan sudah
     selesai.'
   - Body boleh berisi `tanggal` dan/atau `jenjang`; minimal satu
     harus ada, kalau tidak ada → 400 'Tidak ada yang diubah.'
   - `tanggal` bila ada: validasi dengan `validPertemuanDate`.
   - `jenjang` bila ada: harus array tidak kosong, tiap elemen ada
     di `JENJANG`; dedupe dengan `[...new Set(...)]`; bila tidak
     valid → 400 'Jenjang pertemuan tidak valid.'
   - UPDATE hanya kolom yang diberikan + `updated_at = now()`,
     `RETURNING *`. Response 200 + `{pertemuan}`.
2. `deletePertemuan(res, auth, id)` — DELETE.
   - Ambil pertemuan; bila tidak ada → 404.
   - `canManagePertemuan(auth, pertemuan)` (403 bila bukan yang
     berhak).
   - Bila `pertemuan.selesai_pada !== null` → 409 'Pertemuan sudah
     selesai.'
   - Cek `SELECT 1 FROM absensi WHERE pertemuan_id = $1 LIMIT 1`;
     bila ada baris → 409 'Pertemuan sudah memiliki absensi.'
   - DELETE pertemuan. Response 200 + `{ok: true}`.

### Blok B — routing baru (sisipkan tepat setelah blok routing GET
`/api/pertemuan/:id` di atas)

```js
  if (req.method === 'PATCH' && pertemuanMatch) {
    await updatePertemuan(req, res, auth, positiveId(pertemuanMatch[1]));
    return;
  }

  if (req.method === 'DELETE' && pertemuanMatch) {
    await deletePertemuan(res, auth, positiveId(pertemuanMatch[1]));
    return;
  }
```

## Tugas 2: halaman `server/public/jadwal.html` (file lengkap)

Halaman daftar jadwal + form buat jadwal baru. Ikuti konvensi
`server/public/cetak-qr.html` (palet, system-ui, tombol min-height
44px, `textContent`/`createElement` saja, `fetch` dengan
`cache: 'no-store'`, redirect ke `/login.html` bila 401):

- Judul "Jadwal Pengajian". Pesan status `#pesan` (role=status).
- Form buat jadwal: select tingkat (pilihan dibatasi peran:
  kelompok→hanya 'kelompok'; desa→hanya 'desa'; daerah→hanya
  'daerah'; admin→ketiga tingkat + dua input angka ID Kelompok /
  ID Desa yang hanya tampil untuk admin), 4 checkbox jenjang
  (caberawit, pra remaja, remaja, usia nikah — minimal satu
  dicentang), input tanggal (type=date), tombol "Buat jadwal".
  Kirim POST /api/pertemuan dengan {tingkat, kelompok_id, desa_id,
  jenjang, tanggal} — kelompok_id/desa_id diambil dari `/api/me`
  (kelompok→kelompok_id miliknya; desa→desa_id miliknya;
  daerah→keduanya null; admin→dari input angka, kosong = null).
  Setelah berhasil, muat ulang daftar.
- Daftar: GET /api/pertemuan, filter di klien: tampilkan yang
  `tanggal >= hari ini` DAN `selesai_pada === null`, urut tanggal
  naik lalu id naik. Checkbox "Tampilkan semua" untuk melihat semua
  pertemuan termasuk yang sudah lewat/selesai (urut tanggal turun).
- Tiap baris: tanggal, tingkat, jenjang (tulis nama yang mudah
  dibaca: caberawit, pra remaja, remaja, usia nikah), status
  ("Akan datang" / "Selesai"), tombol "Ubah" dan "Hapus" — hanya
  tampil bila pengguna boleh mengelola (admin selalu; bila tidak,
  peran sama dengan tingkat DAN scope cocok: kelompok→kelompok_id
  sama; desa→desa_id sama; daerah→tingkat 'daerah'). Server tetap
  yang menegakkan; ini hanya tampilan.
- Ubah: form inline di baris itu (input tanggal terisi tanggal lama
  + 4 checkbox jenjang tercentang sesuai data) + tombol "Simpan" /
  "Batal". Simpan → PATCH /api/pertemuan/:id.
- Hapus: `confirm('Hapus jadwal ini?')` lalu DELETE
  /api/pertemuan/:id. Pesan error dari server (field `error` di
  JSON) ditampilkan di `#pesan`.
- Bila daftar kosong: "Belum ada jadwal."

## Tugas 3: `server/smoke-test-s3.js` (file lengkap)

Ikuti pola `server/smoke-test-s2.js` (helper yang sama: `loadEnv`,
`request`, `check`, `createAndLogin`, `findKelompok` — tapi cari
**Kelompok Contoh C** di Desa Contoh 3, supaya terisolasi dari data
tes Sesi 1 di Kelompok A dan Sesi 2 di Kelompok B). Data generus
memakai pola yang sama seperti S2 (`dataGenerus` + suffix acak).
Pemeriksaan (semua harus lulus):

1. Admin masuk dan membuat akun kelompok C.
2. Kelompok C membuat pertemuan (POST /api/pertemuan tingkat
   kelompok, jenjang ['caberawit'], tanggal hari ini → 201).
3. Kelompok C mengubah tanggal + jenjang pertemuan itu (PATCH →
   200; tanggal dan jenjang berubah sesuai yang dikirim).
4. PATCH dengan jenjang kosong → 400.
5. Akun desa lain (buat akun desa untuk Desa Contoh 1) tidak bisa
   mengubah pertemuan kelompok C → 403.
6. Admin bisa mengubah pertemuan kelompok C → 200 (kembalikan
   tanggal ke hari ini setelahnya).
7. Hapus pertemuan tanpa absensi → DELETE 200, lalu GET pertemuan
   itu → 404.
8. Buat pertemuan baru di kelompok C; buat + setujui 1 generus di
   kelompok C; catat absen manual hadir; hapus pertemuan itu →
   409 (sudah memiliki absensi).
9. Buat pertemuan baru; tutup (POST .../selesai → 200); PATCH →
   409; DELETE → 409.
10. GET /api/pertemuan?tingkat=kelompok memuat pertemuan yang
    dibuat; daftar mengikuti wilayah.
11. GET /jadwal.html → 200, Content-Type text/html.

Catatan: pertemuan yang dibuat di tes ini boleh bertanggal hari ini
atau besok. Setelah selesai, kembalikan flag
must_change_password admin ke true (seperti pola S2: ubah password
admin menjadi password yang sama lewat /api/change-password — cara
yang sama seperti smoke-test-s2.js).

## Format jawaban

Tiga blok kode berlabel: `server/index.js` (Blok A + Blok B saja,
dengan penanda sisipan yang jelas), `server/public/jadwal.html`
(lengkap), `server/smoke-test-s3.js` (lengkap). Jangan tambah file
lain. Akhiri dengan ringkasan 8 baris: keputusan desain + cara
menjalankan tes. Bahasa jawaban: Indonesia.
