# STATE.md — GENSA (progres terakhir)

> File ini DIBACA Codex di awal setiap sesi dan DITULIS ULANG di akhir
> sesi. Tujuannya: lanjut kerja tanpa baca ulang semua file (hemat token)
> dan progres tidak hilang walau kena limit.

## Status sekarang (2026-11-21 ~03:40 WIB)

- Demo v1 selesai (2026-11-15). File utama:
  `sistem-generus-standalone.html` (= `GENSA_Demo_v1.html`).
- Repo GitHub publik: `RoisChakim/gensa` (commit `c8cb40a0`).
- Codex sudah login di VM Muse (2026-11-20) dan siap dipakai.
- Skill wajib: `docs/skills/web-security.md`, `docs/skills/ponytail.md`,
  `docs/skills/uiux.md` — dibaca dulu sebelum kerja (lihat `AGENTS.md`).
- **MVP SESI 1 SELESAI (2026-11-21 ~00:45 WIB): backend fondasi
  JALAN + smoke test 11/11 LULUS.** Server Node.js + PostgreSQL di
  `server/` (lihat "Yang sudah selesai"). Server TIDAK dibiarkan
  jalan — nyalakan manual: `node server/index.js` dari root repo
  (butuh `.env`, sudah ada, mode 600).
- **MVP SESI 2 SELESAI (2026-11-21 ~03:40 WIB): QR + absensi
  JALAN + smoke test S2 15/15 LULUS + smoke test S1 11/11 LULUS
  (tidak ada regresi).** Server TIDAK dibiarkan jalan.
- **MVP SESI 3 SELESAI (2026-11-21 ~05:00 WIB): Jadwal JALAN +
  smoke test S3 11/11 LULUS + smoke test S1 11/11 LULUS (tidak ada
  regresi).** Model gpt-6-astra (GPT 6 Astra High), reasoning high,
  sesi BARU, 1 panggilan. Yang dibangun:
  - `server/index.js` — +2 handler: PATCH /api/pertemuan/:id
    (ubah tanggal dan/atau jenjang; 409 bila sudah selesai) dan
    DELETE /api/pertemuan/:id (409 bila sudah selesai atau sudah
    ada absensi); keduanya pakai transaksi + FOR UPDATE dan
    canManagePertemuan (pembuat tingkat + Admin). Routing PATCH/
    DELETE disisipkan setelah GET /api/pertemuan/:id.
  - `server/public/jadwal.html` — daftar jadwal akan datang
    (tanggal >= hari ini, belum selesai) + form buat jadwal
    (tingkat sesuai peran, checkbox jenjang, tanggal) + editor
    inline Ubah + tombol Hapus (confirm). Palet GENSA, textContent
    saja, mobile-first.
  - `server/smoke-test-s3.js` — 11 pemeriksaan, SEMUA LULUS
    (pakai Kelompok Contoh C / Desa Contoh 3, terisolasi dari
    data tes S1/S2). Flag must_change_password admin dikembalikan
    ke true setelah tes (di dalam skrip + verifikasi manual).
  - PERBAIKAN BUG (oleh Muse, bukan Codex): pg mengembalikan
    kolom `jenjang_generus[]` sebagai string `'{caberawit}'`
    (OID array enum kustom tidak dikenal parser pg) — API
    mengembalikan string, bukan array, sehingga
    `jadwal.html` (`.map`) akan rusak. Ditambah helper
    `normalisasiPertemuan()` di `server/index.js` dan dipakai di
    create/list/get/update/selesai pertemuan. Bug ini ada sejak
    Sesi 2 tapi tidak ketahuan karena tes S2 tidak memeriksa
    jenjang_target.
  - CATATAN: smoke test S3 dari Codex TIDAK dipakai — isinya
    berasumsi API yang tidak ada (/api/akun, /api/desa,
    /api/kelompok, /setujui, change-password pakai
    current_password, port 3000, fixture generus salah, absen
    pakai {generus_id, status}). Muse menulis ulang
    smoke-test-s3.js mengikuti pola smoke-test-s2.js (kontrak API
    yang benar). Pelajaran: prompt Codex HARUS menyertakan
    kontrak endpoint + helper yang dipakai tes; jangan biarkan
    Codex mengarang API.
  - Data tes di database bertambah: pertemuan + generus di
    Kelompok Contoh C (semua @tes.gensa.local) — hapus manual
    bila mengganggu.
- **MVP SESI 4 SELESAI (2026-11-21 ~05:50 WIB): Laporan Word JALAN
  + smoke test S4 8/8 LULUS + smoke test S1 11/11 + S3 11/11 LULUS
  (tidak ada regresi).** Model gpt-6-astra (GPT 6 Astra High),
  reasoning high, sesi BARU, 1 panggilan. Yang dibangun:
  - `server/index.js` — `generusScopeWhere(auth)`,
    `hitungLaporan(auth, dari, sampai, rincian)` (rekap per
    kelompok + rincian per generus; % = hadir/wajib; izin+sakit
    digabung "izin"; hanya pertemuan selesai; generus baru tidak
    dihitung wajib sebelum `decided_at`; rentang maks 62 hari),
    `buatLaporanWord(laporan)` (paket `docx` v9 — sudah
    terpasang sebelum sesi), `GET /api/laporan` (JSON) dan
    `GET /api/laporan.docx` (unduh .docx).
  - `server/public/laporan.html` — form dari/sampai + preset
    Minggu ini/Bulan ini + checkbox rincian + tombol Tampilkan
    (pratinjau tabel) + Unduh Word.
  - `server/smoke-test-s4.js` — 8 pemeriksaan, SEMUA LULUS.
    Pakai kelompok baru "Kelompok S4 <suffix>" di Desa Contoh 3
    (dibuat via SQL di dalam tes — isolasi dari data tes S1–S3).
    Docx diverifikasi terpisah: berkas OOXML valid (10.503 byte),
    berisi judul + rekap + rincian + nama kelompok + jenjang.
  - PERBAIKAN oleh Muse atas output Codex (2 hal): (1)
    `pool.query` → `db.query` (tidak ada variabel `pool` di
    index.js; yang ada `db`); (2) `invalid()` (Error biasa +
    `statusCode`) → `fail(400, ...)` (HttpError) + routing
    disederhanakan (tanpa cek `auth` null — `authenticate`
    sudah melempar 401 — tanpa try/catch sendiri, pakai `url`
    yang sudah ada di `handle()`).
  - Flag must_change_password admin dikembalikan ke true setelah
    tes. Data tes di database bertambah: Kelompok S4 + generus
    A/B/C + 3 pertemuan (semua @tes.gensa.local) — hapus manual
    bila mengganggu.
- **MVP SESI 5 SELESAI (2026-11-21 ~06:05 WIB): Scan HP (kamera) JALAN
  + smoke test S5 7/7 LULUS + S1 11/11 + S3 11/11 + S4 8/8 LULUS
  (tidak ada regresi).** Model gpt-6-astra (GPT 6 Astra High),
  reasoning high, sesi BARU, 1 panggilan. Yang dibangun:
  - `server/public/scan.html` — pilih pertemuan terbuka,
    getUserMedia kamera belakang + jsQR (loop 200 ms, cooldown
    3 detik, riwayat 5 terakhir), catat hadir via POST
    /api/pertemuan/:id/absen, tampilkan nama generus dari daftar
    absensi, input manual cadangan, peringatan bila bukan konteks
    aman (HTTPS/localhost). Palet GENSA, textContent saja.
  - `server/public/jsQR.js` — pustaka jsQR v1.4.0 di-vendor
    (256 KB, UMD global `jsQR`; `npm install jsqr`, salin
    dist/jsQR.js — tidak ada berkas .min.js di paket ini).
  - `server/smoke-test-s5.js` — 7 pemeriksaan, SEMUA LULUS
    (termasuk decode QR asli dengan jsQR di Node: matriks dari
    pustaka `qrcode` yang sama dengan server → bitmap → jsQR
    mengembalikan token yang sama).
  - TIDAK ada perubahan `server/index.js` di sesi ini.
  - CATATAN: kamera HP butuh konteks aman (HTTPS atau
    localhost) — saat aplikasi nanti di-deploy, pastikan
    memakai HTTPS, kalau tidak tombol scan tidak bisa dipakai
    (input manual tetap jalan). Tes kamera HP sungguhan belum
    dilakukan (tidak ada perangkat di VM) — perlu dicoba
    pengguna dari HP-nya.
  - Flag must_change_password admin dikembalikan ke true setelah
    tes. Data tes: generus E/F + 1 pertemuan di Kelompok Contoh C.
- **MVP SESI 6 SELESAI (2026-11-21 ~06:35 WIB): Materi & Penilaian
  JALAN + smoke test S6 7/7 LULUS (2x jalan, idempotent) + S1
  11/11 + S3 11/11 + S4 8/8 + S5 7/7 LULUS (tidak ada regresi).**
  Model gpt-6-astra (GPT 6 Astra High), reasoning high, sesi BARU,
  1 panggilan (~4,8 menit). Yang dibangun:
  - `server/migrations/003_materi_penilaian.sql` — enum
    `kategori_tugas` (doa_surat/makna_pegon/praktik_solat), enum
    `nilai_penilaian` (hafal/belum/bisa/tidak), tabel `tugas`
    (judul, kategori, kelompok_id NULL = global Admin,
    dibuat_oleh) + `penilaian` (generus_id, tugas_id, nilai,
    diubah_count, dicatat_oleh, UNIQUE(generus_id, tugas_id)).
    Migrasi jalan OK (001–003).
  - `server/index.js` — `tugasScopeWhere`, `createTugas`,
    `listTugas`, `deleteTugas` (409 bila ada penilaian),
    `savePenilaian` (upsert; nilai harus cocok kategori; ubah
    maks 2x lalu 403, Admin mengubah = reset count ke 0;
    transaksi + FOR UPDATE), `listPenilaian` (tugas +
    penilaian + hasil % hafalan per generus), routing
    POST/GET /api/tugas, DELETE /api/tugas/:id, POST/GET
    /api/penilaian.
  - `server/public/materi.html` — daftar tugas per kategori +
    tambah/hapus, matriks penilaian (klik tombol nilai untuk
    ganti ke pasangan, kunci bila diubah 2x), tabel Hasil
    (% hafalan, peringatan bila belum ada tugas Doa & Surat,
    penanda PAUD–SD), tombol Kirim WA (wa.me + nomor ortu)
    + Salin per generus.
  - `server/smoke-test-s6.js` — 7 pemeriksaan, SEMUA LULUS.
    Pakai kelompok baru "Kelompok S6 <suffix>" (isolasi; tes
    dibuat idempotent setelah run pertama gagal karena
    tugas lama Kelompok C ikut terhitung).
  - PERBAIKAN oleh Muse atas output Codex (pola yang sama
    seperti S4): `auth.role`/`auth.kelompok_id`/`auth.desa_id`/
    `auth.id` → `auth.user.*` (handler menerima
    `{ user, token }`); `pool.connect()`/`pool.query` →
    `db.getClient()`/`db.query`; routing `return handler(...)`
    → `await handler(...); return;`.
  - Flag must_change_password admin dikembalikan ke true setelah
    tes. Data tes: Kelompok S6 + generus E/F/G + 5 tugas
    (1 dihapus) + penilaian.
- **MVP SESI 7 SELESAI (2026-11-21 ~06:55 WIB): PWA + Reset
  Password JALAN + smoke test S7 6/6 LULUS + S1 11/11 + S3
  11/11 + S4 8/8 + S5 7/7 + S6 7/7 LULUS (tidak ada regresi).**
  Model gpt-6-astra (GPT 6 Astra High), reasoning high, sesi BARU,
  1 panggilan (~1,5 menit). Yang dibangun:
  - `server/public/manifest.json` — GENSA (standalone,
    start_url "/", tema coklat, ikon 192 + 512).
  - `server/public/icon-192.png` + `icon-512.png` — huruf G
    krem di atas coklat #8A5A33 (dibuat Muse dengan PIL,
    DejaVu Sans Bold).
  - `server/public/sw.js` — service worker: cache-first aset
    statis (core pages + manifest + ikon + jsQR.js),
    network-only untuk /api/*, fallback /login.html untuk
    navigasi offline, hapus cache lama saat activate.
  - `server/index.js` — `serveStatic` kini melayani `.json`
    (application/manifest+json) dan `.png` (image/png).
  - `server/public/reset-password.html` — dua keadaan (minta
    tautan via email / atur password baru via ?token=),
    mengikuti gaya login.html.
  - Semua 7 halaman (login, jadwal, cetak-qr, laporan, scan,
    materi, reset-password) kini memuat manifest + registrasi
    service worker; login.html punya tautan "Lupa password?".
  - `server/smoke-test-s7.js` — 6 pemeriksaan, SEMUA LULUS,
    termasuk alur reset penuh (token dibangun di tes dari
    SESSION_SECRET + password_hash — fingerprint HMAC-SHA256 —
    lalu confirm, login password baru OK, password lama 401,
    token tidak bisa dipakai 2x).
  - Flag must_change_password admin dikembalikan ke true setelah
    tes. Data tes: 1 akun kelompok untuk reset (password sudah
    diubah via alur reset).
- **SESI 8 SELESAI (2026-11-21 ~07:30 WIB): Login Google JALAN +
  smoke test S8 8/8 LULUS + S1 11/11 + S3 11/11 + S4 8/8 + S5 7/7 +
  S6 7/7 + S7 6/6 LULUS (tidak ada regresi).** Model gpt-6-astra
  (GPT 6 Astra High), reasoning high, sesi BARU, 1 panggilan
  (~68 detik). Yang dibangun:
  - `server/migrations/004_google_login.sql` — kolom
    `users.google_sub TEXT UNIQUE` (nullable). Migrasi jalan OK.
  - `server/index.js` — konstanta `GOOGLE_CLIENT_ID` /
    `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` (dari env,
    default callback `http://127.0.0.1:3101/api/auth/google/callback`);
    helper `buatStateGoogle` / `periksaStateGoogle` (state HMAC-SHA256
    pakai `resetSignature` yang sudah ada, berlaku 10 menit);
    `mulaiLoginGoogle` (redirect 302 ke accounts.google.com,
    503 bila belum dikonfigurasi) + `callbackLoginGoogle`
    (tukar kode via fetch, verifikasi ID token via tokeninfo:
    aud, email_verified, exp, iss; hanya email yang sudah
    terdaftar Admin + aktif yang boleh masuk; ikat google_sub
    sekali, tolak bila sudah terikat akun Google lain; buat sesi
    seperti login biasa, redirect ke /jadwal.html; semua gagal
    dialihkan ke /login.html?google=<kode>); routing publik
    sebelum `authenticate`.
  - `server/public/login.html` — tombol "Masuk dengan Google"
    + pesan error dari query `google` (tautan-kadaluarsa/gagal/
    belum-terdaftar) via textContent.
  - `.env.example` — tiga baris Google (placeholder kosong).
  - `server/smoke-test-s8.js` — 8 pemeriksaan, SEMUA LULUS
    (redirect Google + state, callback tanpa parameter/state
    rusak/kedaluwarsa/tanda tangan salah → tautan-kadaluarsa,
    state valid + kode palsu → gagal dengan baik, tombol login,
    login email/password tetap jalan). Server tes dijalankan
    dengan `GOOGLE_CLIENT_ID=test-client-id
    GOOGLE_CLIENT_SECRET=test-secret`; jalur 503 diverifikasi
    manual (server tanpa config → 503 + pesan jelas).
  - CATATAN: alur penuh sampai Google BELUM bisa diuji (butuh
    kredensial OAuth asli dari Google Cloud Console — pemilik
    yang buat; isi GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI di
    `.env`, redirect URI di Cloud Console harus sama persis).
    Gerbang `must_change_password` tetap berlaku setelah login
    Google (sama seperti login biasa).
  - Flag must_change_password admin dikembalikan ke true setelah
    tes. Tidak ada data tes baru di database.
- **PRD MVP TUNTAS (2026-11-21 ~07:00 WIB):** S1 akun/peran/
  generus+persetujuan, S2 QR+absensi, S3 jadwal, S4 laporan
  Word, S5 scan HP kamera, S6 materi+penilaian, S7 PWA+reset
  password — semua smoke test lulus, tidak ada regresi.
  YANG TETAP DITUNDA (jangan dibangun tanpa keputusan pengguna):
  login Google, absen offline, link izin; detail kolom Word
  ("nanti dulu"); struktur kelas lengkap (di-input Admin,
  menyusul). S2 re-run gagal 2 pemeriksaan karena data tes lama
  di Kelompok B (caveat yang sudah didokumentasi sejak S2 —
  BUKAN regresi: baris absensi 4 bukan 2 karena generus lama
  ikut terhitung alfa saat penutupan).
- **SESI 9 SELESAI (2026-11-21 ~08:10 WIB): Absen offline JALAN +
  smoke test S9 10/10 LULUS + S1 11/11 + S3 11/11 + S4 8/8 + S5 7/7 +
  S6 7/7 + S7 6/6 + S8 8/8 LULUS (tidak ada regresi).** Model
  gpt-6-astra (GPT 6 Astra High), reasoning high, sesi BARU.
  Catatan proses: panggilan pertama Codex menolak (minta konteks
  inline); prompt gabungan `PROMPT_S9_FULL.md` (47 KB: tugas +
  status + 3 skill + helper + scan.html lengkap) menyelesaikan
  dalam 1 panggilan (~2 menit). Pelajaran: untuk tugas besar yang
  menyentuh file yang belum pernah dibaca Codex, langsung kirim
  prompt lengkap dengan konteks inline — jangan prompt pendek dulu.
  Yang dibangun:
  - `server/migrations/005_absen_offline.sql` — tabel `sync_items`
    (pertemuan_id, generus_id, client_id, status, dicatat_pada,
    dicatat_oleh, UNIQUE(pertemuan_id, client_id)) + kolom
    `absensi.dicatat_pada`. Migrasi jalan OK.
  - `server/index.js` — `daftarPertemuan` (GET
    /api/pertemuan/:id/daftar: generus approved dalam lingkup+
    jenjang + kode_manual/qr_token; canManagePertemuan, 403
    diubah jadi 404 supaya tidak bocor) + `syncAbsensi` (POST
    /api/pertemuan/:id/sync: items 1–200, transaksi + FOR UPDATE,
    idempotensi via sync_items, aturan "hadir yang menang"
    — hadir mengalahkan izin/sakit, antar bukan-hadir yang
    pertama menang; item di luar lingkup/tidak valid ditolak
    per item; 409 bila pertemuan selesai; dicatat_pada dari
    klien divalidasi ISO + maks 24 jam ke depan).
  - `server/public/scan.html` — section "Antrean offline"
    (pesan antrean + pesan daftar + tombol Kirim antrean),
    fungsi offline (daftar di localStorage `gensa-daftar-<id>`,
    antrean `gensa-antrean-<id>`, simpan offline saat fetch
    gagal jaringan, kirim bertahap maks 200/potongan, simpan
    kemajuan per potongan, fallback memori bila localStorage
    gagal), wiring (catch catatAbsen, ganti pertemuan, tombol
    kirim, event online, muat halaman unduh daftar + kirim
    otomatis).
  - `server/smoke-test-s9.js` — 10 pemeriksaan, SEMUA LULUS
    (daftar + kode, kelompok lain 404, sync hadir/izin +
    dicatat_pada, kirim ulang tidak double, hadir menang,
    tolak per item, 400 kosong/>200, 409 pertemuan selesai,
    halaman scan memuat antrean).
  - CATATAN: risiko data hilang bila HP ganti/hilang sebelum
    sync — diterima pengguna sebagai batasan (PRD §7).
  - Flag must_change_password admin dikembalikan ke true setelah
    tes. Data tes: Kelompok S9 + S9-lain, generus A/B/C/D,
    2 pertemuan (1 ditutup).
- **SESI 10 SELESAI (2026-11-21 ~09:30 WIB): Link izin JALAN +
  smoke test S10 16/16 LULUS + S1 11/11 + S3 11/11 + S4 8/8 + S5 7/7 +
  S6 7/7 + S7 6/6 + S8 8/8 + S9 10/10 LULUS (tidak ada regresi).**
  Model gpt-6-astra (GPT 6 Astra High), reasoning high, sesi BARU.
  Catatan proses: panggilan pertama Codex MENOLAK (salah paham
  frasa "tidak boleh akses file" + sandbox read-only); prompt
  diperbaiki dengan bagian CARA KERJA (kode dikeluarkan di jawaban,
  Muse yang menulis ke repo) → panggilan kedua selesai ~7 menit,
  mengirim migrasi + backend + 2 halaman lengkap. Codex TIDAK
  mengirim smoke test (minta kontrak setup S9) dan integrasi
  jadwal.html hanya penanda (nama variabel wadah tidak ada di
  prompt) — Muse menulis smoke-test-s10.js sendiri mengikuti pola
  S9 dan menyelesaikan integrasi jadwal.html (variabel `actions`).
  Yang dibangun:
  - `server/migrations/006_link_izin.sql` — enum `status_izin`
    (menunggu/disetujui/ditolak), tabel `izin` (pertemuan_id,
    generus_id, alasan sakit/izin, keterangan wajib bila izin,
    diputuskan_oleh/pada, catatan_penolakan), kolom
    `pertemuan.izin_token TEXT UNIQUE` (nullable). Migrasi jalan OK.
  - `server/index.js` — `muatIzinPublik` (GET /api/izin publik:
    token 32 hex, berjenjang desa→kelompok→nama sesuai tingkat
    pertemuan, daftar nama TANPA kode_manual/qr_token),
    `kirimIzin` (POST /api/izin publik: verifikasi kode sama
    seperti recordAbsen + kode harus cocok generus_id yang
    dipilih, duplikat menunggu/disetujui 409, transaksi + FOR
    UPDATE), `linkIzin` (GET /api/pertemuan/:id/link-izin: token
    dibuat malas, UPDATE bersyarat anti-balapan), `listIzin`,
    `setujuiIzin` (masuk absensi status = alasan, ON CONFLICT
    update), `tolakIzin` (catatan opsional maks 500); routing
    publik sebelum `authenticate`, routing kelola setelah rute
    koreksi. Semua tulis pakai transaksi + FOR UPDATE.
  - `server/public/izin.html` — halaman publik: info kegiatan,
    pilih berjenjang, radio sakit/izin + keterangan wajib bila
    izin, input kode + tombol Scan barcode (getUserMedia +
    jsQR, isi otomatis), kirim → pesan menunggu persetujuan.
  - `server/public/izin-kelola.html` — salin link izin + daftar
    pengajuan + tombol Setujui/Tolak (tolak minta catatan via
    prompt, boleh kosong).
  - `server/public/jadwal.html` — tombol 'Salin link izin' +
    'Kelola izin' di tiap jadwal yang bisa dikelola dan belum
    selesai.
  - `server/smoke-test-s10.js` — 16 pemeriksaan, SEMUA LULUS
    (ditulis Muse; pola S9; isolasi Kelompok S10 + S10-lain,
    generus A/B/C, pertemuan kelompok + desa).
  - PERBAIKAN oleh Muse atas output Codex: (1)
    `tambahkanTombolIzin` diseragamkan ke tanda tangan
    `buatElemen(tag, text, className)` jadwal.html dan
    `beriPesan(error.message, true)`; (2) tes membandingkan
    tanggal dengan `.slice(0, 10)` karena pg mengembalikan
    kolom DATE sebagai timestamp ISO.
  - CATATAN: S2 re-run gagal 3 pemeriksaan — BUKAN regresi:
    12 generus approved menumpuk di Kelompok Contoh B (9 sisa
    putaran S2 lama); penutupan pertemuanPertama menandai
    semuanya (rows.length 12 bukan 2), tes berhenti sebelum
    pertemuanKedua dibuat, lalu 'Koreksi' dan 'Daftar
    pertemuan' ikut gagal — satu rantai dari caveat data tes
    lama yang sudah didokumentasi sejak S2. S8 butuh
    GOOGLE_CLIENT_ID di proses TES juga (bukan cuma server),
    kalau tidak assert di awal main() melempar sebelum cek
    pertama.
  - Flag must_change_password admin dikembalikan ke true setelah
    tes. Server dimatikan setelah tes. Data tes: Kelompok S10 +
    S10-lain, generus A/B/C, 2 pertemuan (1 ditutup), 2 izin
    (1 disetujui masuk absensi sakit, 1 ditolak).
- **3 ITEM DITUNDA DILANJUTKAN (perintah pemilik 2026-11-21
  ~05:27 WIB): "3 item lanjutin lagi sekalian aja" — bangun
  ketiganya: login Google, absen offline, link izin. Sesi 8
  (login Google) SELESAI, Sesi 9 (absen offline) SELESAI, Sesi 10
  (link izin) SELESAI di atas. Berikutnya Sesi 11 review Codex
  ("apa yang kurang") — review HANYA melapor, jangan langsung
  diperbaiki.
- **MODEL CODEX YANG DIPAKAI (perintah pemilik 2026-11-21): GPT 6
  Astra High** — model `gpt-6-astra` + reasoning `high`. Model ini
  dipakai mulai Sesi 2 backend (sesi baru, bukan resume). Jangan
  pakai model yang lebih lemah. Model Sesi 1 (gpt-6.1-terra)
  sudah tidak dipakai lagi.
- Akun Admin Utama: `admin@gensa.local` (password awal dibuat acak
  saat seed; WAJIB diganti saat login pertama — flag sudah
  dikembalikan ke true setelah smoke test). Password awal HANYA ada
  di laporan Muse ke pemilik, TIDAK di repo.
- 19 pertanyaan Codex SUDAH dijawab pemilik — lihat
  `docs/PRD_JAWABAN.md` (bagian terakhir). Jangan tanya lagi.

## Yang sudah selesai

- 2026-11-20: Codex review PRD (prompt `PROMPT_PRD_REVIEW.md`).
  Sesi `01a1f99e-7e78-76f0-8693-9ae5b799d069`, model gpt-6.1-terra,
  5.483 token. Codex HANYA review + bertanya, TIDAK membangun.
  Hasil: 19 pertanyaan klarifikasi (di bawah). Limit mingguan
  Codex saat itu sisa 1d 19h.
- CATATAN TEKNIS: Codex di VM ini TIDAK bisa membaca STATE.md /
  skill dan TIDAK bisa menulis STATE.md — alat workspace gagal
  (`codex-code-mode-host` tidak ada di
  `/opt/hatch-image/bin/`). Jadi review ini hanya berdasarkan PRD
  di prompt; pertanyaan di bawah disimpan ke file ini oleh Muse,
  bukan oleh Codex. Perlu diperbaiki sebelum sesi Codex berikutnya
  yang butuh baca/tulis file.
- 2026-11-21 ~00:45: **MVP Sesi 1 selesai — backend fondasi.**
  Model gpt-6.1-terra, reasoning medium. Dua panggilan Codex
  (skema, lalu server via `codex exec resume --last`), total
  ~90 ribu token. Yang dibangun Codex (ditulis ke repo oleh Muse,
  karena Codex tidak bisa tulis file):
  - `server/migrations/001_init.sql` — tabel daerah, desa,
    kelompok, users, generus, sessions + 4 enum. Jenjang kolom
    GENERATED dari tingkat. CHECK: peran↔scope, reject wajib
    catatan, approved wajib qr_token + kode_manual.
  - `server/seed.js` — 1 daerah + 3 desa + 3 kelompok contoh,
    1 akun Admin Utama (password dari env, wajib ganti saat
    login pertama). Idempotent. Generus KOSONG.
  - `server/db.js`, `server/index.js` — server HTTP Node stdlib
    + pg + bcryptjs (tanpa Express/ORM). Endpoint: login/logout,
    /api/me, buat akun (admin saja, password awal acak 12 karakter),
    ganti password, reset password (token HMAC 1 jam, link hanya
    di console server — SMTP belum ada), ajukan generus (kelompok
    saja), list generus ikut scope, approve/reject generus (admin,
    approve isi qr_token 32 hex + kode_manual 6 karakter),
    ajukan hapus + setuju/tolak hapus (admin). Rate limit login
    5 gagal/15 menit → 429. Cookie HttpOnly SameSite=Lax.
    Akun yang wajib ganti password hanya bisa /api/me, logout,
    ganti password.
  - `server/public/login.html` — halaman login minimal palet GENSA.
  - `server/smoke-test.js` — 11 pemeriksaan, SEMUA LULUS
    (login salah 401, admin login + cookie, /api/me tanpa login 401,
    ganti password awal, buat akun kelompok, kelompok ajukan generus
    pending tanpa QR, list ikut scope, admin approve isi QR+kode,
    daerah tidak bisa ajukan generus 403, rate limit 429).
  - `server/migrate.js` — runner migrasi (ditambahkan Muse).
  - `.env.example` diperbarui (DATABASE_URL, PORT 3101,
    SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD). `.env` asli di
    root repo, mode 600, gitignored — TIDAK ada rahasia di repo.
  - Migrasi + seed SUDAH dijalankan di database asli dan
    terverifikasi: 1 daerah, 3 desa, 3 kelompok, 1 admin
    (must_change_password=true), 0 generus awal. Data tes dari
    smoke test masih ada (2 akun @tes.gensa.local + 1 generus
    approved "Generus Tes ..." dengan kode_manual) — hapus manual
    bila mengganggu.
  - Halaman reset password (`/reset-password.html`) BELUM dibuat;
    token reset baru bisa dipakai lewat endpoint confirm.
  - `updated_at` tidak ada trigger — di-SET manual di tiap UPDATE.
  - Penolakan hapus menyimpan catatan di `alasan_penolakan`; belum
    ada riwayat keputusan terpisah.
- CARA KERJA CODEX DI VM INI (terbukti jalan 2026-11-21):
  `codex exec` dengan stdin dari FILE (`- < prompt.md`, JANGAN dari
  pipe harness — stdin yang tidak EOF bikin Codex gantung), flag
  `-m gpt-6-astra -c model_reasoning_effort="high"` (model GPT 6
  Astra High, perintah pemilik 2026-11-21), output ditangkap
  `-o /tmp/codex-*.txt`, lalu Muse yang menulis file-nya ke repo.
  Kalau Codex menolak folder non-git, tambah flag
  `--skip-git-repo-check`. Prompt build: `PROMPT_S1_SCHEMA.md`,
  `PROMPT_S1_SERVER.md`, `PROMPT_S2_QR_ABSENSI.md` (+ followup
  `PROMPT_S2_FOLLOWUP*.md`, `PROMPT_S2_BACKEND_ASTRA.md`).
  `codex-code-mode-host` TETAP hilang dan `/opt/hatch-image/bin`
  read-only — jangan coba install binary dari tarball npm (gagal
  cek risiko eksekusi). Model Sesi 1 (gpt-6.1-terra) sudah tidak
  dipakai lagi; jangan pakai yang murah (gpt-6-luna, gpt-reserve).
- 2026-11-21 ~03:40: **MVP Sesi 2 selesai — QR + absensi.**
  Model gpt-6-astra (GPT 6 Astra High), reasoning high, sesi BARU
  (bukan resume — resume tidak bisa ganti model). Total Sesi 2:
  ~135 ribu token (termasuk 3x Codex gpt-6.1-terra menolak/menunda
  backend, lalu Astra High menyelesaikan dalam 1 panggilan,
  27.852 token, ~7 menit). Yang dibangun:
  - `server/migrations/002_pertemuan_absensi.sql` — enum
    status_absensi (hadir/izin/sakit/alfa); tabel pertemuan
    (tingkat kelompok/desa/daerah, kelompok_id/desa_id,
    jenjang_target jenjang_generus[], tanggal, dibuat_oleh,
    selesai_pada, CHECK scope sesuai tingkat); tabel absensi
    (pertemuan_id, generus_id, status, dicatat_oleh,
    koreksi_count DEFAULT 0, UNIQUE(pertemuan_id, generus_id)).
  - `server/index.js` — ditambah 607 baris, 0 baris Sesi 1
    dihapus (terverifikasi diff). Endpoint baru: POST/GET
    /api/pertemuan, GET /api/pertemuan/:id (+ringkasan status),
    GET /api/pertemuan/:id/absensi, POST .../absen (kode manual
    6 karakter ATAU qr_token 32 hex), POST .../absen-manual
    (generus_id + status hadir/izin/sakit), POST .../selesai
    (tandai alfa untuk semua approved dalam lingkup+jenjang yang
    belum ada barisnya), POST .../absensi/:id/koreksi (1x dalam
    24 jam setelah selesai), GET /api/generus/:id/qr.svg (SVG QR,
    scope-checked). Semua tulis absensi pakai transaksi +
    SELECT ... FOR UPDATE pada baris pertemuan (cegah balapan
    absen vs penutupan). Scope baca pertemuan mengikuti wilayah;
    kelola pertemuan hanya oleh pengurus tingkat penyelenggara
    (atau admin). Dependensi `qrcode` ^1.5.4 ditambahkan
    (sudah terpasang, terverifikasi generate SVG).
  - `server/public/cetak-qr.html` — halaman cetak QR untuk
    pengurus kelompok (palet GENSA, textContent saja, tombol
    Cetak semua + Cetak kartu ini, CSS print).
  - `server/smoke-test-s2.js` — 15 pemeriksaan, SEMUA LULUS
    (pertemuan, absen kode manual + QR tanpa double, tolak
    luar jenjang/kode salah, absen manual izin, desa 403,
    selesai + alfa, koreksi 1x lalu 409, QR SVG, halaman cetak,
    daftar pertemuan ikut wilayah). Tes memakai Kelompok Contoh
    B (Desa Contoh 2) supaya terisolasi dari sisa tes Sesi 1 di
    Kelompok Contoh A.
  - Migrasi 002 SUDAH dijalankan di database asli. Smoke test
    S2 15/15 LULUS; smoke test S1 11/11 LULUS (tidak ada regresi;
    flag must_change_password admin dikembalikan ke true setelah
    tes, seperti Sesi 1).
  - CATATAN: menjalankan smoke-test-s2.js lebih dari sekali akan
    meninggalkan generus approved dari putaran sebelumnya di
    Kelompok Contoh B, sehingga cek "tepat 3 baris" bisa gagal
    pada putaran ke-2 (alfa finalisasi mencakup semua approved
    dalam lingkup). Untuk putaran ulang, hapus dulu generus tes
    di Kelompok Contoh B atau pakai kelompok lain yang kosong.
  - Data tes di database: 2 pertemuan, 5 absensi, 5 generus
    (semua @tes.gensa.local) — hapus manual bila mengganggu.

## Aturan sesi Codex (dari pengguna, 2026-11-21)

- Lanjut sampai token habis. Kalau berhenti di tengah jalan, Muse cek
  kira-kira sampai mana progresnya.
- Kalau sudah 5 jam (limit kembali), buat SESI BARU dan lanjutkan — JANGAN
  resume sesi lama, supaya Codex tidak baca ulang semua file (hemat token).
- Konteks dibawa lewat STATE.md, bukan dengan baca ulang semua file.
- **Lanjut terus sampai selesai SEMUA PRD (pengguna, 2026-11-21 04:38).**
- **Scan HP (kamera) TETAP dipakai (pengguna, 2026-11-21 04:38)** —
  sebelumnya ditunda di MVP, kini diminta: scan QR pakai kamera HP
  (getUserMedia/jsQR) untuk absensi.

## Yang sedang dikerjakan

- **SESI 11 SELESAI (2026-11-21 ~09:45 WIB): Review Codex ("apa
  yang kurang") — HANYA MELAPOR, tidak ada kode yang diubah.**
  Model gpt-6-astra, reasoning high, sesi BARU, 1 panggilan
  (~2 menit). Prompt `PROMPT_S11_REVIEW.md` (PRD + jawaban
  pengguna + ringkasan implementasi inline). Hasil lengkap di
  `/tmp/codex-s11.txt` (bisa hilang bila VM diganti — ringkasan
  di bawah). Temuan utama Codex:
  - **Belum dibangun (M1–M11):** M1 halaman daftar/pengajuan/
    persetujuan generus (API saja, tanpa UI); M2 halaman
    pengajuan/keputusan hapus + tulisan "dalam proses
    pengajuan"; M3 halaman Admin buat akun; M4 kirim email
    reset password (tautan hanya di console); M5 pemberitahuan
    hasil pengajuan ke pemohon; M6 kolom jenis kelamin; M7
    struktur kelas + menu khusus PAUD–SD; M8 riwayat perubahan
    kelas; M9 tugas per kelas/tahun; M10 retensi 1 bulan; M11
    deploy.
  - **Beda dari PRD (D1–D9):** D1 Desa tidak bisa ajukan hapus
    (requestDelete hanya peran Kelompok); D2 Admin ubah nilai =
    reset count ke 0 (bukan izin Admin); D3 satu token per
    pertemuan vs PRD "link per kelompok" (perlu diperjelas);
    D9 catatan tolak hapus menimpa alasan_penolakan.
  - **Risiko (R1–R24):** R2 POST /api/izin publik tanpa rate
    limit (kode 6 karakter bisa ditebak berulang); R3 nama
    tampil sebelum verifikasi kode; R4 tautan reset di console;
    R5 S2 gagal 3 (data tes lama); R6–R24 sebagian besar
    "TIDAK BISA DINILAI — butuh baca kode" (Codex tidak baca
    repo).
  - **Prioritas Codex:** (a) wajib sebelum dipakai: alur MVP
    lewat UI (M1–M5, D1, R6, R11), jenis kelamin (M6),
    integritas inti (R7–R10, R12, R16), keamanan dasar
    (R17–R20, R22–R24), R2/R14 bila link izin aktif, deploy +
    HTTPS + uji HP; (b) menyusul: kelas/PAUD–SD/riwayat (M7–M8),
    tugas per kelas/tahun (M9), D2, R15; (c) tidak perlu: kolom
    umur tersimpan, email otomatis akun awal, jadwal berulang,
    laporan PDF/Excel.
  - **VERIFIKASI MUSE atas review (baca kode langsung):**
    R8 TERKONFIRMASI RUSAK — `approveDelete` hanya
    `DELETE FROM generus WHERE status='delete_pending'`,
    sementara `absensi`/`penilaian`/`izin`/`sync_items`
    punya FK ke `generus(id)` TANPA `ON DELETE CASCADE`:
    hapus generus yang punya riwayat absen/nilai akan gagal
    FK (23503 → 500), padahal PRD §6 minta riwayat ikut
    hilang. Perbaiki: hapus baris anak dulu dalam transaksi,
    baru generus. D1 TERKONFIRMASI — `requestDelete`
    `requireRole('kelompok')`. R6 TERKONFIRMASI — tidak ada
    endpoint edit generus / ajukan ulang (rute hanya
    approve/reject/delete-request/delete-approve/delete-
    reject). R9 BAGUS — approve hanya bila status='pending'
    (QR tidak bisa berubah), qr_token dari
    crypto.randomBytes. Koreksi BAGUS — transaksi + FOR UPDATE
    baris absensi, batas 24 jam pakai clock_timestamp(),
    koreksi_count dicek. R7 BAGUS untuk scan/manual
    (generusInScope mensyaratkan status='approved').
- **3 ITEM DITUNDA + REVIEW SELESAI SEMUA.** Sesi 8 login Google
  SELESAI, Sesi 9 absen offline SELESAI, Sesi 10 link izin SELESAI,
  Sesi 11 review Codex SELESAI (daftar ada di atas). Berikutnya
  butuh keputusan pemilik dulu (lihat "Langkah berikut") —
  JANGAN langsung perbaiki hasil review tanpa perintah. Yang
  tersisa butuh keputusan pengguna: detail kolom Word ("nanti
  dulu"), struktur kelas lengkap (di-input Admin, menyusul),
  uji kamera scan HP sungguhan oleh pengguna, kredensial OAuth
  Google asli (Google Cloud Console), dan deploy (Vercel gratis
  untuk MVP, lalu PC mini).
- Bila ada sesi lanjutan: satu perubahan kecil per sesi, prompt
  ditulis ke `PROMPT_S9_*.md` dst dulu, model gpt-6-astra,
  reasoning high, SESI BARU (jangan resume).

## Pertanyaan Codex atas PRD (2026-11-20)

Dua hal yang perlu dipastikan lebih dulu: jawaban no. 1 menyatakan
penambahan generus hanya oleh Kelompok, sedangkan no. 2 juga
mengizinkan Desa; dan cara pembuatan akun masih bertentangan antara
dibuat Admin dan pendaftaran khusus per peran.

1. **Cakupan minggu ini:** Bagian mana yang wajib selesai minggu
   ini? Jika belum ditentukan, apakah MVP boleh difokuskan pada akun
   dan peran, data generus serta persetujuannya, jadwal, dan absensi;
   sementara materi, laporan Word, dan fitur lain menyusul?
2. **Akun dan organisasi:** Siapa yang membuat akun Admin Utama,
   Daerah, Desa, dan Kelompok? Apakah halaman pendaftaran hanya
   mengirim permohonan akun yang harus disetujui, atau Admin langsung
   membuat semua akun? Apakah satu akun boleh memiliki beberapa peran
   atau wilayah?
3. **Batas akses:** Apakah setiap pengurus hanya boleh melihat dan
   mengubah data dalam wilayahnya? Untuk Daerah yang "bisa semuanya
   seperti Admin", tindakan apa saja yang tetap khusus Admin Utama,
   selain persetujuan dan penambahan generus?
4. **Penambahan generus:** Apakah Kelompok **dan** Desa sama-sama
   boleh mengajukan generus baru? Ketika Desa mengajukan, apakah
   generus harus langsung dipilihkan Kelompok? Siapa yang boleh
   mengubah data generus setelah disetujui?
5. **Penghapusan dan perpindahan:** Selain Desa, siapa yang boleh
   mengajukan penghapusan? Apakah generus yang keluar sebaiknya
   dinonaktifkan agar riwayat absensi tetap ada? Bagaimana proses
   perpindahan generus antar-Kelompok atau Desa, dan apakah perlu
   persetujuan?
6. **Persetujuan:** Apakah Admin Utama dapat menyetujui atau menolak
   dengan catatan, dan apakah pemohon perlu mendapat pemberitahuan?
   Apakah ada batasan siapa yang dapat melihat alasan penghapusan?
7. **Data generus dan orang tua:** Kolom apa saja yang wajib diisi?
   Untuk orang tua, apakah diperlukan nama, hubungan, dan nomor
   telepon saja, atau juga data lain? Apakah satu generus dapat
   memiliki lebih dari satu orang tua atau wali?
8. **Jenjang dan PAUD–SD:** Apa saja jenjang utama yang digunakan,
   termasuk hubungan caberawit, pra remaja, remaja, dan PAUD–SD?
   Apakah subkelas PAUD–SD berlaku sama di semua wilayah? Apakah
   perubahan kelas seorang generus perlu menyimpan riwayat?
9. **Login:** Apakah Google login wajib untuk MVP atau pilihan
   tambahan? Jika dipakai, apakah hanya email yang sudah didaftarkan
   Admin yang boleh masuk? Apakah semua pengguna pasti mempunyai
   alamat email untuk reset password?
10. **QR generus:** Saat QR hilang, apakah QR lama harus
    dinonaktifkan dan diterbitkan kode baru? Ini perlu dipastikan
    karena QR disebut tidak dapat berubah. Apakah QR harus dapat
    dicetak atau disimpan sebagai gambar?
11. **Pemindaian absensi:** Apakah hanya pengurus pada tingkat
    penyelenggara yang boleh memindai, dan apakah mereka hanya boleh
    memindai generus yang termasuk sasaran kegiatan tersebut? Apakah
    diperlukan status hadir, izin, sakit, dan alfa; serta bolehkah
    pengurus mengoreksi hasil setelah kegiatan?
12. **Penggunaan offline:** Perangkat apa yang harus mendukung
    pemindaian offline, dan apakah pengurus harus login serta
    mengunduh jadwal dan data yang diperlukan sebelum kehilangan
    koneksi? Jika dua perangkat mencatat generus yang sama atau
    memberi status berbeda, aturan mana yang menang?
13. **Jadwal:** Untuk jadwal berulang, pola apa yang diperlukan —
    misalnya harian, mingguan, atau bulanan? Apakah satu pertemuan
    dalam rangkaian boleh diubah atau dibatalkan sendiri? Bagaimana
    peserta ditentukan jika jenjang atau wilayahnya berubah?
14. **Izin publik:** Siapa yang boleh membuka tautan izin — siapa
    saja yang memiliki tautan, atau harus login? Apakah pengirim
    memilih kegiatan dan tanggal tertentu, dan apakah izin perlu
    disetujui pengurus? Bagaimana mencegah orang memilih nama orang
    lain atau mengirim izin berulang?
15. **Persentase kehadiran:** Apakah rumusnya **jumlah hadir ÷
    jumlah pertemuan yang wajib diikuti × 100%**? Bagaimana izin,
    sakit, kegiatan yang dibatalkan, dan generus yang baru bergabung
    dihitung? Apakah laporan memakai tanggal pertemuan atau waktu
    data tersinkron?
16. **Materi dan penilaian:** Siapa yang membuat daftar materi dan
    tugas hafalan, dan apakah materi berbeda menurut jenjang atau
    wilayah? Apakah pengurus dapat memperbarui hasil berulang kali,
    dan apakah riwayat perubahan perlu disimpan? Untuk persentase
    Hasil, apakah rumusnya jumlah tugas berstatus *Hafal* dibagi
    seluruh tugas hafalan yang berlaku?
17. **Laporan Word:** Laporan apa saja yang wajib tersedia pada
    tahap awal, siapa yang boleh mengunduhnya, dan apakah perlu kop,
    tanda tangan, atau format contoh? Apakah laporan Daerah perlu
    rincian per generus atau cukup rekap per wilayah dan kegiatan?
18. **Server dan PWA:** Apakah server, domain, sertifikat HTTPS,
    layanan email, dan pencadangan sudah tersedia? Perangkat dan
    browser apa yang harus didukung, terutama untuk instalasi PWA
    dan pemindaian kamera?
19. **Privasi dan retensi:** Siapa yang boleh melihat nomor telepon
    orang tua dan alasan izin? Berapa lama data dan riwayat perlu
    disimpan, terutama untuk generus yang sudah keluar?

## Langkah berikut

- Sesi 11 review Codex SELESAI (2026-11-21 ~09:45 WIB) — daftar
  ada di STATE.md bagian "Status sekarang". LANGKAH BERIKUT
  (butuh keputusan pemilik dulu, JANGAN langsung perbaiki):
  prioritas Codex + verifikasi Muse: (1) perbaiki
  `approveDelete` (R8 — hapus riwayat anak dulu dalam
  transaksi, kalau tidak hapus generus ber-riwayat gagal FK);
  (2) lengkapi alur MVP lewat UI — halaman generus
  (daftar/ajukan/setuju-tolak), halaman hapus + "dalam proses
  pengajuan", halaman Admin buat akun (M1–M3); (3) tambah
  kolom jenis kelamin (M6) + endpoint edit/ajukan-ulang
  generus (R6); (4) izinkan Desa ajukan hapus (D1); (5) rate
  limit untuk POST /api/izin publik (R2). Baru setelah itu:
  struktur kelas/PAUD–SD + riwayat kelas (M7–M8), retensi
  1 bulan (M10), kirim email reset (M4, butuh SMTP), deploy.
- Jangan push ke GitHub dari VM — repo `RoisChakim/gensa` di-push
  pemilik sendiri (konektor GitHub ditolak 403 saat membuat repo).
- Aturan dari pemilik: SETIAP sebelum prompt ke Codex, kabari
  pemilik dulu. Sesi 1 ini dijalankan atas jadwal yang pemilik
  buat sendiri (limit kembali ~23:56 WIB).

## Catatan / keputusan pengguna

- Palet: krem hangat `#F6F1E9`, coklat `#8A5A33`, sage `#5F7A57/#7C9A6E`.
  Tanpa latar gelap, tanpa neon.
- Peran Daerah baca-saja masih tafsiran, belum dikonfirmasi.
- Struktur kelas pra remaja/remaja A–C, usia nikah A–B masih tebakan.
- Jangan masukkan rahasia ke kode/repo.
