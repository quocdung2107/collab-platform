import type { ShortPositionDto } from '@collab/shared';

/** Gộp vị trí thiếu người theo buổi: một dòng một buổi, không lặp tên (rà soát UX 2026-11). */
export function groupShort(list: ShortPositionDto[]) {
  const by = new Map<string, { eventId: string; eventTitle: string; startsAt: string; draft: boolean; total: number; positions: Array<{ name: string; missing: number }> }>();
  for (const p of list) {
    const g = by.get(p.eventId) ?? { eventId: p.eventId, eventTitle: p.eventTitle, startsAt: p.startsAt, draft: p.eventStatus === 'draft', total: 0, positions: [] };
    const missing = p.slots - p.filled;
    g.total += missing;
    g.positions.push({ name: p.positionName, missing });
    by.set(p.eventId, g);
  }
  return [...by.values()];
}
