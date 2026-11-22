import { isoDate, weekdayIso } from '@collab/shared';
import type { CellValue, Grid } from './sheet';

/**
 * Nhập bảng phân công (IN-62), phần thuần ở máy khách: đọc tiêu đề ngày, tách tên trong ô, khớp tên với thành viên.
 * Bố cục: dòng đầu = ngày (cột), cột đầu = vị trí (dòng). File đảo chiều (ngày ở cột đầu) được tự xoay lại.
 */

export interface ParsedColumn {
  date: string;
  time?: string;
  label: string;
}
export interface ParsedRow {
  name: string;
  /** Tên thô trong từng ô, theo thứ tự cột. */
  cells: string[][];
}
export interface ParsedRoster {
  columns: ParsedColumn[];
  rows: ParsedRow[];
  /** Cảnh báo đọc file (cột không đọc được ngày, ô có chữ nhưng không có tên vị trí…). */
  issues: string[];
}

export const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const pad = (n: number) => String(n).padStart(2, '0');
const validDate = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && isoDate(y, m, d) === `${y}-${pad(m)}-${pad(d)}`;

/** Số ngày Excel → ngày (và giờ nếu có phần lẻ). Hệ 1900 có lỗi năm nhuận 1900 nên mốc là 30/12/1899. */
export function excelSerial(n: number, date1904 = false): { date: string; time?: string } | null {
  if (!Number.isFinite(n) || n < 1 || n > 2_958_465) return null;
  const days = Math.floor(n);
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(base + days * 86_400_000);
  const mins = Math.round((n - days) * 1440);
  const date = isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  return mins > 0 && mins < 1440 ? { date, time: `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}` } : { date };
}

/**
 * Tiêu đề cột → ngày. Nhận: số ngày Excel; "2030-01-06"; "06/01/2030", "6-1-30", "6.1"; có thể kèm thứ ("CN", "Chúa nhật")
 * và giờ ("8:00", "8h", "19h30"). Thiếu năm → chọn năm gần tháng đang lập lịch nhất.
 */
export function parseHeaderDate(v: CellValue, ref: { year: number; month: number }, date1904 = false): { date: string; time?: string } | null {
  if (v === null) return null;
  if (typeof v === 'number') return v > 20_000 && v < 80_000 ? excelSerial(v, date1904) : null;
  const s = v.trim();
  let rest = s;
  let date: string | null = null;
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    if (validDate(y, m, d)) date = isoDate(y, m, d);
    rest = s.replace(iso[0], ' ');
  } else {
    const dm = /(?<!\d)(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2,4}))?(?!\d)/.exec(s);
    if (!dm) return null;
    const d = Number(dm[1]);
    const m = Number(dm[2]);
    rest = s.replace(dm[0], ' ');
    if (dm[3]) {
      const y = dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3]);
      if (validDate(y, m, d)) date = isoDate(y, m, d);
    } else {
      // Năm gần tháng tham chiếu nhất (lập lịch tháng 12 với cột "05/01" → tháng 1 năm sau).
      const refIdx = ref.year * 12 + ref.month - 1;
      let best: number | null = null;
      for (const y of [ref.year - 1, ref.year, ref.year + 1]) {
        if (!validDate(y, m, d)) continue;
        if (best === null || Math.abs(y * 12 + m - 1 - refIdx) < Math.abs(best * 12 + m - 1 - refIdx)) best = y;
      }
      if (best !== null) date = isoDate(best, m, d);
    }
  }
  if (!date) return null;
  const t = /(?<!\d)(\d{1,2})\s*(?::\s*(\d{2})|[hg]\s*(\d{2})?|giờ\s*(\d{2})?)/i.exec(rest);
  if (t) {
    const h = Number(t[1]);
    const mi = Number(t[2] ?? t[3] ?? t[4] ?? 0);
    if (h < 24 && mi < 60) return { date, time: `${pad(h)}:${pad(mi)}` };
  }
  return { date };
}

const text = (v: CellValue | undefined) => (v === null || v === undefined ? '' : String(v).trim());

/** Tách các tên trong một ô: dấu phẩy (theo yêu cầu), cùng chấm phẩy, xuống dòng, "/", "&", " và "; bỏ ghi chú trong ngoặc. */
export function splitNames(cell: string): string[] {
  const out: string[] = [];
  for (const raw of cell.split(/[,;\n\r/&+]|\s+và\s+/i)) {
    const n = raw.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (n && !out.some((x) => norm(x) === norm(n))) out.push(n);
  }
  return out;
}

const WEEKDAY_SHORT = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
/** Nhãn cột dùng cho file mẫu và màn hình xem trước: "CN 06/01/2030". */
export const columnLabel = (date: string) => {
  const [y, m, d] = date.split('-');
  return `${WEEKDAY_SHORT[weekdayIso(date)]} ${d}/${m}/${y}`;
};

export function parseRoster(grid: Grid, ref: { year: number; month: number }): ParsedRoster {
  let rows = grid.rows.filter((r) => r.some((c) => text(c) !== ''));
  const issues: string[] = [];
  if (!rows.length) return { columns: [], rows: [], issues: ['File không có dữ liệu'] };
  const headerDates = (rs: CellValue[][]) => (rs[0] ?? []).slice(1).filter((c) => parseHeaderDate(c, ref, grid.date1904)).length;
  // Ngày nằm ở cột đầu thay vì dòng đầu → xoay bảng.
  const width = Math.max(...rows.map((r) => r.length));
  const transposed = Array.from({ length: width }, (_, c) => rows.map((r) => r[c] ?? null));
  if (headerDates(transposed) > headerDates(rows)) rows = transposed.filter((r) => r.some((c) => text(c) !== ''));

  const header = rows[0]!;
  const columns: Array<ParsedColumn & { index: number }> = [];
  for (let c = 1; c < header.length; c++) {
    const v = header[c] ?? null;
    if (text(v) === '') continue;
    const d = parseHeaderDate(v, ref, grid.date1904);
    if (!d) {
      issues.push(`Bỏ qua cột "${text(v)}": không đọc được ngày`);
      continue;
    }
    columns.push({ ...d, label: typeof v === 'number' ? columnLabel(d.date) + (d.time ? ` ${d.time}` : '') : text(v), index: c });
  }
  const out: ParsedRow[] = [];
  for (const r of rows.slice(1)) {
    const name = text(r[0]);
    const cells = columns.map((c) => splitNames(text(r[c.index])));
    if (!name) {
      if (cells.some((x) => x.length)) issues.push('Bỏ qua một dòng có người nhưng thiếu tên vị trí ở cột đầu');
      continue;
    }
    const same = out.find((x) => norm(x.name) === norm(name));
    if (same) {
      // Hai dòng cùng tên vị trí: gộp người vào dòng đầu.
      issues.push(`Dòng "${name}" lặp lại: đã gộp vào dòng đầu tiên`);
      same.cells = same.cells.map((x, i) => [...x, ...cells[i]!.filter((n) => !x.some((y) => norm(y) === norm(n)))]);
      continue;
    }
    out.push({ name, cells });
  }
  return { columns: columns.map(({ index: _i, ...c }) => c), rows: out, issues };
}

// ---------------------------------------------------------------- khớp tên

export interface Person {
  userId: string;
  displayName: string;
}
export type NameMatch =
  | { kind: 'exact'; userId: string }
  | { kind: 'fuzzy'; userId: string }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'unknown' };

/** Danh xưng thường viết trước tên trong bảng phân công hội thánh. */
const TITLES = ['muc su', 'truyen dao', 'chap su', 'thay', 'anh', 'chi', 'em', 'co', 'chu', 'bac', 'ong', 'ba', 'ms', 'td', 'cs', 'a.', 'c.'];
const stripTitle = (n: string) => {
  for (const t of TITLES) if (n.startsWith(`${t} `) && n.length > t.length + 1) return n.slice(t.length + 1).trim();
  return n;
};

/**
 * Khớp một tên trong file với thành viên: trùng nguyên tên (không dấu) → exact. Nếu không: bỏ danh xưng, rồi tìm người
 * có tên kết thúc bằng các chữ đó ("Dũng", "Quốc Dũng" → "Nguyễn Quốc Dũng") hoặc bắt đầu bằng chúng; đúng một người → fuzzy.
 */
export function matchName(raw: string, people: readonly Person[]): NameMatch {
  const q = norm(raw);
  const exact = people.filter((p) => norm(p.displayName) === q);
  if (exact.length === 1) return { kind: 'exact', userId: exact[0]!.userId };
  if (exact.length > 1) return { kind: 'ambiguous', candidates: exact.map((p) => p.userId) };
  const words = (s: string) => s.split(' ').filter(Boolean);
  const tries = uniqStrings([q, stripTitle(q)]);
  for (const t of tries) {
    const qt = words(t);
    if (!qt.length) continue;
    const hit = people.filter((p) => {
      const pt = words(norm(p.displayName));
      if (qt.length > pt.length) return false;
      const tail = pt.slice(pt.length - qt.length);
      const head = pt.slice(0, qt.length);
      return tail.every((w, i) => w === qt[i]) || head.every((w, i) => w === qt[i]);
    });
    if (hit.length === 1) return { kind: 'fuzzy', userId: hit[0]!.userId };
    if (hit.length > 1) return { kind: 'ambiguous', candidates: hit.map((p) => p.userId) };
  }
  return { kind: 'unknown' };
}
const uniqStrings = (xs: string[]) => [...new Set(xs)];

/** Mọi tên khác nhau trong file (theo dạng chuẩn hoá), giữ cách viết đầu tiên gặp. */
export function distinctNames(parsed: ParsedRoster): Array<{ key: string; raw: string; count: number }> {
  const m = new Map<string, { key: string; raw: string; count: number }>();
  for (const r of parsed.rows)
    for (const c of r.cells)
      for (const n of c) {
        const key = norm(n);
        const cur = m.get(key);
        if (cur) cur.count++;
        else m.set(key, { key, raw: n, count: 1 });
      }
  return [...m.values()];
}

/** Lựa chọn của người nhập: userId, hoặc null = bỏ qua tên này. Không có trong bảng = dùng kết quả khớp tự động. */
export type Resolutions = Record<string, string | null>;

export function resolveName(key: string, match: NameMatch, chosen: Resolutions): string | null {
  if (key in chosen) return chosen[key] ?? null;
  return match.kind === 'exact' || match.kind === 'fuzzy' ? match.userId : null;
}

/** Bảng mẫu: dòng đầu "Vị trí" + nhãn ngày; mỗi dòng sau là một vị trí, ô trống để điền tên. */
export function templateRows(dates: readonly string[], positions: readonly string[]): string[][] {
  const head = ['Vị trí', ...dates.map(columnLabel)];
  const body = (positions.length ? positions : ['Âm thanh', 'Hướng dẫn']).map((p) => [p, ...dates.map(() => '')]);
  return [head, ...body];
}
