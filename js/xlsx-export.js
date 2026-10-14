/*
 * xlsx-export.js
 * 入力内容と計算結果を .xlsx（Excelファイル）として書き出す。
 * 外部ライブラリには依存せず、最小限のOOXML＋無圧縮ZIPをその場で組み立てる。
 * 月次PLの合計・小計・営業損益などはExcelの数式（再計算可能）で出力する。
 */

/* ---------------- 低レベル：ZIP（無圧縮）---------------- */
const XLSX_CRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function xlsxCrc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = XLSX_CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function xlsxZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  files.forEach(f => {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = xlsxCrc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true); lv.setUint16(10, 0, true); lv.setUint16(12, 0x21, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
    local.set(name, 30);
    parts.push(local, data);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
    cen.set(name, 46);
    central.push(cen);
    offset += local.length + data.length;
  });
  const cenSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cenSize, true); ev.setUint32(16, offset, true);
  const all = parts.concat(central, [end]);
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let pos = 0;
  all.forEach(p => { out.set(p, pos); pos += p.length; });
  return out;
}

/* ---------------- スタイル・シート ---------------- */
function xlsxEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}
function xlsxCol(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const XLSX_FMT = { int: 164, pct: 165, dec: 166 };

function XlsxStyles() {
  this.fonts = []; this.fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>'
  ];
  this.xfs = []; this.map = { font: {}, fill: {}, xf: {} };
  this.fontId({}); this.xfId({});
}
XlsxStyles.prototype.fontId = function (p) {
  const key = JSON.stringify([!!p.bold, p.color || '', p.size || 11]);
  if (this.map.font[key] === undefined) {
    this.fonts.push(`<font>${p.bold ? '<b/>' : ''}<sz val="${p.size || 11}"/><color rgb="FF${p.color || '000000'}"/><name val="Yu Gothic"/><family val="2"/></font>`);
    this.map.font[key] = this.fonts.length - 1;
  }
  return this.map.font[key];
};
XlsxStyles.prototype.fillId = function (c) {
  if (!c) return 0;
  if (this.map.fill[c] === undefined) {
    this.fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="FF${c}"/><bgColor indexed="64"/></patternFill></fill>`);
    this.map.fill[c] = this.fills.length - 1;
  }
  return this.map.fill[c];
};
XlsxStyles.prototype.xfId = function (p) {
  const key = JSON.stringify([!!p.bold, p.color || '', p.size || 11, p.fill || '', p.fmt || '', p.h || '', !!p.border, !!p.wrap]);
  if (this.map.xf[key] === undefined) {
    const fmt = XLSX_FMT[p.fmt] || 0;
    this.xfs.push(`<xf numFmtId="${fmt}" fontId="${this.fontId(p)}" fillId="${this.fillId(p.fill)}" borderId="${p.border ? 1 : 0}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment${p.h ? ` horizontal="${p.h}"` : ''} vertical="center"${p.wrap ? ' wrapText="1"' : ''}/></xf>`);
    this.map.xf[key] = this.xfs.length - 1;
  }
  return this.map.xf[key];
};
XlsxStyles.prototype.xml = function () {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0;[Red]△#,##0"/><numFmt numFmtId="165" formatCode="0.0%"/><numFmt numFmtId="166" formatCode="#,##0.0;[Red]△#,##0.0"/></numFmts>
<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts>
<fills count="${this.fills.length}">${this.fills.join('')}</fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD0D5DD"/></left><right style="thin"><color rgb="FFD0D5DD"/></right><top style="thin"><color rgb="FFD0D5DD"/></top><bottom style="thin"><color rgb="FFD0D5DD"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
};

function XlsxSheet(name, styles) {
  this.name = name; this.styles = styles; this.rows = {}; this.widths = {}; this.freeze = null; this.maxR = 1; this.maxC = 1;
}
// v: 文字列 / 数値 / null、f: Excel数式（先頭の=は付けない）。数式セルのvはキャッシュ値。
XlsxSheet.prototype.set = function (r, c, v, style, f) {
  this.rows[r] = this.rows[r] || {};
  // 円単位の整数書式のセルは浮動小数点のノイズ（105000.00000000001など）を丸めて書き出す
  if (typeof v === 'number' && style && style.fmt === 'int') v = Math.round(v);
  this.rows[r][c] = { v: v, f: f, s: this.styles.xfId(style || {}) };
  if (r > this.maxR) this.maxR = r;
  if (c > this.maxC) this.maxC = c;
};
XlsxSheet.prototype.xml = function () {
  const rowsXml = Object.keys(this.rows).map(Number).sort((a, b) => a - b).map(r => {
    const cells = Object.keys(this.rows[r]).map(Number).sort((a, b) => a - b).map(c => {
      const cell = this.rows[r][c];
      const ref = xlsxCol(c) + r;
      const isNum = typeof cell.v === 'number';
      const num = isNum ? (isFinite(cell.v) ? cell.v : 0) : null;
      if (cell.f) return `<c r="${ref}" s="${cell.s}"><f>${xlsxEsc(cell.f)}</f><v>${num === null ? 0 : num}</v></c>`;
      if (isNum) return `<c r="${ref}" s="${cell.s}"><v>${num}</v></c>`;
      if (cell.v === null || cell.v === undefined || cell.v === '') return `<c r="${ref}" s="${cell.s}"/>`;
      return `<c r="${ref}" s="${cell.s}" t="inlineStr"><is><t xml:space="preserve">${xlsxEsc(cell.v)}</t></is></c>`;
    }).join('');
    return `<row r="${r}">${cells}</row>`;
  }).join('');
  const cols = Object.keys(this.widths).map(Number).sort((a, b) => a - b)
    .map(c => `<col min="${c}" max="${c}" width="${this.widths[c]}" customWidth="1"/>`).join('');
  const pane = this.freeze
    ? `<pane xSplit="${this.freeze.c - 1}" ySplit="${this.freeze.r - 1}" topLeftCell="${xlsxCol(this.freeze.c)}${this.freeze.r}" activePane="bottomRight" state="frozen"/>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${xlsxCol(this.maxC)}${this.maxR}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rowsXml}</sheetData><pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
};

/* ---------------- 共通スタイル ---------------- */
const XL = {
  teal: '05968C', ink: '161B26', soft: '5B6472',
  head: { bold: true, color: 'FFFFFF', fill: '05968C', border: true, h: 'center' },
  headL: { bold: true, color: 'FFFFFF', fill: '05968C', border: true },
  title: { bold: true, size: 16, color: '04756D' },
  section: { bold: true, color: 'FFFFFF', fill: '04756D' },
  label: { border: true },
  labelB: { border: true, bold: true, fill: 'EEF1F7' },
  note: { color: '5B6472', size: 10 }
};
// 月次PLの主要5行（画面の色分けと同じ配色）。total＝右端「合計」列は濃いめ。
const XL_PL_COLORS = {
  totalRevenue: { bg: 'DBE9FB', fg: '163F74', tbg: 'A9CEF3', tfg: '0C2C52' },
  gross: { bg: 'DCF3E6', fg: '146443', tbg: 'A8E4C4', tfg: '0B4530' },
  operating: { bg: 'D7F0F2', fg: '0C4F57', tbg: '9FD9DF', tfg: '073338' },
  ordinary: { bg: 'E8DDF7', fg: '4A2F82', tbg: 'C7ABED', tfg: '33205C' },
  net: { bg: 'F6DCD6', fg: '8A3320', tbg: 'E8A794', tfg: '632012' }
};

/* ---------------- 月次PLシート ---------------- */
const XL_PL_LINES = [
  ['salary', '従業員給料'], ['legalWelfare', '法定福利費'], ['recruiting', '採用教育費'],
  ['adSpend', '広告宣伝費'], ['entertainment', '接待交際費'], ['travel', '旅費交通費'],
  ['communication', '通信費'], ['consumables', '消耗品費'], ['officeSupplies', '事務用品費'],
  ['equipment', '備品費'], ['utilities', '水道光熱費'], ['dues', '諸会費'], ['lease', 'リース料'],
  ['insurance', '保険料'], ['depreciation', '減価償却費'], ['tax', '租税公課'], ['misc', '雑費'],
  ['storeRunning', '店舗経費（ランニング）']
];

// opening: 前年シートの総資産期末セル参照（例 "'月次PL_1年目'!M40"）。1年目はnull。
function xlsxMonthlyPL(book, name, title, pl, sy, opening) {
  const sh = book.addSheet(name);
  sh.widths[1] = 26;
  for (let c = 2; c <= 14; c++) sh.widths[c] = 13;
  sh.set(1, 1, title, XL.title);
  sh.set(2, 1, '単位：円（マイナスは赤字の△表示）。合計・小計・営業損益などはExcelの数式です。', XL.note);
  sh.set(3, 1, '科目', XL.headL);
  pl.months.forEach((m, i) => sh.set(3, 2 + i, m, XL.head));
  sh.set(3, 14, '合計', XL.head);
  sh.freeze = { r: 4, c: 2 };

  const trainingCombined = pl.lines.training.map((v, i) => v + pl.lines.consulting[i]);
  const items = [];
  items.push({ k: 'contracts', label: '仲介契約件数', vals: pl.contracts, kind: 'count' });
  items.push({ k: 'brokerage', label: '仲介手数料', vals: pl.brokerageRevenue, lab: '04756D' });
  const revKeys = ['brokerage'];
  if (sy.reform.enabled) { items.push({ k: 'reform', label: 'リフォーム', vals: pl.reformRevenue, lab: 'C97E00' }); revKeys.push('reform'); }
  if (sy.selfBuild.enabled) { items.push({ k: 'selfBuild', label: '自社請負', vals: pl.selfBuildRevenue, lab: 'C97E00' }); revKeys.push('selfBuild'); }
  if (sy.referral.enabled) { items.push({ k: 'referral', label: '他社紹介', vals: pl.referralRevenue, lab: '2563EB' }); revKeys.push('referral'); }
  items.push({ k: 'totalRevenue', label: '売上高 合計', vals: pl.totalRevenue, kind: 'f', color: 'totalRevenue' });
  items.push({ k: 'cogs', label: '売上原価', vals: pl.totalCogs });
  items.push({ k: 'gross', label: '売上総利益', vals: pl.grossProfit, kind: 'f', color: 'gross' });
  XL_PL_LINES.forEach(([key, label]) => items.push({ k: 'sga_' + key, label, vals: pl.lines[key] }));
  items.push({ k: 'sga_training', label: '研修費（成長投資費）', vals: trainingCombined });
  items.push({ k: 'sgaTotal', label: '販売管理費 計', vals: pl.sgaTotal, kind: 'f', fill: 'FEF0D9' });
  items.push({ k: 'operating', label: '営業損益', vals: pl.operatingIncome, kind: 'f', color: 'operating' });
  items.push({ k: 'nonOpIncome', label: '営業外収益', vals: pl.nonOperatingIncome, fill: 'EEF1F7' });
  items.push({ k: 'nonOpExpense', label: '営業外費用', vals: pl.nonOperatingExpense, fill: 'EEF1F7' });
  items.push({ k: 'ordinary', label: '経常損益', vals: pl.ordinaryIncome, kind: 'f', color: 'ordinary' });
  items.push({ k: 'extra', label: '特別利益・損失', vals: pl.extraordinaryItems });
  items.push({ k: 'preTax', label: '税引前当期純損益', vals: pl.incomeBeforeTax, kind: 'f', fill: 'EEF1F7' });
  items.push({ k: 'corpTax', label: '法人税等', vals: pl.corporateTax });
  items.push({ k: 'net', label: '当期純損益', vals: pl.netIncome, kind: 'f', color: 'net' });
  items.push({ k: 'assets', label: '総資産（累計）', vals: pl.cumulativeAssets, kind: 'assets', fill: 'EEF1F7' });

  const row = {};
  items.forEach((it, i) => { row[it.k] = 4 + i; });
  const sgaFirst = row['sga_salary'], sgaLast = row['sga_training'];

  items.forEach(it => {
    const r = row[it.k];
    const pal = it.color ? XL_PL_COLORS[it.color] : null;
    const fmt = it.kind === 'count' ? 'int' : 'int';
    const bold = !!(pal || it.fill);
    const labStyle = { border: true, bold: bold || !!it.lab, color: pal ? pal.fg : it.lab, fill: pal ? pal.bg : it.fill };
    sh.set(r, 1, it.label, labStyle);
    for (let i = 0; i < 12; i++) {
      const col = xlsxCol(2 + i);
      let f = null;
      if (it.k === 'totalRevenue') f = revKeys.map(k => col + row[k]).join('+');
      else if (it.k === 'gross') f = `${col}${row.totalRevenue}-${col}${row.cogs}`;
      else if (it.k === 'sgaTotal') f = `SUM(${col}${sgaFirst}:${col}${sgaLast})`;
      else if (it.k === 'operating') f = `${col}${row.gross}-${col}${row.sgaTotal}`;
      else if (it.k === 'ordinary') f = `${col}${row.operating}+${col}${row.nonOpIncome}-${col}${row.nonOpExpense}`;
      else if (it.k === 'preTax') f = `${col}${row.ordinary}+${col}${row.extra}`;
      else if (it.k === 'net') f = `${col}${row.preTax}-${col}${row.corpTax}`;
      else if (it.k === 'assets') {
        f = i === 0 ? (opening ? `${opening}+${col}${row.net}` : `${col}${row.net}`) : `${xlsxCol(1 + i)}${r}+${col}${row.net}`;
      }
      sh.set(r, 2 + i, it.vals[i], { border: true, fmt, bold, color: pal ? pal.fg : undefined, fill: pal ? pal.bg : it.fill }, f);
    }
    const tot = it.vals.reduce((s, v) => s + v, 0);
    const lastV = it.vals[11];
    sh.set(r, 14, it.kind === 'assets' ? lastV : tot,
      { border: true, fmt, bold: true, color: pal ? pal.tfg : undefined, fill: pal ? pal.tbg : (it.fill ? 'D5DBE6' : 'F3F4F7') },
      it.kind === 'assets' ? `M${r}` : `SUM(B${r}:M${r})`);
  });
  return { sheet: sh, row };
}

/* ---------------- ブック組み立て ---------------- */
function XlsxBook() { this.styles = new XlsxStyles(); this.sheets = []; }
XlsxBook.prototype.addSheet = function (name) {
  const s = new XlsxSheet(name, this.styles);
  this.sheets.push(s);
  return s;
};
XlsxBook.prototype.build = function () {
  const n = this.sheets.length;
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${this.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets>${this.sheets.map((s, i) => `<sheet name="${xlsxEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${this.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` }
  ];
  const sheetFiles = this.sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: s.xml() }));
  // styles.xml はシート生成後（スタイル登録後）に確定させる
  files.push({ name: 'xl/styles.xml', data: this.styles.xml() });
  return xlsxZip(files.concat(sheetFiles));
};

/* ---------------- サマリー／建築事業／入力内容 ---------------- */
function xlsxSummarySheet(book, state, result) {
  const sh = book.addSheet('サマリー');
  const be = result.breakEven, st = result.staff, s = result.summary, sy = state.synergy;
  sh.widths[1] = 30; [2, 3, 4, 5].forEach(c => { sh.widths[c] = 18; });
  const m = state.meta;
  sh.set(1, 1, `${m.companyName || '（会社名未入力）'} 様　事業計画検討書`, XL.title);
  sh.set(2, 1, `作成日：${m.createdAt || ''}${m.openDate ? `　／　オープン予定日：${m.openDate}` : ''}　（単位：円）`, XL.note);

  let r = 4;
  sh.set(r, 1, '損益分岐点と必要契約件数', XL.section); for (let c = 2; c <= 5; c++) sh.set(r, c, '', XL.section); r++;
  const kv = (label, v, fmt, bold) => {
    sh.set(r, 1, label, bold ? XL.labelB : XL.label);
    sh.set(r, 2, v, { border: true, fmt: fmt || 'int', bold: !!bold, fill: bold ? 'EEF1F7' : undefined });
    r++;
  };
  kv('人件費/月', st.laborCostMonth);
  kv('人件費/年', st.laborCostYear);
  kv('その他固定費/年', result.otherCostsAnnual.grandTotal);
  kv('損益分岐点/年', be.breakEvenAnnual, 'int', true);
  kv('手数料/件', result.areas.feeRawYen);
  kv('損益分岐 必要契約数/年（件）', be.requiredContractsYear);
  kv('損益分岐 必要契約数/月（件）', be.requiredContractsMonth);
  kv('目標契約件数/月（件・採用値）', be.targetContractsMonth, 'int', true);
  kv('目標契約件数/年（件・採用値）', be.targetContractsYear, 'int', true);
  kv('　内訳：土地（件/年）', be.targetLandCount);
  kv('　内訳：中古系（件/年）', be.targetUsedCount, 'dec');
  kv('　内訳：新築建売（件/年）', be.targetNewCount, 'dec');

  r += 1;
  sh.set(r, 1, '簡易P&L', XL.section); for (let c = 2; c <= 5; c++) sh.set(r, c, '', XL.section); r++;
  sh.set(r, 1, '科目', XL.headL);
  sh.set(r, 2, '1年目 件数', XL.head); sh.set(r, 3, '1年目 金額', XL.head);
  sh.set(r, 4, '2年目 件数', XL.head); sh.set(r, 5, '2年目 金額', XL.head); r++;
  const bp = result.businessPlan;
  const pl = (label, cnt1, a1, cnt2, a2, bold) => {
    const st1 = { border: true, fmt: 'int', bold: !!bold, fill: bold ? 'EEF1F7' : undefined };
    sh.set(r, 1, label, bold ? XL.labelB : XL.label);
    sh.set(r, 2, cnt1, st1); sh.set(r, 3, a1, st1); sh.set(r, 4, cnt2, st1); sh.set(r, 5, a2, st1);
    r++;
  };
  pl('仲介手数料', s.year1.brokerage.count, s.year1.brokerage.amount, s.year2.brokerage.count, s.year2.brokerage.amount);
  if (sy.reform.enabled) pl('リフォーム', bp.reform.annualFreq, s.year1.reform.amount, bp.reform.annualFreq, s.year2.reform.amount);
  if (sy.selfBuild.enabled) pl('自社請負', bp.selfBuild.annualFreq, s.year1.selfBuild.amount, bp.selfBuild.annualFreq, s.year2.selfBuild.amount);
  if (sy.referral.enabled) pl('他社紹介', bp.referral.annualFreq, s.year1.referral.amount, bp.referral.annualFreq, s.year2.referral.amount);
  pl('売上高 合計', '', s.year1.totalRevenue, '', s.year2.totalRevenue, true);
  pl('売上総利益 合計', '', s.year1.grossProfit, '', s.year2.grossProfit, true);
  pl('販売管理費 合計', '', s.year1.sgaTotal, '', s.year2.sgaTotal);
  pl('営業損益', '', s.year1.operatingIncome, '', s.year2.operatingIncome, true);
  pl('経常損益', '', s.year1.ordinaryIncome, '', s.year2.ordinaryIncome, true);
  pl('当期純損益', '', s.year1.netIncome, '', s.year2.netIncome, true);
  return sh;
}

function xlsxSynergySheet(book, state, result) {
  const sh = book.addSheet('建築事業');
  const bp = result.businessPlan;
  sh.widths[1] = 28; [2, 3, 4, 5, 6].forEach(c => { sh.widths[c] = 18; });
  sh.set(1, 1, '建築事業の利益イメージ', XL.title);
  const heads = ['事業', '単価（円）', '利益率', '不動産分配利益率', '年間受注頻度（件）', '年間利益（円）'];
  heads.forEach((h, i) => sh.set(3, 1 + i, h, i === 0 ? XL.headL : XL.head));
  let r = 4;
  [['reform', 'リフォーム事業'], ['selfBuild', '新築住宅事業（自社請負）'], ['referral', '他社建築紹介']].forEach(([key, label]) => {
    const cfg = state.synergy[key];
    if (!cfg.enabled) return;
    sh.set(r, 1, label, XL.label);
    sh.set(r, 2, cfg.unitPrice, { border: true, fmt: 'int' });
    if (cfg.profitRate !== undefined) sh.set(r, 3, cfg.profitRate, { border: true, fmt: 'pct' }); else sh.set(r, 3, '―', { border: true, h: 'right' });
    sh.set(r, 4, cfg.allocRate, { border: true, fmt: 'pct' });
    sh.set(r, 5, bp[key].annualFreq, { border: true, fmt: 'int' });
    sh.set(r, 6, bp[key].annualProfit, { border: true, fmt: 'int' });
    r++;
  });
  if (r === 4) sh.set(r, 1, '対応する建築事業が選択されていません', XL.note);
  else {
    sh.set(r, 1, '年間利益 合計', XL.labelB);
    for (let c = 2; c <= 5; c++) sh.set(r, c, '', { border: true, fill: 'EEF1F7' });
    sh.set(r, 6, bp.reform.annualProfit + bp.selfBuild.annualProfit + bp.referral.annualProfit, { border: true, fmt: 'int', bold: true, fill: 'EEF1F7' }, `SUM(F4:F${r - 1})`);
  }
}

function xlsxInputSheet(book, state, result) {
  const sh = book.addSheet('入力内容');
  sh.widths[1] = 34; sh.widths[2] = 18; sh.widths[3] = 14; sh.widths[4] = 14; sh.widths[5] = 14; sh.widths[6] = 14; sh.widths[7] = 14; sh.widths[8] = 14; sh.widths[9] = 14;
  sh.set(1, 1, '入力内容（シミュレーターで入力した値）', XL.title);
  let r = 3;
  const section = t => { sh.set(r, 1, t, XL.section); for (let c = 2; c <= 3; c++) sh.set(r, c, '', XL.section); r++; };
  const item = (label, v, fmt, unit) => {
    sh.set(r, 1, label, XL.label);
    sh.set(r, 2, v, { border: true, fmt: typeof v === 'number' ? (fmt || 'int') : undefined, h: typeof v === 'number' ? undefined : 'right' });
    sh.set(r, 3, unit || '', XL.note);
    r++;
  };
  const yn = b => (b ? 'はい' : 'いいえ');
  const s = state;
  section('基本情報');
  item('会社名', s.meta.companyName || ''); item('オープン予定日', s.meta.openDate || '');
  r++; section('人員体制・給与（月額）');
  s.staff.managers.forEach((p, i) => item(`不動産業務経験者${s.staff.managers.length > 1 ? i + 1 : ''}`, p.salary, 'int', '円/月'));
  s.staff.agents.forEach((p, i) => item(`エージェント${s.staff.agents.length > 1 ? i + 1 : ''}`, p.salary, 'int', '円/月'));
  s.staff.supports.forEach((p, i) => item(`サポート${s.staff.supports.length > 1 ? i + 1 : ''}`, p.salary, 'int', '円/月'));
  item('2年目以降の年間営業利益目標', s.targetProfitAnnual, 'int', '円/年');
  r++; section('対応する建築事業');
  [['reform', 'リフォーム事業'], ['selfBuild', '新築住宅事業（自社請負）'], ['referral', '他社建築紹介']].forEach(([k, label]) => {
    const c = s.synergy[k];
    item(label, yn(c.enabled));
    if (!c.enabled) return;
    item('　単価', c.unitPrice, 'int', '円');
    if (c.profitRate !== undefined) item('　利益率', c.profitRate, 'pct');
    item('　不動産分配利益率', c.allocRate, 'pct');
    item('　歩留り（受注転換率）', c.conversionRate, 'pct');
    if (c.capSolo !== undefined) { item('　年間上限件数（営業1名）', c.capSolo, 'int', '件/年'); item('　年間上限件数（営業2名以上）', c.capTeam, 'int', '件/年'); }
  });
  r++; section('広告宣伝費');
  item('CPC（クリック単価）', s.cpc, 'int', '円'); item('目標件数（反響数/月）', s.ad.targetLeads, 'int', '件/月');
  item('CVR（反響獲得率）', s.ad.cvr, 'pct'); item('ポータルサイト費用', s.ad.portal, 'int', '円/月');
  item('査定サイト費用', s.ad.assessmentSite, 'int', '円/月'); item('その他広告費①', s.ad.other1, 'int', '円/月'); item('その他広告費②', s.ad.other2, 'int', '円/月');
  r++; section('店舗組成費（イニシャル）');
  item('物件王 加盟金', s.initialCost.franchiseFee, 'int', '円'); item('物件王会費', s.initialCost.membershipFee, 'int', '円'); item('看板設置費用', s.initialCost.signageCost, 'int', '円');
  r++; section('免許');
  item('宅建免許', s.license.hasLicense ? '有り' : '無し');
  s.license.items.forEach(i => item('　' + i.label, i.amount, 'int', '円'));
  r++; section('その他運営コスト');
  const oc = s.otherCosts;
  [['消耗品費', oc.consumables, '円/年'], ['事務用品費', oc.officeSupplies, '円/年'], ['諸会費', oc.dues, '円/年'],
    ['水道光熱費', oc.utilities, '円/年'], ['リース料', oc.lease, '円/年'], ['雑費', oc.misc, '円/年'],
    ['研修費（成長投資費）', oc.training, '円/月'], ['店舗賃料', oc.storeRent, '円/月'], ['採用費', oc.recruiting, '円（初月一括）'],
    ['接待交際費', oc.entertainment, '円/月'], ['保険料', oc.insurance, '円/月'],
    ['内装工事費用（減価償却対象）', oc.renovationCostBasis, '円'], ['想定PPC費用（損益分岐点算出用）', oc.assumedPpcAnnual, '円/年']]
    .forEach(([l, v, u]) => item(l, v, 'int', u));
  item('償却区分', oc.depreciationType === '改装' ? '改装（15年償却）' : '新築等（20年償却）');
  r++; section('営業外損益・特別損益・税金');
  const pe = s.plExtras;
  [['受取利息', pe.interestIncome], ['雑収入', pe.miscIncome], ['支払利息', pe.interestExpense], ['雑損失', pe.miscLoss],
    ['特別利益・損失', pe.extraordinaryItems], ['法人税等', pe.corporateTax]].forEach(([l, v]) => item(l, v, 'int', '円/年'));

  r++; section('ターゲットエリア');
  const heads = ['エリア名', '世帯数', '土地 件数', '土地 平均価格(万円)', '中古戸建 件数', '中古戸建 平均価格(万円)', '新築戸建 件数', '新築戸建 平均価格(万円)', 'マンション 件数', 'マンション 平均価格(万円)'];
  heads.forEach((h, i) => sh.set(r, 1 + i, h, { ...(i === 0 ? XL.headL : XL.head), wrap: true }));
  for (let c = 10; c <= 10; c++) sh.widths[c] = 14;
  r++;
  s.areas.forEach(a => {
    sh.set(r, 1, a.name || '', XL.label);
    [a.households, a.land.count, a.land.priceMan, a.usedHouse.count, a.usedHouse.priceMan, a.newHouse.count, a.newHouse.priceMan, a.mansion.count, a.mansion.priceMan]
      .forEach((v, i) => sh.set(r, 2 + i, v, { border: true, fmt: 'int' }));
    r++;
  });
}

/* ---------------- 公開API ---------------- */
function buildExcelBytes(state, result) {
  const book = new XlsxBook();
  xlsxSummarySheet(book, state, result);
  const p1 = xlsxMonthlyPL(book, '月次PL_1年目', 'PL（1年目）月次詳細', result.pl1, state.synergy, null);
  xlsxMonthlyPL(book, '月次PL_2年目', 'PL（2年目以降）月次詳細', result.pl2, state.synergy, `'月次PL_1年目'!M${p1.row.assets}`);
  xlsxSynergySheet(book, state, result);
  xlsxInputSheet(book, state, result);
  return book.build();
}

function exportToExcel() {
  const result = runFullCalculation(appState);
  const bytes = buildExcelBytes(appState, result);
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const company = (appState.meta.companyName || '事業計画').replace(/[\\/:*?"<>|\s]+/g, '');
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `事業計画シミュレーター_${company}_${stamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
