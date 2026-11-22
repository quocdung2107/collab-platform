import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/**
 * Đọc/ghi bảng tính tối giản cho nhập bảng phân công (IN-62): trang tính đầu tiên của .xlsx, hoặc .csv.
 * Chỉ cần giá trị ô (chuỗi, số, ngày), không cần định dạng nên không dùng thư viện bảng tính đầy đủ.
 * Số ngày Excel được trả nguyên dạng số; `date1904` cho biết hệ ngày của sổ.
 */

export type CellValue = string | number | null;
export interface Grid {
  rows: CellValue[][];
  date1904: boolean;
}

const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    return String.fromCodePoint(k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  });
const encode = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const attr = (attrs: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? null;
/** Nội dung chữ của một phần tử chuỗi (<si>, <is>): nối các <t>, bỏ phần phiên âm <rPh>. */
const textOf = (xml: string) =>
  [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)].map((m) => decode(m[1] ?? '')).join('');

/** "BC12" → 54 (cột, đếm từ 0). */
export function columnIndex(ref: string) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function readXlsx(data: Uint8Array): Grid {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, { filter: (f) => (f.name.startsWith('xl/') && f.name.endsWith('.xml')) || f.name.endsWith('.rels') });
  } catch {
    throw new Error('File không phải .xlsx hợp lệ (nếu là .xls cũ, hãy lưu lại thành .xlsx)');
  }
  const get = (path: string) => (files[path] ? strFromU8(files[path]) : null);
  const wb = get('xl/workbook.xml');
  if (!wb) throw new Error('File không phải .xlsx hợp lệ');
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(wb);
  const first = /<sheet\b([^>]*)\/?>/.exec(wb)?.[1] ?? '';
  const rid = attr(first, 'r:id');
  const rels = get('xl/_rels/workbook.xml.rels') ?? '';
  let target = 'worksheets/sheet1.xml';
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) if (attr(m[1]!, 'Id') === rid) target = attr(m[1]!, 'Target') ?? target;
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  const sheet = get(sheetPath);
  if (!sheet) throw new Error('Không tìm thấy trang tính đầu tiên trong file');
  const shared = [...(get('xl/sharedStrings.xml') ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((m) => textOf(m[1] ?? ''));

  const rows: CellValue[][] = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(attr(rm[1]!, 'r') ?? rows.length + 1) - 1;
    const row: CellValue[] = [];
    let next = 0;
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = cm[1]!;
      const ref = attr(a, 'r');
      const ci = ref ? columnIndex(ref) : next;
      next = ci + 1;
      const t = attr(a, 't');
      const body = cm[2] ?? '';
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: CellValue = null;
      if (t === 's') value = v !== undefined ? (shared[Number(v)] ?? '') : null;
      else if (t === 'inlineStr') value = textOf(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '');
      else if (t === 'str' || t === 'd') value = v !== undefined ? decode(v) : null;
      else if (t === 'b') value = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : null;
      else if (t === 'e') value = null;
      else if (v !== undefined && v.trim() !== '') value = Number(v);
      if (value !== null && value !== '') row[ci] = value;
    }
    rows[r] = Array.from(row, (x) => x ?? null);
  }
  return { rows: Array.from(rows, (x) => x ?? []), date1904 };
}

/** CSV theo RFC 4180; tự nhận dấu phân cách (, ; tab) từ dòng đầu; bỏ BOM. */
export function readCsv(text: string): Grid {
  const s = text.replace(/^﻿/, '');
  const firstLine = s.split(/\r?\n/, 1)[0] ?? '';
  const count = (ch: string) => {
    let n = 0;
    let q = false;
    for (const c of firstLine) {
      if (c === '"') q = !q;
      else if (c === ch && !q) n++;
    }
    return n;
  };
  const delim = [',', ';', '\t'].reduce((best, d) => (count(d) > count(best) ? d : best), ',');
  const rows: CellValue[][] = [];
  let row: CellValue[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  const push = () => (row.push(cell.trim() === '' ? null : cell), (cell = ''));
  while (i < s.length) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') (cell += '"'), (i += 2);
      else if (c === '"') (quoted = false), i++;
      else (cell += c), i++;
      continue;
    }
    if (c === '"' && cell === '') (quoted = true), i++;
    else if (c === delim) push(), i++;
    else if (c === '\n' || c === '\r') {
      push();
      rows.push(row);
      row = [];
      i += c === '\r' && s[i + 1] === '\n' ? 2 : 1;
    } else (cell += c), i++;
  }
  if (cell !== '' || row.length) (push(), rows.push(row));
  return { rows, date1904: false };
}

export async function readSpreadsheet(file: File): Promise<Grid> {
  const buf = new Uint8Array(await file.arrayBuffer());
  // .xlsx là tệp zip (bắt đầu bằng "PK").
  if (buf[0] === 0x50 && buf[1] === 0x4b) return readXlsx(buf);
  if (/\.xlsx?$/i.test(file.name)) throw new Error('Không đọc được file Excel này; hãy lưu lại thành .xlsx');
  return readCsv(new TextDecoder('utf-8').decode(buf));
}

/** Ghi một trang tính .xlsx tối giản (chuỗi nội tuyến, cột đầu và dòng đầu in đậm, cố định dòng/cột đầu). */
export function writeXlsx(rows: string[][], sheetName = 'Bang phan cong'): Uint8Array {
  const colName = (i: number) => {
    let s = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };
  const width = Math.max(1, ...rows.map((r) => r.length));
  const cols = Array.from({ length: width }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i === 0 ? 24 : 18}" customWidth="1"/>`).join('');
  const body = rows
    .map(
      (r, ri) =>
        `<row r="${ri + 1}">${r
          .map((v, ci) => (v === '' ? '' : `<c r="${colName(ci)}${ri + 1}" t="inlineStr"${ri === 0 || ci === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${encode(v)}</t></is></c>`))
          .join('')}</row>`,
    )
    .join('');
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${ns} xmlns:r="${rel}"><sheets><sheet name="${encode(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet ${ns}><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${ns}><sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`,
    ),
  });
}
