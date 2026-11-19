// Tashqi kutubxonasiz (node:zlib asosida) standart Word (.docx / OOXML) generatori
const zlib = require('node:zlib');
const { fmtDate } = require('../../../lib/time');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Fayllar massividan haqiqiy ZIP arxiv Buffer yaratadi ({ name, data })
 */
function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const compressed = zlib.deflateRawSync(raw);
    const crc = crc32(raw);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8
    local.writeUInt16LE(8, 8);      // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    localParts.push(local, compressed);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    centralParts.push(central);
    offset += local.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

function escXml(val) {
  return String(val ?? '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '') // eslint-disable-line no-control-regex
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function p(text, { bold = false, center = false, size = 22, after = 100, italic = false } = {}) {
  const align = center ? '<w:jc w:val="center"/>' : '';
  const rPr = [
    '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>',
    `<w:sz w:val="${size}"/>`,
    `<w:szCs w:val="${size}"/>`,
    bold ? '<w:b/>' : '',
    italic ? '<w:i/>' : '',
  ].join('');
  const lines = String(text ?? '').split(/\r?\n/);
  const runs = lines.map((line, idx) =>
    `${idx > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${escXml(line)}</w:t>`,
  ).join('');
  return `<w:p><w:pPr>${align}<w:spacing w:after="${after}"/></w:pPr><w:r><w:rPr>${rPr}</w:rPr>${runs}</w:r></w:p>`;
}

function table(headers, rows, widths = null) {
  const borders = [
    '<w:top w:val="single" w:sz="6" w:space="0" w:color="334155"/>',
    '<w:left w:val="single" w:sz="6" w:space="0" w:color="334155"/>',
    '<w:bottom w:val="single" w:sz="6" w:space="0" w:color="334155"/>',
    '<w:right w:val="single" w:sz="6" w:space="0" w:color="334155"/>',
    '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="64748b"/>',
    '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="64748b"/>',
  ].join('');

  const cell = (text, idx, isHeader) => {
    const wXml = widths && widths[idx] ? `<w:tcW w:w="${widths[idx]}" w:type="dxa"/>` : '';
    const shd = isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="E7EFFB"/>' : '';
    return `<w:tc><w:tcPr>${wXml}${shd}<w:tcMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr>${p(text, { bold: isHeader, size: 20, after: 40 })}</w:tc>`;
  };

  const trHead = headers
    ? `<w:tr><w:trPr><w:tblHeader/></w:trPr>${headers.map((h, i) => cell(h, i, true)).join('')}</w:tr>`
    : '';
  const trRows = rows
    .map((r) => `<w:tr>${r.map((c, i) => cell(c, i, false)).join('')}</w:tr>`)
    .join('');

  return `<w:tbl><w:tblPr><w:tblW w:w="9600" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr>${trHead}${trRows}</w:tbl>`;
}

function wrapDocx(bodyXml, landscape = false) {
  const pgSz = landscape
    ? '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>'
    : '<w:pgSz w:w="11906" w:h="16838"/>';
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyXml}
    <w:sectPr>
      ${pgSz}
      <w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="1134" w:header="400" w:footer="400" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  return buildZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'word/document.xml', data: docXml },
  ]);
}

const HOLAT_UZ = {
  kutilmoqda: 'Kutilmoqda',
  tasdiqlandi: 'Tasdiqlandi',
  qaytarildi: 'Qaytarildi',
  topshirildi: 'Topshirildi',
  qoralama: 'Qoralama',
};

function fullName(u) {
  return u ? [u.familiya, u.ism, u.ochestva].filter(Boolean).join(' ') : '—';
}

function buildInfoTable(b) {
  return table(null, [
    ['Amaliyot turi', b.tur_nomi || '—'],
    ['Talaba F.I.Sh.', b.student_fio || '—'],
    ['Guruh / Kurs / Fakultet', `${b.guruh || '—'} / ${b.kurs ? `${b.kurs}-kurs` : '—'} / ${b.fakultet_nomi || '—'}`],
    ['Amaliyot muddati', `${fmtDate(b.boshlanish_sana)} — ${fmtDate(b.tugash_sana)}`],
    ['Amaliyot mavzusi', b.mavzu || '____________________________________________'],
    ['Korxona nomi', b.korxona_nomi || '—'],
    ['Korxona manzili va STIR', `${b.korxona_manzil || '—'} (STIR: ${b.korxona_stir || '—'})`],
    ['Korxona rahbari / tel', `${b.korxona_rahbar || '—'} / ${b.korxona_telefon || '—'}`],
    ['Korxona mentori', b.mentor_fio ? `${b.mentor_fio} (${b.mentor_lavozim || 'Mentor'}, ${b.mentor_email || ''})` : 'Biriktirilmagan'],
    ['Universitet ustozi', b.ustoz_fio || '—'],
  ], [3200, 6400]);
}

function buildBolimlarXml(bolimlar, javoblar = {}) {
  if (!Array.isArray(bolimlar) || !bolimlar.length) return '';
  const rows = bolimlar.map((sec, idx) => {
    const val = javoblar?.[sec.key]?.trim();
    return [
      `${idx + 1}. ${sec.title}`,
      val || `${sec.hint ? `[${sec.hint}]\n` : ''}________________________________________________________\n________________________________________________________`,
    ];
  });
  return [
    p('1-BO\'LIM. STANDART TO\'LDIRILADIGAN BO\'LIMLAR', { bold: true, size: 24, after: 80 }),
    table(['Bo\'lim nomi', 'Mazmuni (talaba tomonidan to\'ldiriladi)'], rows, [3200, 6400]),
    p('', { after: 80 }),
  ].join('');
}

/**
 * Standart Amaliyot kundaligi (.docx)
 */
function buildKundalikDocx({ biriktirish: b, kundaliklar = [], xulosa = null }) {
  const bolimlar = Array.isArray(b.bolimlar_json) ? b.bolimlar_json : [];
  const javoblar = xulosa?.bolimlar_javobi || {};

  const rows = kundaliklar.map((k, idx) => {
    const ustozSt = `${HOLAT_UZ[k.ustoz_holat] || k.ustoz_holat}${k.ustoz_izoh ? `\nIzoh: ${k.ustoz_izoh}` : ''}`;
    const mentorSt = `${HOLAT_UZ[k.mentor_holat] || k.mentor_holat}${k.mentor_fikr ? `\nFikr: ${k.mentor_fikr}` : ''}`;
    return [
      String(idx + 1),
      fmtDate(k.sana),
      k.ish_mazmuni || '',
      String(k.soat ?? ''),
      k.natija || '—',
      ustozSt,
      mentorSt,
    ];
  });

  // Yuklab olinganda Word'da ham qo'shimcha kunlarni to'ldirib borish uchun standart bo'sh qatorlar
  const minRows = Math.max(14, rows.length + 3);
  for (let i = rows.length; i < minRows; i++) {
    rows.push([String(i + 1), '__.__.202_', '', '___', '', '__________', '__________']);
  }

  const body = [
    p('O\'ZBEKISTON RESPUBLIKASI OLIY TA\'LIM, FAN VA INNOVATSIYALAR VAZIRLIGI', { bold: true, center: true, size: 22, after: 40 }),
    p('TALABANING STANDART AMALIYOT KUNDALIGI', { bold: true, center: true, size: 28, after: 140 }),
    buildInfoTable(b),
    p('', { after: 100 }),
    buildBolimlarXml(bolimlar, javoblar),
    p('2-BO\'LIM. HAR KUNLIK BAJARILGAN ISHLAR QAYDNOMASI', { bold: true, size: 24, after: 80 }),
    table(
      ['№', 'Sana', 'Bajarilgan ishlar mazmuni', 'Soat', 'Natija / ko\'nikma', 'Ustoz tasdig\'i', 'Mentor tasdig\'i va fikri'],
      rows,
      [500, 1100, 3000, 650, 1650, 1350, 1350],
    ),
    p('', { after: 140 }),
    p('3-BO\'LIM. IMZOLAR VA TASDIQ', { bold: true, size: 24, after: 80 }),
    table(null, [
      ['Talaba', b.student_fio || '—', 'Imzo: ______________   Sana: __.__.202_'],
      ['Korxona mentori', b.mentor_fio || '________________', 'Imzo / Muhr: ______________   Sana: __.__.202_'],
      ['Biriktirilgan ustoz', b.ustoz_fio || '—', 'Imzo: ______________   Sana: __.__.202_'],
    ], [2400, 3400, 3800]),
  ].join('');

  return wrapDocx(body);
}

/**
 * Standart Xulosalar kitobchasi (.docx)
 */
function buildXulosaDocx({ biriktirish: b, xulosa = null }) {
  const bolimlar = Array.isArray(b.bolimlar_json) ? b.bolimlar_json : [];
  const x = xulosa || {};
  const blank = '________________________________________________________\n________________________________________________________\n________________________________________________________';

  const body = [
    p('O\'ZBEKISTON RESPUBLIKASI OLIY TA\'LIM, FAN VA INNOVATSIYALAR VAZIRLIGI', { bold: true, center: true, size: 22, after: 40 }),
    p('TALABANING AMALIYOT BO\'YICHA XULOSALAR KITOBCHASI', { bold: true, center: true, size: 28, after: 140 }),
    buildInfoTable(b),
    p('', { after: 100 }),
    buildBolimlarXml(bolimlar, x.bolimlar_javobi || {}),
    p('2-BO\'LIM. YAKUNIY XULOSALAR VA TAKLIFLAR', { bold: true, size: 24, after: 80 }),
    table(['Xulosa bo\'limi', 'Talaba tomonidan to\'ldirilgan mazmun'], [
      ['1. Bajarilgan ishlarning umumiy xulosasi', x.bajarilgan_ishlar_xulosasi || blank],
      ['2. O\'zlashtirilgan amaliy ko\'nikmalar', x.ozlashtirilgan_konikmalar || blank],
      ['3. Aniqlangan muammolar va takliflar', x.muammo_va_takliflar || blank],
      ['4. Yakuniy xulosa', x.yakuniy_xulosa || blank],
    ], [3200, 6400]),
    p('', { after: 100 }),
    p('3-BO\'LIM. MENTOR VA USTOZ XULOSASI HAMDA BAHOLASH', { bold: true, size: 24, after: 80 }),
    table(null, [
      ['Korxona mentori holati', HOLAT_UZ[x.mentor_holat] || 'Kutilmoqda'],
      ['Korxona mentori fikri (ixtiyoriy)', x.mentor_fikr || '____________________________________________'],
      ['Ustoz tasdig\'i', HOLAT_UZ[x.ustoz_holat] || 'Kutilmoqda'],
      ['Ustoz izohi', x.ustoz_izoh || '____________________________________________'],
      ['Yakuniy baho (ball)', x.ustoz_baho !== null && x.ustoz_baho !== undefined ? `${x.ustoz_baho} / 100` : '______ / 100'],
    ], [3200, 6400]),
    p('', { after: 140 }),
    table(null, [
      ['Talaba', b.student_fio || '—', 'Imzo: ______________'],
      ['Korxona mentori', b.mentor_fio || '________________', 'Imzo / Muhr: ______________'],
      ['Biriktirilgan ustoz', b.ustoz_fio || '—', 'Imzo: ______________'],
    ], [2400, 3800, 3400]),
  ].join('');

  return wrapDocx(body);
}

module.exports = { buildZip, buildKundalikDocx, buildXulosaDocx, fullName };
