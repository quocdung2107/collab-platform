/**
 * Nhập bảng phân công một tháng từ Excel/CSV (IN-62): cột = buổi (ngày của một Nhịp), dòng = vị trí phục vụ,
 * ô = người được xếp. Chỉ ghi vào bản nháp (không ai được báo); gửi lịch chính thức là bước riêng.
 * Máy khách đọc file và khớp tên → userId; máy chủ xem trước và ghi trong một giao dịch.
 */

export interface RosterImportInput {
  seriesId: string;
  /** Mỗi cột: ngày địa phương; giờ (HH:MM) chỉ dùng khi phải tạo buổi mới. */
  columns: Array<{ date: string; time?: string }>;
  /** cells[i] là người của cột i; mảng rỗng = ô trống (bản nháp: vị trí trống). */
  rows: Array<{ name: string; cells: string[][] }>;
}

/**
 * Trạng thái cột:
 * new = sẽ tạo bản nháp từ nhịp; draft = bản nháp có sẵn;
 * còn lại bị bỏ qua: published (đã gửi, sửa trên bảng phân công), skipped (nhịp bỏ ngày này hoặc buổi đã xoá), cancelled, past (đã qua), duplicate (trùng ngày cột trước).
 */
export type RosterColumnState = 'new' | 'draft' | 'published' | 'skipped' | 'cancelled' | 'past' | 'duplicate';

export interface RosterColumnDto {
  date: string;
  startsAt: string;
  title: string;
  eventId: string | null;
  state: RosterColumnState;
  /** Ngày không nằm trong quy tắc của nhịp (vẫn tạo được, gắn vào nhịp). */
  outsideRule: boolean;
  /** Chỗ trùng của nhịp ở ngày này (ngày đặc biệt, buổi khác cùng giờ). */
  conflict: string | null;
}

export interface RosterCellDto {
  positionId: string | null;
  /** Vị trí chưa có ở buổi này: sẽ tạo. */
  newPosition: boolean;
  slotsBefore: number | null;
  slotsAfter: number;
  keep: string[];
  add: string[];
  /** Người sẽ bỏ khỏi vị trí (không còn trong ô). */
  remove: string[];
  /** Người sẽ thêm đã đánh dấu bận ngày này (AD-34). */
  busy: string[];
  /** Không có quyền sửa vị trí này (trưởng nhóm khác, không phải người phụ trách buổi). */
  forbidden: boolean;
}

export interface RosterTotalsDto {
  newEvents: number;
  newPositions: number;
  added: number;
  removed: number;
  ignoredColumns: number;
  forbiddenCells: number;
}

export interface RosterPreviewDto {
  timezone: string;
  columns: RosterColumnDto[];
  /** cells[dòng][cột]; null khi cột bị bỏ qua hoặc ô trống ở vị trí chưa có. */
  cells: Array<Array<RosterCellDto | null>>;
  totals: RosterTotalsDto;
}

export interface RosterImportResultDto {
  totals: RosterTotalsDto;
  eventIds: string[];
}
