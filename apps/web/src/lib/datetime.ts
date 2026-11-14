/** Hiển thị và nhập giờ theo múi giờ của máy (vi-VN). API luôn nhận/trả ISO UTC. */
export const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
export const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
export const rangeLabel = (a: string, b: string) => `${dayLabel(a)} · ${timeLabel(a)}–${timeLabel(b)}`;

/** ISO → giá trị cho <input type="datetime-local"> theo giờ máy. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** Giá trị datetime-local (giờ máy) → ISO UTC. */
export const fromLocalInput = (v: string) => new Date(v).toISOString();

export const addMinutes = (iso: string, min: number) => new Date(new Date(iso).getTime() + min * 60_000).toISOString();
