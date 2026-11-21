# Referensi Tampilan v1 — WAJIB DITIRU (Sesi 12+)

Sumber: `~/workspace/simgenerus-clone/sistem-generus-standalone.html` (demo v1).
Perintah pemilik (2026-11-21): **menu dan tampilannya sama seperti v1, sistemnya PRD baru.**
Artinya: tiru layout, menu, kartu, filter, tabel, dan CSS v1 sedekat mungkin.
Data dan aksi HARUS lewat API backend baru (bukan localStorage, bukan data contoh).

## Menu sidebar — urutan dan nama HARUS sama seperti v1
1. Dashboard → /dashboard.html
2. Daftar Generus → /generus.html
3. Materi → /materi.html
4. Jadwal Mengaji → /jadwal.html
5. Izin → /izin-kelola.html
6. Laporan WhatsApp → /laporan.html
7. Cetak QR Code → /cetak-qr.html
8. Akun → /akun.html — TAMBAHAN BARU (tidak ada di v1), hanya tampil untuk peran Admin, letaknya setelah Cetak QR Code.

Yang TIDAK dipakai dari v1: bagian "Demo" (Ganti Peran, Reset Data Contoh), banner "Data contoh",
login demo per peran. Blok bawah sidebar tetap ada: nama pengguna + peran (dari /api/me),
tombol Keluar (POST /api/logout lalu ke /login.html).

## Shell aplikasi (salin struktur ini ke setiap halaman)
```html
<div id="appView">
  <div class="app-layout">
    <aside class="sidebar" id="sidebar">
      <div class="brand-row">
        <div class="brand-logo"><img src="/icon-192.png" alt="Logo GENSA"></div>
        <div><div class="brand-name" style="font-size:16px">GENSA</div><div class="brand-sub">Platform Manajemen Generus</div></div>
      </div>
      <button class="side-link active" data-view="dashboard"><span class="ic">▦</span> Dashboard</button>
      ... (menu di atas, pakai <a href="..."> atau button yang pindah halaman; yang aktif diberi class "active")
      <div class="side-user">
        <div class="nm" id="userName">Admin</div>
        <div class="rl" id="userRole">Admin · akses penuh</div>
        <button id="logoutBtn" type="button">Keluar</button>
      </div>
    </aside>
    <main class="main">
      <div class="topbar">
        <div>
          <button class="menu-btn" id="menuBtn" type="button">☰</button>
          <h2 id="pageTitle">Dashboard</h2>
          <div class="sub" id="pageSub"></div>
        </div>
        <span class="scope-badge" id="scopeBadge"></span>
      </div>
      <!-- isi halaman -->
    </main>
  </div>
</div>
```
Menu di sidebar adalah tautan ke halaman sungguhan (bukan ganti view dalam satu halaman).
Tombol ☰ membuka/menutup sidebar di layar kecil (class "open").

## Dashboard v1 (struktur yang ditiru)
```html
<section id="view-dashboard">
  <div class="stats" id="statsRow"></div>
  <div class="card">
    <h3>Ringkasan Jenjang</h3>
    <div class="hint">Jumlah generus per jenjang dalam lingkupmu.</div>
    <div id="jenjangRow"></div>
  </div>
  <div class="card">
    <h3>Jadwal Terdekat</h3>
    <div class="hint">Jadwal mengaji yang akan datang dalam lingkupmu.</div>
    <div id="upcomingList"></div>
  </div>
</section>
```
Kartu statistik v1 (class "stat": .lb label kecil huruf besar, .vl angka besar, .dt detail kecil).

## Halaman Daftar Generus v1 (struktur yang ditiru)
- Kartu berisi: h3 "Daftar Generus", hint, baris .stats (ringkasan), baris .stats (per jenjang),
  toolbar: input cari nama, select jenjang (Semua jenjang / Caberawit (PAUD–SD) / Pra Remaja (SMP) /
  Remaja (SMA) / Usia Nikah (Kuliah/Kerja)), select Desa, select Kelompok (berjenjang: Kelompok
  mengikuti Desa yang dipilih), tombol "+ Tambah Generus".
- Tabel kolom: Nama | No. Unik | JK | Umur | Kelas | Tgl Lahir | Jenjang | Kelompok | Kehadiran | QR | (aksi).
- Tag jenjang: .tag-caberawit (biru), .tag-pra (kuning), .tag-remaja (sage), .tag-nikah (merah).

## CSS v1 — SALIN UTUH ke setiap halaman baru (di <style>)
```css
:root{
  --bg:#F6F1E9; --bg2:#EFE8DA; --card:#FFFDF8; --card2:#FBF7EF;
  --input:#FFFFFF; --line:#E9DFCE; --line2:#DCCFB6;
  --lime:#5F7A57; --lime-dim:#7C9A6E;
  --btn:#8A5A33;
  --text:#2C2620; --muted:#7A6F61; --muted2:#A79C8B;
  --danger:#C25E4B; --amber:#8A6D1F; --blue:#5E8A94;
  --radius:20px; --radius-sm:10px;
  --font:'Plus Jakarta Sans',Inter,system-ui,-apple-system,'Segoe UI',sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:var(--bg);color:var(--text);font-family:var(--font);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
button{font-family:var(--font);cursor:pointer}
input,select,textarea{font-family:var(--font)}
a{color:var(--lime)}
::placeholder{color:var(--muted2)}
#appView{display:none;min-height:100vh}
.app-layout{display:flex;min-height:100vh}
.sidebar{width:248px;flex:0 0 248px;background:#FBF7EE;border-right:1px solid var(--line);padding:20px 14px;
  display:flex;flex-direction:column;gap:4px;position:sticky;top:0;height:100vh}
.sidebar .brand-row{padding:2px 8px 14px;border-bottom:1px solid var(--line);margin-bottom:14px}
.brand-row{display:flex;align-items:center;gap:12px;margin-bottom:20px}
.brand-logo{width:34px;height:42px;border-radius:10px;flex:0 0 34px;overflow:hidden;background:none}
.brand-logo img{width:100%;height:100%;object-fit:cover;display:block}
.brand-name{font-size:18px;font-weight:800;letter-spacing:-.01em;line-height:1.2}
.brand-sub{font-size:12.5px;color:var(--muted)}
.side-link{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:10px;color:var(--muted);
  background:none;border:none;width:100%;text-align:left;font-size:14px;font-weight:600;text-decoration:none}
.side-link .ic{font-size:17px;width:22px;text-align:center}
.side-link:hover{background:rgba(124,154,110,.07);color:var(--text)}
.side-link.active{background:rgba(124,154,110,.13);color:var(--lime)}
.side-label{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--muted2);padding:14px 12px 6px}
.side-user{margin-top:auto;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px}
.side-user .nm{font-weight:700;font-size:13.5px}
.side-user .rl{font-size:12px;color:var(--lime)}
.side-user button{margin-top:9px;width:100%;background:none;border:1px solid var(--line2);color:var(--muted);
  border-radius:8px;padding:7px;font-size:12.5px;font-weight:600}
.main{flex:1;min-width:0;padding:26px 30px 60px}
.topbar{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:6px;flex-wrap:wrap}
.topbar h2{font-size:24px;font-weight:800;letter-spacing:-.02em}
.topbar .sub{color:var(--muted);font-size:13.5px;margin-top:3px}
.scope-badge{display:inline-flex;align-items:center;gap:7px;background:rgba(124,154,110,.09);border:1px solid rgba(124,154,110,.3);
  color:var(--lime);border-radius:999px;padding:6px 13px;font-size:12.5px;font-weight:700}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:16px 0 22px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.stat .lb{font-size:12px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.stat .vl{font-size:30px;font-weight:800;letter-spacing:-.02em;margin-top:4px}
.stat .dt{font-size:12.5px;color:var(--muted);margin-top:2px}
.stat .dt b{color:var(--lime)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:18px}
.card h3{font-size:16.5px;font-weight:800;margin-bottom:4px}
.card .hint{font-size:13px;color:var(--muted);margin-bottom:14px}
.toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.toolbar input,.toolbar select{background:var(--input);border:1px solid var(--line2);color:var(--text);
  border-radius:9px;padding:9px 11px;font-size:13.5px;outline:none;min-width:0}
.toolbar input:focus,.toolbar select:focus{border-color:var(--lime)}
.field{margin-bottom:14px}
.field label{display:block;font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin-bottom:7px}
.field input,.field select,.field textarea{width:100%;background:var(--input);border:1px solid var(--line2);color:var(--text);
  border-radius:var(--radius-sm);padding:12px 13px;font-size:14.5px;outline:none}
.field input:focus,.field select:focus,.field textarea:focus{border-color:var(--lime);box-shadow:0 0 0 3px rgba(124,154,110,.15)}
.btn{border:1px solid var(--line2);background:var(--input);color:var(--text);border-radius:9px;
  padding:9px 14px;font-size:13.5px;font-weight:700}
.btn:hover{border-color:var(--lime)}
.btn-lime{background:var(--btn);border:none;color:#FFFFFF}
.btn-ghost{background:none}
.btn-danger{background:rgba(194,94,75,.09);border-color:rgba(194,94,75,.35);color:#A34A38}
.btn-sm{padding:6px 10px;font-size:12.5px;border-radius:8px}
.btn:disabled{opacity:.45;cursor:not-allowed}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);
  padding:9px 10px;border-bottom:1px solid var(--line)}
td{padding:10px;border-bottom:1px solid rgba(120,100,70,.22);vertical-align:middle}
tr:last-child td{border-bottom:none}
.tag{display:inline-block;font-size:11.5px;font-weight:700;border-radius:999px;padding:3px 10px}
.tag-caberawit{background:rgba(94,138,148,.14);color:#4A6E75}
.tag-pra{background:rgba(185,138,47,.14);color:#8A6D1F}
.tag-remaja{background:rgba(124,154,110,.16);color:#4F6B47}
.tag-nikah{background:rgba(194,94,75,.13);color:#A34A38}
.tag-hadir{background:rgba(124,154,110,.16);color:#4F6B47}
.tag-absen{background:rgba(194,94,75,.13);color:#A34A38}
.tag-info{background:rgba(94,138,148,.14);color:#4A6E75}
.locked-note{font-size:12.5px;color:var(--amber);margin-top:8px}
.jadwal-item{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;
  background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:10px;flex-wrap:wrap}
.jadwal-item .t{font-weight:700;font-size:14.5px}
.jadwal-item .m{font-size:12.5px;color:var(--muted);margin-top:3px}
.wa-box{background:#F7F1E3;border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:12px}
.wa-box pre{white-space:pre-wrap;font-family:var(--font);font-size:13.5px;line-height:1.6;color:#4A5D3A;margin:8px 0}
.wa-box .row{display:flex;gap:8px;flex-wrap:wrap}
.qr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px}
.qr-card{background:#fff;color:#111;border-radius:12px;padding:14px 10px;text-align:center}
.qr-card .qr-holder{display:flex;justify-content:center}
.qr-card .nm{font-weight:800;font-size:13px;margin-top:8px}
.qr-card .mt{font-size:11px;color:#555}
.modal-back{position:fixed;inset:0;background:rgba(44,38,32,.55);display:none;align-items:center;justify-content:center;padding:20px;z-index:50}
.modal-back.open{display:flex}
.modal{background:var(--card);border:1px solid var(--line2);border-radius:16px;padding:22px;width:100%;max-width:480px;max-height:90vh;overflow:auto}
.modal h3{font-size:17px;font-weight:800;margin-bottom:14px}
.modal .actions{display:flex;gap:10px;justify-content:flex-end;margin-top:18px}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.form-grid .full{grid-column:1/-1}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#2C2620;border:1px solid #8A5A33;color:#FFF8EE;border-radius:10px;padding:11px 18px;font-size:13.5px;font-weight:600;z-index:99;display:none;box-shadow:0 10px 30px rgba(0,0,0,.5)}
.empty{color:var(--muted);font-size:13.5px;padding:18px 4px;text-align:center}
@media (max-width:860px){
  .sidebar{position:fixed;z-index:40;transform:translateX(-100%);transition:transform .25s}
  .sidebar.open{transform:none}
  .main{padding:20px 16px 50px}
  .menu-btn{display:inline-flex !important}
  .form-grid{grid-template-columns:1fr}
}
.menu-btn{display:none;align-items:center;justify-content:center;width:38px;height:38px;border-radius:9px;
  background:var(--input);border:1px solid var(--line2);color:var(--text);font-size:18px}
```

## Aturan umum halaman baru
- Bahasa Indonesia natural, formal santai. Tanpa data contoh, tanpa localStorage untuk data.
- Setiap halaman: cek /api/me dulu; kalau 401 → ke /login.html. Isi nama + peran di .side-user,
  scope-badge di topbar (misal "Admin · akses penuh" / "Desa · <nama desa>" / "Kelompok · <nama kelompok>").
- Sembunyikan menu yang di luar peran: Akun hanya Admin. Menu lain tampil untuk semua peran
  (isi halaman menyesuaikan lingkup peran via API).
- Sertakan manifest + registrasi service worker seperti halaman lama (lihat login.html).
- Tanpa innerHTML untuk data pengguna (pakai textContent / createElement) — skill web-security.
- Tanpa latar gelap, tanpa gradasi, tanpa neon. Palet di atas saja.
