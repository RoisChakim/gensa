'use strict';

const db = require('../db');
const { fail } = require('../middleware/errors');
const { generusScopeWhere, pertemuanScopeWhere } = require('./scope');
const { validPertemuanDate } = require('../middleware/validate');

async function hitungLaporan(auth, dari, sampai, rincian) {
  if (
    typeof dari !== 'string' ||
    typeof sampai !== 'string'
  ) {
    fail(400, 'Tanggal awal dan tanggal akhir wajib diisi dengan format YYYY-MM-DD yang valid.');
  }

  validPertemuanDate(dari);
  validPertemuanDate(sampai);

  if (dari > sampai) {
    fail(400, 'Tanggal awal tidak boleh setelah tanggal akhir.');
  }

  const jumlahHari =
    (Date.parse(`${sampai}T00:00:00Z`) -
      Date.parse(`${dari}T00:00:00Z`)) / 86400000 + 1;

  if (jumlahHari > 62) {
    fail(400, 'Rentang laporan maksimal 62 hari.');
  }

  const scope = generusScopeWhere(auth);
  const scopePertemuan = pertemuanScopeWhere(auth);
  const values = [...scope.values, dari, sampai];

  // Kedua helper scope memakai parameter yang sama:
  // $1 = role, $2 = desa_id, $3 = kelompok_id.
  const [hasilGenerus, hasilKelompok, hasilWilayah] = await Promise.all([
    db.query(
      `
        SELECT
          g.id,
          g.nama,
          g.kelompok_id,
          k.nama AS kelompok,
          d.nama AS desa,
          g.kelas_sekolah,
          g.jenjang,
          COUNT(p.id) AS wajib,
          COUNT(p.id) FILTER (WHERE a.status = 'hadir') AS hadir,
          COUNT(p.id) FILTER (WHERE a.status IN ('izin', 'sakit')) AS izin,
          COUNT(p.id) FILTER (WHERE a.status = 'alfa') AS alfa
        FROM generus g
        JOIN kelompok k ON k.id = g.kelompok_id
        JOIN desa d ON d.id = k.desa_id
        LEFT JOIN absensi a ON a.generus_id = g.id
        LEFT JOIN pertemuan p
          ON p.id = a.pertemuan_id
          AND p.selesai_pada IS NOT NULL
          AND p.tanggal BETWEEN $4::date AND $5::date
          AND ${scopePertemuan.sql}
          AND g.jenjang = ANY(p.jenjang_target)
          AND p.tanggal >= DATE(g.decided_at)
        WHERE g.status = 'approved'
          AND ${scope.sql}
        GROUP BY
          g.id, g.nama, g.kelompok_id, k.nama, d.nama,
          g.kelas_sekolah, g.jenjang
        ORDER BY k.nama, g.jenjang, g.nama, g.id
      `,
      values,
    ),
    db.query(
      `
        SELECT
          k.id,
          k.nama AS kelompok,
          d.nama AS desa,
          COUNT(p.id) AS pertemuan
        FROM kelompok k
        JOIN desa d ON d.id = k.desa_id
        LEFT JOIN pertemuan p
          ON p.selesai_pada IS NOT NULL
          AND p.tanggal BETWEEN $4::date AND $5::date
          AND (
            (p.tingkat = 'kelompok' AND p.kelompok_id = k.id)
            OR (p.tingkat = 'desa' AND p.desa_id = k.desa_id)
            OR p.tingkat = 'daerah'
          )
        WHERE
          $1::text IN ('admin', 'daerah')
          OR ($1::text = 'desa' AND k.desa_id = $2::integer)
          OR ($1::text = 'kelompok' AND k.id = $3::integer)
        GROUP BY k.id, k.nama, d.nama
        ORDER BY d.nama, k.nama, k.id
      `,
      values,
    ),
    db.query(
      `
        SELECT CASE
          WHEN $1::text = 'kelompok'
            THEN (SELECT nama FROM kelompok WHERE id = $3::integer)
          WHEN $1::text = 'desa'
            THEN (SELECT nama FROM desa WHERE id = $2::integer)
          ELSE 'Seluruh Daerah'
        END AS wilayah
      `,
      scope.values,
    ),
  ]);

  const kelompokTotal = new Map();

  const barisGenerus = hasilGenerus.rows.map((row) => {
    const hadir = Number(row.hadir);
    const izin = Number(row.izin);
    const alfa = Number(row.alfa);
    const wajib = Number(row.wajib);
    const persen = wajib > 0
      ? Math.round(hadir / wajib * 1000) / 10
      : null;

    const key = String(row.kelompok_id);
    let total = kelompokTotal.get(key);

    if (!total) {
      total = { generus: 0, jumlahPersen: 0, jumlahWajib: 0 };
      kelompokTotal.set(key, total);
    }

    total.generus += 1;

    if (persen !== null) {
      total.jumlahPersen += persen;
      total.jumlahWajib += 1;
    }

    return {
      id: row.id,
      nama: row.nama,
      kelompok: row.kelompok,
      desa: row.desa,
      kelas_sekolah: row.kelas_sekolah,
      jenjang: row.jenjang,
      hadir,
      izin,
      alfa,
      wajib,
      persen,
    };
  });

  const rekap = hasilKelompok.rows.map((row) => {
    const total = kelompokTotal.get(String(row.id));

    return {
      kelompok: row.kelompok,
      desa: row.desa,
      generus: total ? total.generus : 0,
      pertemuan: Number(row.pertemuan),
      rata_persen: total && total.jumlahWajib > 0
        ? Math.round(total.jumlahPersen / total.jumlahWajib * 10) / 10
        : null,
    };
  });

  const laporan = {
    periode: { dari, sampai },
    wilayah: hasilWilayah.rows[0]?.wilayah || auth.user.role,
    rekap,
  };

  if (rincian) {
    laporan.rincian = barisGenerus;
  }

  return laporan;
}

async function buatLaporanWord(laporan) {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    HeadingLevel,
    AlignmentType,
    WidthType,
  } = require('docx');

  const labelJenjang = {
    caberawit: 'Caberawit',
    pra_remaja: 'Pra Remaja',
    remaja: 'Remaja',
    usia_nikah: 'Usia Nikah',
  };

  function tanggal(value) {
    const [tahun, bulan, hari] = value.split('-');
    return `${hari}/${bulan}/${tahun}`;
  }

  function persen(value) {
    return value === null
      ? '-'
      : value.toLocaleString('id-ID', {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        });
  }

  function sel(value, header) {
    return new TableCell({
      ...(header ? { shading: { fill: 'F6F1E9' } } : {}),
      children: [
        new Paragraph({
          children: [
            new TextRun({
              text: value == null ? '-' : String(value),
              bold: header,
              size: 18,
              ...(header ? { color: '8A5A33' } : {}),
            }),
          ],
        }),
      ],
    });
  }

  function tabel(headers, rows) {
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: headers.map((value) => sel(value, true)),
        }),
        ...rows.map((row) => new TableRow({
          children: row.map((value) => sel(value, false)),
        })),
      ],
    });
  }

  const sekarang = new Date();
  const dibuat = [
    String(sekarang.getDate()).padStart(2, '0'),
    String(sekarang.getMonth() + 1).padStart(2, '0'),
    sekarang.getFullYear(),
  ].join('/');

  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'Laporan Kehadiran Generus',
          bold: true,
          color: '8A5A33',
        }),
      ],
    }),
    new Paragraph({ text: `Tanggal: ${dibuat}` }),
    new Paragraph({
      text: `Periode: ${tanggal(laporan.periode.dari)} – ${tanggal(laporan.periode.sampai)}`,
    }),
    new Paragraph({
      text: 'Laporan ini berisi rekap kehadiran generus selama periode di atas. Kolom % Hadir dihitung dari jumlah hadir dibagi jumlah pertemuan wajib.',
    }),
    tabel(
      ['Kelompok', 'Desa', 'Generus', 'Pertemuan', 'Rata-rata % Hadir'],
      laporan.rekap.map((row) => [
        row.kelompok,
        row.desa,
        row.generus,
        row.pertemuan,
        persen(row.rata_persen),
      ]),
    ),
  ];

  if (laporan.rincian) {
    children.push(
      tabel(
        [
          'Nama', 'Kelompok', 'Kelas', 'Jenjang',
          'Hadir', 'Izin', 'Alfa', 'Wajib', '% Hadir',
        ],
        laporan.rincian.map((row) => [
          row.nama,
          row.kelompok,
          row.kelas_sekolah,
          labelJenjang[row.jenjang] || row.jenjang,
          row.hadir,
          row.izin,
          row.alfa,
          row.wajib,
          persen(row.persen),
        ]),
      ),
    );
  }

  const document = new Document({
    sections: [{ children }],
  });

  return Packer.toBuffer(document);
}

async function buatLaporanExcel(laporan) {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();

  function tanggal(value) {
    const [tahun, bulan, hari] = value.split('-');
    return `${hari}/${bulan}/${tahun}`;
  }

  const labelJenjang = {
    caberawit: 'Caberawit',
    pra_remaja: 'Pra Remaja',
    remaja: 'Remaja',
    usia_nikah: 'Usia Nikah',
  };

  const rekap = workbook.addWorksheet('Rekap');
  rekap.columns = [
    { width: 28 },
    { width: 24 },
    { width: 12 },
    { width: 14 },
    { width: 24 },
  ];
  rekap.addRow(['Laporan Kehadiran Generus']).font = { bold: true };
  rekap.addRow([
    `Periode: ${tanggal(laporan.periode.dari)} – ${tanggal(laporan.periode.sampai)}`,
  ]);
  rekap.addRow([]);
  rekap.addRow([
    'Kelompok',
    'Desa',
    'Generus',
    'Pertemuan',
    'Rata-rata % Hadir',
  ]).font = { bold: true };

  for (const row of laporan.rekap) {
    rekap.addRow([
      row.kelompok,
      row.desa,
      row.generus,
      row.pertemuan,
      row.rata_persen ?? '-',
    ]);
  }

  if (laporan.rincian) {
    const rincian = workbook.addWorksheet('Rincian');
    rincian.columns = [
      { width: 32 },
      { width: 28 },
      { width: 18 },
      { width: 18 },
      { width: 10 },
      { width: 10 },
      { width: 10 },
      { width: 10 },
      { width: 14 },
    ];
    rincian.addRow([
      'Nama',
      'Kelompok',
      'Kelas',
      'Jenjang',
      'Hadir',
      'Izin',
      'Alfa',
      'Wajib',
      '% Hadir',
    ]).font = { bold: true };

    for (const row of laporan.rincian) {
      rincian.addRow([
        row.nama,
        row.kelompok,
        row.kelas_sekolah,
        labelJenjang[row.jenjang] ?? row.jenjang ?? '-',
        row.hadir,
        row.izin,
        row.alfa,
        row.wajib,
        row.persen ?? '-',
      ]);
    }
  }

  return workbook.xlsx.writeBuffer();
}

async function buatNilaiExcel(data) {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  const labelJenjang = {
    caberawit: 'Caberawit',
    pra_remaja: 'Pra Remaja',
    remaja: 'Remaja',
    usia_nikah: 'Usia Nikah',
  };

  const hasil = workbook.addWorksheet('Hasil');
  hasil.columns = [
    { width: 32 },
    { width: 28 },
    { width: 18 },
    { width: 18 },
    { width: 10 },
    { width: 10 },
    { width: 14 },
  ];
  hasil.addRow([
    'Nama',
    'Kelompok',
    'Kelas',
    'Jenjang',
    'Hafal',
    'Total',
    '% Hasil',
  ]).font = { bold: true };

  for (const row of data.hasil) {
    hasil.addRow([
      row.nama,
      row.kelompok,
      row.kelas_sekolah,
      labelJenjang[row.jenjang] ?? row.jenjang ?? '-',
      row.hafal,
      row.total_hafalan,
      row.persen ?? '-',
    ]);
  }

  const namaGenerus = new Map(
    data.hasil.map((row) => [String(row.generus_id), row.nama])
  );
  const tugasById = new Map(
    data.tugas.map((row) => [String(row.id), row])
  );

  const penilaian = workbook.addWorksheet('Penilaian');
  penilaian.columns = [
    { width: 32 },
    { width: 36 },
    { width: 22 },
    { width: 14 },
  ];
  penilaian.addRow([
    'Nama Generus',
    'Tugas',
    'Kategori',
    'Nilai',
  ]).font = { bold: true };

  for (const row of data.penilaian) {
    const tugas = tugasById.get(String(row.tugas_id));
    penilaian.addRow([
      namaGenerus.get(String(row.generus_id)) ?? '-',
      tugas?.judul ?? '-',
      tugas?.kategori ?? '-',
      row.nilai,
    ]);
  }

  return workbook.xlsx.writeBuffer();
}

module.exports = {
  hitungLaporan, buatLaporanWord, buatLaporanExcel, buatNilaiExcel,
};
