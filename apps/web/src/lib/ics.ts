/** Xuất một buổi ra tệp iCalendar (RFC 5545), mở được bằng Apple/Google/Outlook Calendar. */
const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Gấp dòng ≤ 75 octet (tính theo ký tự là đủ an toàn cho tiêu đề ngắn; tiếng Việt nhiều byte nên cắt ở 60 ký tự). */
const fold = (line: string) => {
  const out: string[] = [];
  for (let i = 0; i < line.length; i += 60) out.push((i ? ' ' : '') + line.slice(i, i + 60));
  return out.join('\r\n');
};

export interface IcsEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  status: 'draft' | 'published' | 'cancelled' | string;
}

export function eventToIcs(e: IcsEvent, now = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Collab Platform//VI',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${e.id}@collab-platform`,
    `DTSTAMP:${utc(now.toISOString())}`,
    `DTSTART:${utc(e.startsAt)}`,
    `DTEND:${utc(e.endsAt)}`,
    `SUMMARY:${esc(e.title)}`,
    ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
    ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
    `STATUS:${e.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function downloadIcs(e: IcsEvent) {
  const url = URL.createObjectURL(new Blob([eventToIcs(e)], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${e.title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40) || 'buoi'}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
