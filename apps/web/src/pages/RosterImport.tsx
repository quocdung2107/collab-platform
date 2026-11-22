import { daysInMonth, expandRule, isoDate, type EventSeriesDto, type MemberDto, type OccurrenceDto, type RosterCellDto, type RosterColumnDto, type RosterImportInput, type RosterPreviewDto } from '@collab/shared';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { timeLabel } from '../lib/datetime';
import { columnLabel, distinctNames, matchName, norm, parseRoster, resolveName, templateRows, type NameMatch, type ParsedRoster, type Resolutions } from '../lib/roster';
import { readSpreadsheet, writeXlsx } from '../lib/sheet';
import { useAction, useLoad } from '../lib/useLoad';
import { Banner, Sheet } from '../ui/kit';

/**
 * Nhập bảng phân công một tháng từ Excel/CSV (IN-62). Cột = ngày của một Nhịp, dòng = vị trí, ô = người (cách nhau bằng dấu phẩy).
 * File đọc ở máy, tên khớp với thành viên ở máy; máy chủ xem trước và ghi trong một giao dịch.
 */

const STATE_LABEL: Record<RosterColumnDto['state'], { text: string; tone: string }> = {
  new: { text: 'Tạo bản nháp', tone: 'info' },
  draft: { text: 'Bản nháp', tone: 'info' },
  published: { text: 'Đã gửi, bỏ qua', tone: '' },
  skipped: { text: 'Nhịp bỏ ngày này', tone: '' },
  cancelled: { text: 'Đã huỷ', tone: '' },
  past: { text: 'Đã qua', tone: '' },
  duplicate: { text: 'Trùng cột trước', tone: '' },
};

export function RosterImportSheet({
  orgId,
  month,
  series,
  occurrences,
  onDone,
  onClose,
}: {
  orgId: string;
  month: Date;
  series: EventSeriesDto[];
  occurrences: OccurrenceDto[];
  onDone: (msg?: string) => void;
  onClose: () => void;
}) {
  const usable = series.filter((s) => s.canManage);
  const y = month.getFullYear();
  const m = month.getMonth() + 1;
  const from = isoDate(y, m, 1);
  const to = isoDate(y, m, daysInMonth(y, m));
  const datesOf = (s: EventSeriesDto) => {
    const occ = occurrences.filter((o) => o.seriesId === s.id && o.date >= from && o.date <= to && o.state !== 'skipped').map((o) => o.date);
    return occ.length ? [...new Set(occ)].sort() : expandRule(s.rule, s.startsOn, s.untilOn, from, to);
  };
  // Mặc định: nhịp có nhiều buổi nhất trong tháng.
  const [seriesId, setSeriesId] = useState(() => [...usable].sort((a, b) => datesOf(b).length - datesOf(a).length)[0]?.id ?? '');
  const current = usable.find((s) => s.id === seriesId);
  const members = useLoad(() => api.members(orgId), [orgId]);
  const [file, setFile] = useState<{ name: string; parsed: ParsedRoster } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Resolutions>({});
  const [preview, setPreview] = useState<RosterPreviewDto | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const act = useAction();

  const people = members.data ?? [];
  const nameOf = useMemo(() => new Map(people.map((p) => [p.userId, p.displayName])), [people]);
  const names = useMemo(() => (file ? distinctNames(file.parsed).map((n) => ({ ...n, match: matchName(n.raw, people) })) : []), [file, people]);
  const resolved = useMemo(() => new Map(names.map((n) => [n.key, resolveName(n.key, n.match, chosen)])), [names, chosen]);

  const input = useMemo<RosterImportInput | null>(() => {
    if (!file || !current || !file.parsed.columns.length || !file.parsed.rows.length || !members.data) return null;
    return {
      seriesId: current.id,
      columns: file.parsed.columns.map((c) => (c.time ? { date: c.date, time: c.time } : { date: c.date })),
      rows: file.parsed.rows.map((r) => ({
        name: r.name,
        cells: r.cells.map((c) => [...new Set(c.map((n) => resolved.get(norm(n))).filter((x): x is string => !!x))]),
      })),
    };
  }, [file, current, resolved, members.data]);
  const inputKey = JSON.stringify(input);

  useEffect(() => {
    if (!input) return setPreview(null);
    let live = true;
    setPreviewError(null);
    const t = setTimeout(() => {
      api
        .rosterPreview(orgId, input)
        .then((p) => live && setPreview(p))
        .catch((e: Error) => live && (setPreview(null), setPreviewError(e.message)));
    }, 250);
    return () => ((live = false), clearTimeout(t));
  }, [orgId, inputKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setReadError(null);
    setChosen({});
    try {
      const grid = await readSpreadsheet(f);
      const parsed = parseRoster(grid, { year: y, month: m });
      if (!parsed.columns.length) throw new Error('Không tìm thấy cột ngày ở dòng đầu (ví dụ "CN 06/01/2030")');
      if (!parsed.rows.length) throw new Error('Không tìm thấy dòng vị trí nào (cột đầu: tên vị trí)');
      setFile({ name: f.name, parsed });
    } catch (e) {
      setFile(null);
      setReadError(e instanceof Error ? e.message : 'Không đọc được file');
    }
  };

  const downloadTemplate = () => {
    if (!current) return;
    const rows = templateRows(datesOf(current), current.definition.positions.map((p) => p.name));
    const blob = new Blob([writeXlsx(rows) as Uint8Array<ArrayBuffer>], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bang-phan-cong-${from.slice(0, 7)}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const t = preview?.totals;
  const changes = t ? t.newEvents + t.newPositions + t.added + t.removed : 0;
  const apply = () =>
    input &&
    act.run(
      () => api.rosterImport(orgId, input),
      (r) =>
        onDone(
          [
            r.totals.newEvents ? `tạo ${r.totals.newEvents} bản nháp` : '',
            r.totals.added ? `xếp ${r.totals.added} lượt` : '',
            r.totals.removed ? `bỏ ${r.totals.removed} lượt` : '',
          ]
            .filter(Boolean)
            .join(', ')
            .replace(/^./, (c) => `Đã ${c}`) + '. Đây là bản nháp, chưa ai nhận thông báo; kiểm tra rồi gửi từng buổi khi sẵn sàng.',
        ),
    );

  const needsPick = names.filter((n) => n.match.kind === 'ambiguous' && !(n.key in chosen)).length;
  const unknown = names.filter((n) => n.match.kind === 'unknown' && !chosen[n.key]).length;
  // Tên chưa khớp lên đầu, rồi tên khớp gần đúng.
  const rank = (k: NameMatch['kind']) => (k === 'ambiguous' ? 0 : k === 'unknown' ? 1 : 2);
  const review = names.filter((n) => n.match.kind !== 'exact').sort((a, b) => rank(a.match.kind) - rank(b.match.kind));

  return (
    <Sheet wide title={`Nhập bảng phân công tháng ${m}/${y}`} onClose={onClose}>
      {!usable.length ? (
        <p className="hint">Chưa có nhịp nào bạn quản lý. Tạo nhịp trước (Thêm › Nhịp mới từ mẫu, hoặc Lặp tháng này), rồi nhập bảng phân công vào nhịp đó.</p>
      ) : (
        <>
          <p className="hint small">
            Dòng đầu là ngày (ví dụ "{columnLabel(from)}"), cột đầu là vị trí, mỗi ô ghi người phụ trách, nhiều người cách nhau bằng dấu phẩy. Ngày chưa có buổi sẽ được tạo bản nháp từ nhịp. Mọi thay đổi chỉ vào bản nháp; buổi đã gửi không bị đổi.
          </p>
          <label className="grid hint plan-field">
            Nhịp
            <select value={seriesId} onChange={(e) => setSeriesId(e.target.value)}>
              {usable.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.localTime}
                </option>
              ))}
            </select>
          </label>
          <div className="row wrap">
            <label className="button primary file-button">
              {file ? 'Chọn file khác' : 'Chọn file Excel hoặc CSV'}
              <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ''))} />
            </label>
            <button className="button" onClick={downloadTemplate} disabled={!current}>
              Tải file mẫu
            </button>
          </div>
          {readError && <p className="error">{readError}</p>}
          {members.error && <p className="error">{members.error}</p>}
          {file && (
            <p className="hint small">
              <strong>{file.name}</strong>: {file.parsed.columns.length} ngày × {file.parsed.rows.length} vị trí, {names.length} tên khác nhau.
            </p>
          )}
          {file && file.parsed.issues.length > 0 && (
            <Banner tone="warn">
              <ul className="plain-list">
                {file.parsed.issues.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </Banner>
          )}
          {review.length > 0 && (
            <section className="grid">
              <h3 className="section-title">
                Tên cần xem lại
                {needsPick + unknown > 0 && <span className="tag warn">{needsPick + unknown} chưa khớp</span>}
              </h3>
              <ul className="roster-names">
                {review.map((n) => (
                  <NameRow key={n.key} raw={n.raw} count={n.count} match={n.match} people={people} value={resolved.get(n.key) ?? ''} onChange={(v) => setChosen({ ...chosen, [n.key]: v || null })} />
                ))}
              </ul>
              <p className="hint small">Tên chưa khớp sẽ bị bỏ qua. Người chưa có trong tổ chức cần được mời trước.</p>
            </section>
          )}
          {previewError && <p className="error">{previewError}</p>}
          {preview && <PreviewGrid preview={preview} labels={file!.parsed.columns.map((c) => c.label)} rows={file!.parsed.rows.map((r) => r.name)} nameOf={nameOf} />}
          {t && (
            <Banner tone={changes ? 'info' : 'ok'}>
              {changes ? (
                <>
                  Sẽ {[t.newEvents && `tạo ${t.newEvents} bản nháp`, t.newPositions && `thêm ${t.newPositions} vị trí`, t.added && `xếp ${t.added} lượt`, t.removed && `bỏ ${t.removed} lượt khỏi bản nháp`].filter(Boolean).join(', ')}. Tất cả là bản nháp, chưa ai nhận thông báo.
                </>
              ) : (
                'Lịch đã khớp với file, không có gì thay đổi.'
              )}
              {preview!.columns.some((c) => c.state === 'published') && ' Buổi đã gửi không bị đổi; sửa buổi đó trên bảng phân công.'}
              {t.forbiddenCells > 0 && ` ${t.forbiddenCells} ô bị bỏ qua vì bạn không có quyền sửa vị trí đó.`}
            </Banner>
          )}
          {act.error && <p className="error">{act.error}</p>}
          {preview && (
            <button className="button primary" disabled={act.busy || !changes} onClick={apply}>
              {act.busy ? 'Đang ghi…' : 'Ghi vào lịch'}
            </button>
          )}
        </>
      )}
    </Sheet>
  );
}

function NameRow({ raw, count, match, people, value, onChange }: { raw: string; count: number; match: NameMatch; people: MemberDto[]; value: string; onChange: (v: string) => void }) {
  const candidates = match.kind === 'ambiguous' ? new Set(match.candidates) : null;
  const sorted = [...people].sort((a, b) => {
    const ca = candidates?.has(a.userId) ? 0 : 1;
    const cb = candidates?.has(b.userId) ? 0 : 1;
    return ca - cb || a.displayName.localeCompare(b.displayName, 'vi');
  });
  const note = match.kind === 'fuzzy' ? 'khớp gần đúng' : match.kind === 'ambiguous' ? `${match.candidates.length} người trùng tên` : 'không tìm thấy';
  return (
    <li className="roster-name">
      <span className="grow">
        <strong>{raw}</strong>
        <span className={`hint small${match.kind === 'fuzzy' ? '' : ' warn-text'}`}>
          {note}
          {count > 1 ? ` · ${count} ô` : ''}
        </span>
      </span>
      <select aria-label={`Người cho tên ${raw}`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— Bỏ qua —</option>
        {sorted.map((p) => (
          <option key={p.userId} value={p.userId}>
            {p.displayName}
          </option>
        ))}
      </select>
    </li>
  );
}

function PreviewGrid({ preview, labels, rows, nameOf }: { preview: RosterPreviewDto; labels: string[]; rows: string[]; nameOf: Map<string, string> }) {
  const n = (u: string) => nameOf.get(u) ?? 'Thành viên';
  return (
    <div className="roster-scroll" role="region" aria-label="Xem trước bảng phân công" tabIndex={0}>
      <table className="roster-table">
        <thead>
          <tr>
            <th scope="col">Vị trí</th>
            {preview.columns.map((c, i) => {
              const s = STATE_LABEL[c.state];
              return (
                <th key={i} scope="col" className={s.tone ? '' : 'off'}>
                  <span className="grid">
                    <span>{labels[i] || columnLabel(c.date)}</span>
                    <span className="hint small">{c.title} · {timeLabel(c.startsAt)}</span>
                    <span>
                      <span className={`tag ${s.tone}`}>{s.text}</span>
                    </span>
                    {c.outsideRule && c.state === 'new' && <span className="hint small">Ngoài quy tắc nhịp</span>}
                    {c.conflict && <span className="hint small warn-text">Trùng: {c.conflict}</span>}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((name, ri) => (
            <tr key={ri}>
              <th scope="row">
                {name}
                {preview.cells[ri]!.some((c) => c?.newPosition && !c.forbidden) && <span className="hint small"> · vị trí mới</span>}
              </th>
              {preview.cells[ri]!.map((c, ci) => (
                <td key={ci} className={preview.columns[ci]!.state === 'new' || preview.columns[ci]!.state === 'draft' ? '' : 'off'}>
                  {c && <Cell c={c} n={n} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ c, n }: { c: RosterCellDto; n: (u: string) => string }) {
  if (c.forbidden) return <span className="hint small">Không có quyền sửa</span>;
  const busy = new Set(c.busy);
  return (
    <span className="roster-cell">
      {c.keep.map((u) => (
        <span key={u} className="roster-person">
          {n(u)}
        </span>
      ))}
      {c.add.map((u) => (
        <span key={u} className="roster-person add" title={busy.has(u) ? 'Đã đánh dấu bận ngày này' : 'Sẽ thêm'}>
          + {n(u)}
          {busy.has(u) && ' · bận'}
        </span>
      ))}
      {c.remove.map((u) => (
        <span key={u} className="roster-person remove" title="Sẽ bỏ khỏi bản nháp">
          {n(u)}
        </span>
      ))}
      {c.slotsBefore !== null && c.slotsAfter !== c.slotsBefore && <span className="hint small">số chỗ {c.slotsBefore}→{c.slotsAfter}</span>}
      {!c.keep.length && !c.add.length && <span className="hint small">trống</span>}
    </span>
  );
}
