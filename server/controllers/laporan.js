'use strict';

const db = require('../db');
const { fail, sendJson } = require('../middleware/errors');
const { hitungLaporan, buatLaporanWord, buatLaporanExcel, buatNilaiExcel } = require('../models/laporan');
const { getMateriTugas, ambilPenilaian } = require('../models/penilaian');
const { pertemuanScopeWhere, generusScopeWhere } = require('../models/scope');

async function listArsip(res, auth) {
  res.setHeader('Cache-Control', 'no-store');

  const scopePertemuan = pertemuanScopeWhere(auth);
  const scopeGenerus = generusScopeWhere(auth);

  // Arsip memakai bulan utuh yang seluruh tanggalnya sudah lebih dari
  // satu bulan, sehingga rincian bulanan tidak mencakup data yang baru.
  // Penilaian tidak memiliki pertemuan_id; bulannya mengikuti created_at.
  const hasil = await db.query(
    `
      WITH generus_lingkup AS (
        SELECT g.id
        FROM generus g
        JOIN kelompok k ON k.id = g.kelompok_id
        WHERE ${scopeGenerus.sql}
      ),
      penilaian_bulanan AS (
        SELECT
          to_char(n.created_at, 'YYYY-MM') AS bulan,
          COUNT(*) AS jumlah
        FROM penilaian n
        JOIN generus_lingkup g ON g.id = n.generus_id
        WHERE n.created_at <
          date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
        GROUP BY to_char(n.created_at, 'YYYY-MM')
      )
      SELECT
        to_char(p.tanggal, 'YYYY-MM') AS bulan,
        COUNT(*) AS pertemuan,
        COALESCE(SUM(a.jumlah), 0) AS absensi,
        COALESCE(MAX(n.jumlah), 0) AS penilaian,
        COALESCE(SUM(i.jumlah), 0) AS izin
      FROM pertemuan p
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS jumlah
        FROM absensi a
        JOIN generus_lingkup g ON g.id = a.generus_id
        WHERE a.pertemuan_id = p.id
      ) a ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS jumlah
        FROM izin i
        JOIN generus_lingkup g ON g.id = i.generus_id
        WHERE i.pertemuan_id = p.id
      ) i ON TRUE
      LEFT JOIN penilaian_bulanan n
        ON n.bulan = to_char(p.tanggal, 'YYYY-MM')
      WHERE p.selesai_pada IS NOT NULL
        AND ${scopePertemuan.sql}
        AND p.tanggal <
          date_trunc('month', CURRENT_DATE - INTERVAL '1 month')::date
      GROUP BY to_char(p.tanggal, 'YYYY-MM')
      ORDER BY bulan DESC
    `,
    scopePertemuan.values,
  );

  const formatter = new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  sendJson(res, 200, {
    arsip: hasil.rows.map((row) => ({
      bulan: row.bulan,
      label: formatter.format(new Date(`${row.bulan}-01T00:00:00Z`)),
      pertemuan: Number(row.pertemuan),
      absensi: Number(row.absensi),
      penilaian: Number(row.penilaian),
      izin: Number(row.izin),
    })),
  });
}

async function detailArsip(req, res, auth, url) {
  res.setHeader('Cache-Control', 'no-store');

  const bulan = url.searchParams.get('bulan');

  if (
    typeof bulan !== 'string' ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(bulan) ||
    bulan.startsWith('0000-')
  ) {
    fail(400, 'Bulan wajib diisi dengan format YYYY-MM yang valid.');
  }

  const awal = `${bulan}-01`;
  const tanggalAkhir = new Date(`${awal}T00:00:00Z`);
  tanggalAkhir.setUTCMonth(tanggalAkhir.getUTCMonth() + 1, 0);
  const akhir = tanggalAkhir.toISOString().slice(0, 10);

  const scope = pertemuanScopeWhere(auth);
  const hasil = await db.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pertemuan p
        WHERE p.selesai_pada IS NOT NULL
          AND ${scope.sql}
          AND p.tanggal BETWEEN $4::date AND $5::date
          AND p.tanggal <
            date_trunc('month', CURRENT_DATE - INTERVAL '1 month')::date
      ) AS tersedia
    `,
    [...scope.values, awal, akhir],
  );

  if (!hasil.rows[0]?.tersedia) {
    fail(404, 'Arsip bulan ini belum tersedia dalam lingkupmu.');
  }

  const laporan = await hitungLaporan(auth, awal, akhir, true);
  const label = new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(tanggalAkhir);

  sendJson(res, 200, { ...laporan, bulan, label });
}







// getMateriTugas — diubah Sesi 13A: filter kelas_id/tahun_ajaran/kategori + kelas_nama.




// createTugas — diubah Sesi 13A: terima kelas_id + tahun_ajaran.

async function unduhLaporan(req, res, auth, url) {
  const pathname = url.pathname;
  if (
    req.method === 'GET' &&
    (pathname === '/api/laporan' || pathname === '/api/laporan.docx' || pathname === '/api/laporan.xlsx')
  ) {
    const dari = url.searchParams.get('dari');
    const sampai = url.searchParams.get('sampai');
    const rincian = url.searchParams.get('rincian') ?? '0';

    if (rincian !== '0' && rincian !== '1') {
      fail(400, 'Parameter rincian harus 0 atau 1.');
    }

    const laporan = await hitungLaporan(auth, dari, sampai, rincian === '1');

    if (pathname === '/api/laporan') {
      sendJson(res, 200, laporan);
      return;
    }

    if (pathname === '/api/laporan.xlsx') {
      const buffer = await buatLaporanExcel(laporan);

      res.writeHead(200, {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition':
          `attachment; filename="laporan-kehadiran-${dari}_sd_${sampai}.xlsx"`,
        'Content-Length': buffer.length,
        'Cache-Control': 'no-store',
      });
      res.end(buffer);
      return;
    }

    const buffer = await buatLaporanWord(laporan);

    res.writeHead(200, {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition':
        `attachment; filename="laporan-kehadiran-${dari}_sd_${sampai}.docx"`,
      'Content-Length': buffer.length,
      'Cache-Control': 'no-store',
    });
    res.end(buffer);
    return;
  }
}

async function unduhNilai(req, res, auth, url) {
  const data = await ambilPenilaian(req, auth);
  const buffer = await buatNilaiExcel(data);
  res.writeHead(200, {
    'Content-Type':
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="rekap-nilai.xlsx"',
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
  });
  res.end(buffer);
  return;
}

module.exports = {
  listArsip, detailArsip, unduhLaporan, unduhNilai,
};
