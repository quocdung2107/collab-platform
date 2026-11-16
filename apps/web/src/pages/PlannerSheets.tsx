import {
  PERIOD_COLORS,
  ruleLabel,
  selectorLabel,
  weekdayIso,
  nthOfMonth,
  type EventSeriesDto,
  type MonthProposalDto,
  type PlanPeriodDto,
  type SeriesImpactDto,
  type SeriesRule,
} from '@collab/shared';
import { useState } from 'react';
import { api, type SeriesChange } from '../lib/api';
import { timeLabel } from '../lib/datetime';
import { WEEKDAYS, dm, type Ev } from '../lib/planning';
import { useAction, useLoad } from '../lib/useLoad';
import { confirmThen, dialogs } from '../ui/dialogs';
import { Sheet } from '../ui/kit';

/**
 * Các bảng trượt của chế độ Lập lịch (AD-32, P2–P5): buổi dự kiến, nhịp, giai đoạn, "Lặp tuần/tháng này".
 * Mọi thao tác ở đây chỉ chạm bản nháp hoặc quy tắc; buổi đã gửi chỉ đổi qua Dời lịch/Đổi địa điểm ở máy chủ.
 */

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
};
const dmy = (s: string) => {
  const d = fromYmd(s);
  return `${dm(d)}/${d.getFullYear()}`;
};
const DAYS = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chúa Nhật'];
const COLOR_LABEL: Record<PlanPeriodDto['color'], string> = {
  green: 'Xanh lá',
  gold: 'Vàng',
  blue: 'Xanh dương',
  orange: 'Cam',
  violet: 'Tím',
  red: 'Đỏ',
  teal: 'Xanh ngọc',
  gray: 'Xám',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid hint plan-field">
      {label}
      {children}
    </label>
  );
}

// ---------------------------------------------------------------- buổi dự kiến / cần quyết

export function OccurrenceSheet({
  item,
  series,
  orgId,
  onDone,
  onClose,
  onEditSeries,
}: {
  item: Ev;
  series: EventSeriesDto | undefined;
  orgId: string;
  onDone: (msg?: string) => void;
  onClose: () => void;
  onEditSeries: (s: EventSeriesDto) => void;
}) {
  const o = item.occurrence!;
  const act = useAction();
  const [time, setTime] = useState(timeLabel(o.startsAt));
  const canManage = !!series?.canManage;
  const variant = series?.variants.find((v) => v.id === o.variantId);
  const date = { kind: 'date' as const, date: o.date };
  const d = fromYmd(o.date);
  return (
    <Sheet title={o.title} onClose={onClose}>
      <p>
        {DAYS[weekdayIso(o.date)]} {dmy(o.date)} · {timeLabel(o.startsAt)}–{timeLabel(o.endsAt)}
      </p>
      <p className="hint small">
        {o.state === 'skipped' ? 'Buổi này đã được bỏ qua.' : 'Buổi dự kiến của nhịp: chưa phải bản nháp, chưa ai thấy.'}
        {series ? ` Nhịp "${series.name}" (${ruleLabel(series.rule)}).` : ''}
      </p>
      {o.conflict && (
        <div className="banner warn">
          {o.conflict.reason === 'special_day' ? `Trùng ngày đặc biệt "${o.conflict.label}".` : `Trùng giờ với buổi "${o.conflict.label}".`} Chọn giữ, bỏ hoặc đổi giờ.
        </div>
      )}
      {variant && <p className="hint small">Đang áp dụng: {variantText(variant.action)} ({selectorLabel(variant.selector, [])}).</p>}
      {act.error && <p className="error">{act.error}</p>}
      {canManage && (
        <div className="grid">
          {o.state !== 'skipped' && (
            <button className="button primary" disabled={act.busy} onClick={() => act.run(() => api.materialize(orgId, { from: o.date, to: o.date, only: [{ seriesId: o.seriesId, date: o.date }] }), () => onDone('Đã tạo bản nháp'))}>
              Tạo bản nháp buổi này
            </button>
          )}
          {o.conflict && (
            <button className="button" disabled={act.busy} onClick={() => act.run(() => api.addVariant(o.seriesId, { selector: date, action: { type: 'keep' } }), () => onDone('Đã giữ cả hai'))}>
              Giữ cả hai
            </button>
          )}
          {o.state !== 'skipped' ? (
            <button className="button" disabled={act.busy} onClick={() => act.run(() => api.addVariant(o.seriesId, { selector: date, action: { type: 'skip' } }), () => onDone(`Đã bỏ buổi ${dm(d)}`))}>
              Bỏ buổi này
            </button>
          ) : (
            variant?.selector.kind === 'date' && (
              <button className="button" disabled={act.busy} onClick={() => act.run(() => api.removeVariant(variant.id), () => onDone('Đã dùng lại buổi này'))}>
                Không bỏ nữa
              </button>
            )
          )}
          {o.state !== 'skipped' && (
            <div className="row">
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Giờ mới cho buổi này" />
              <button
                className="button small"
                disabled={act.busy || time === timeLabel(o.startsAt)}
                onClick={() => act.run(() => api.addVariant(o.seriesId, { selector: date, action: { type: 'override', localTime: time } }), () => onDone(`Đã đổi giờ buổi ${dm(d)}`))}
              >
                Đổi giờ buổi này
              </button>
            </div>
          )}
          {variant?.selector.kind === 'date' && o.state !== 'skipped' && (
            <button className="button" disabled={act.busy} onClick={() => act.run(() => api.removeVariant(variant.id), () => onDone('Đã trở về theo nhịp'))}>
              Trở về theo nhịp
            </button>
          )}
          {series && (
            <button className="link-button" onClick={() => onEditSeries(series)}>
              Sửa cả nhịp…
            </button>
          )}
        </div>
      )}
      {!canManage && <p className="hint small">Bạn không quản lý nhóm của nhịp này nên chỉ xem được.</p>}
    </Sheet>
  );
}

function variantText(a: EventSeriesDto['variants'][number]['action']) {
  if (a.type === 'skip') return 'bỏ qua';
  if (a.type === 'keep') return 'giữ dù trùng';
  return [a.title && `đổi thành "${a.title}"`, a.localTime && `giờ ${a.localTime}`, a.definition && 'định nghĩa riêng'].filter(Boolean).join(', ') || 'thay đổi';
}

// ---------------------------------------------------------------- tạo / sửa nhịp

export function NewSeriesSheet({ orgId, defaultStart, yearEnd, onDone, onClose }: { orgId: string; defaultStart: Date; yearEnd: string; onDone: (msg?: string) => void; onClose: () => void }) {
  const templates = useLoad(() => api.templates(orgId), [orgId]);
  const act = useAction();
  const [templateId, setTemplateId] = useState('');
  const [name, setName] = useState('');
  const [freq, setFreq] = useState<'weekly' | 'monthly'>('weekly');
  const [startsOn, setStartsOn] = useState(ymd(defaultStart));
  const [interval, setInterval] = useState(1);
  const [nth, setNth] = useState(1);
  const [time, setTime] = useState('09:00');
  const [untilOn, setUntilOn] = useState(yearEnd);
  const [location, setLocation] = useState('');
  const wd = weekdayIso(startsOn);
  const rule: SeriesRule = freq === 'weekly' ? { freq, interval, weekday: wd } : { freq, nth, weekday: wd };
  return (
    <Sheet title="Nhịp mới" onClose={onClose}>
      <p className="hint small">Nhịp lấy vị trí, nhóm và việc từ một mẫu. Các buổi hiện là "dự kiến" cho tới khi bạn bấm Tạo bản nháp.</p>
      {templates.data && !templates.data.length && <p className="hint small">Chưa có mẫu. Mở một buổi rồi chọn "Lưu làm mẫu", hoặc dùng "Lặp tuần này" ở mức Tuần.</p>}
      <form
        className="grid"
        onSubmit={(e) => {
          e.preventDefault();
          void act.run(
            () => api.createSeries(orgId, { templateId, name: name.trim() || undefined, rule, localTime: time, startsOn, untilOn: untilOn || null, location: location.trim() || null }),
            () => onDone('Đã tạo nhịp'),
          );
        }}
      >
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} required aria-label="Mẫu">
          <option value="">Chọn mẫu…</option>
          {templates.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.definition.positions.length} vị trí, {t.definition.durationMin} phút)
            </option>
          ))}
        </select>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên nhịp (để trống = tên mẫu)" maxLength={200} />
        <Field label="Bắt đầu từ ngày">
          <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} required />
        </Field>
        <div className="row">
          <label className="row">
            <input type="radio" checked={freq === 'weekly'} onChange={() => setFreq('weekly')} /> Hằng tuần
          </label>
          <label className="row">
            <input type="radio" checked={freq === 'monthly'} onChange={() => setFreq('monthly')} /> Hằng tháng
          </label>
        </div>
        {freq === 'weekly' ? (
          <Field label="Lặp">
            <select value={interval} onChange={(e) => setInterval(Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? `Mỗi ${DAYS[wd]}` : `${DAYS[wd]}, cách ${n} tuần`}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Lần trong tháng">
            <select value={nth} onChange={(e) => setNth(Number(e.target.value))}>
              {[1, 2, 3, 4, -1].map((n) => (
                <option key={n} value={n}>
                  {DAYS[wd]} {n === -1 ? 'cuối tháng' : `thứ ${n}`}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="row">
          <Field label="Giờ">
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
          </Field>
          <Field label="Tới ngày (trống = không hạn)">
            <input type="date" value={untilOn} onChange={(e) => setUntilOn(e.target.value)} min={startsOn} />
          </Field>
        </div>
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Địa điểm" maxLength={300} />
        {act.error && <p className="error">{act.error}</p>}
        <button className="button primary" disabled={act.busy || !templateId}>
          Tạo nhịp {ruleLabel(rule)} {time}
        </button>
      </form>
    </Sheet>
  );
}

export function SeriesSheet({ series, periods, onDone, onClose }: { series: EventSeriesDto; periods: PlanPeriodDto[]; onDone: (msg?: string) => void; onClose: () => void }) {
  const act = useAction();
  const today = ymd(new Date());
  const [scope, setScope] = useState<'all' | 'from'>('all');
  const [fromOn, setFromOn] = useState(today > series.startsOn ? today : series.startsOn);
  const [name, setName] = useState(series.name);
  const [time, setTime] = useState(series.localTime);
  const [duration, setDuration] = useState(series.definition.durationMin);
  const [location, setLocation] = useState(series.location ?? '');
  /** Ngừng nhịp (giữ buổi) hoặc xoá nhịp cùng mọi buổi đã tạo, kể cả đã qua (AD-33) — luôn qua hộp xác nhận. */
  const removeSeries = async () => {
    const r = await api.seriesRemoval(series.id).catch(() => null);
    const parts = r
      ? [
          r.drafts && `${r.drafts} bản nháp`,
          r.upcomingPublished && `${r.upcomingPublished} buổi sắp tới đã gửi (${r.peopleToNotify} người sẽ được báo huỷ)`,
          r.past && `${r.past} buổi đã qua hoặc đã huỷ`,
        ].filter(Boolean)
      : [];
    const op = await dialogs.choose<'keep' | 'all'>({
      title: `Nhịp "${series.name}"`,
      message: r ? (r.total ? `Nhịp đã tạo ${r.total} buổi: ${parts.join(', ')}.` : 'Nhịp chưa tạo buổi nào.') : undefined,
      options: [
        { label: 'Ngừng nhịp, giữ các buổi đã tạo', detail: 'Không dự kiến thêm buổi mới', value: 'keep' },
        ...(r && r.total > 0
          ? [{ label: `Xoá nhịp và ${r.total} buổi đã tạo`, detail: r.blocked ? `Có ${r.blocked} buổi bạn không có quyền xoá` : 'Dùng khi tạo trùng; buổi đã qua cũng ẩn khỏi lịch', value: 'all' as const, danger: true }]
          : []),
      ],
    });
    if (!op) return;
    const ok = await dialogs.confirm(
      op === 'keep'
        ? { title: 'Ngừng nhịp này?', message: 'Các buổi đã tạo giữ nguyên; không có buổi dự kiến mới.', confirmLabel: 'Ngừng nhịp', danger: true }
        : {
            title: `Xoá nhịp và ${r!.total} buổi?`,
            message: `${r!.upcomingPublished ? `${r!.peopleToNotify} người được xếp ở buổi sắp tới sẽ nhận thông báo huỷ. ` : ''}Mọi buổi của nhịp ẩn khỏi lịch; lịch sử vẫn giữ. Không hoàn tác được.`,
            confirmLabel: 'Xoá tất cả',
            danger: true,
          },
    );
    if (ok) void act.run(() => api.archiveSeries(series.id, op), (x) => onDone(op === 'keep' ? 'Đã ngừng nhịp' : `Đã xoá nhịp và ${x.removedEvents} buổi`));
  };
  const [untilOn, setUntilOn] = useState(series.untilOn ?? '');
  const [impact, setImpact] = useState<SeriesImpactDto | null>(null);
  const change: SeriesChange = {
    scope,
    ...(scope === 'from' ? { fromOn } : {}),
    ...(name.trim() !== series.name ? { name: name.trim() } : {}),
    ...(time !== series.localTime ? { localTime: time } : {}),
    ...(duration !== series.definition.durationMin ? { durationMin: duration } : {}),
    ...((location.trim() || null) !== series.location ? { location: location.trim() || null } : {}),
    ...((untilOn || null) !== series.untilOn ? { untilOn: untilOn || null } : {}),
  };
  const dirty = Object.keys(change).some((k) => k !== 'scope' && k !== 'fromOn');
  const reset = () => setImpact(null);
  return (
    <Sheet title={`Nhịp "${series.name}"`} onClose={onClose}>
      <p className="hint small">
        {ruleLabel(series.rule)} {series.localTime} · từ {dmy(series.startsOn)}
        {series.untilOn ? ` tới ${dmy(series.untilOn)}` : ''} · {series.definition.positions.length} vị trí
      </p>
      {series.canManage ? (
        <form
          className="grid"
          onSubmit={(e) => {
            e.preventDefault();
            void act.run(
              () => api.updateSeries(series.id, { ...change, expectedVersion: series.version }),
              (r) => onDone(r.applied ? `Đã sửa nhịp và ${r.applied} buổi đã tạo` : 'Đã sửa nhịp'),
            );
          }}
        >
          <input value={name} onChange={(e) => (setName(e.target.value), reset())} maxLength={200} aria-label="Tên nhịp" required />
          <div className="row">
            <Field label="Giờ">
              <input type="time" value={time} onChange={(e) => (setTime(e.target.value), reset())} required />
            </Field>
            <Field label="Thời lượng (phút)">
              <input type="number" min={5} step={5} value={duration} onChange={(e) => (setDuration(Number(e.target.value)), reset())} />
            </Field>
          </div>
          <input value={location} onChange={(e) => (setLocation(e.target.value), reset())} placeholder="Địa điểm" maxLength={300} />
          <Field label="Tới ngày (trống = không hạn)">
            <input type="date" value={untilOn} min={series.startsOn} onChange={(e) => (setUntilOn(e.target.value), reset())} />
          </Field>
          <fieldset className="grid">
            <legend className="hint">Áp dụng cho</legend>
            <label className="row">
              <input type="radio" checked={scope === 'all'} onChange={() => (setScope('all'), reset())} /> Cả nhịp (các buổi chưa diễn ra)
            </label>
            <label className="row">
              <input type="radio" checked={scope === 'from'} onChange={() => (setScope('from'), reset())} /> Từ ngày
              <input type="date" value={fromOn} min={today} onChange={(e) => (setFromOn(e.target.value), setScope('from'), reset())} aria-label="Từ ngày" />
            </label>
          </fieldset>
          {impact ? (
            <div className="banner info">
              Ảnh hưởng: {impact.projected} buổi dự kiến, {impact.drafts} bản nháp
              {impact.published > 0 && `, ${impact.published} buổi đã gửi (${impact.people} người sẽ được báo dời lịch)`}
              {impact.detached > 0 && `. ${impact.detached} buổi đã sửa riêng giữ nguyên`}.
            </div>
          ) : (
            dirty && (
              <button type="button" className="button" disabled={act.busy} onClick={() => act.run(() => api.previewSeries(series.id, change), setImpact)}>
                Xem ảnh hưởng
              </button>
            )
          )}
          {act.error && <p className="error">{act.error}</p>}
          <button className="button primary" disabled={act.busy || !dirty || !impact}>
            Lưu thay đổi
          </button>
        </form>
      ) : (
        <p className="hint small">Bạn không quản lý nhóm của nhịp này nên chỉ xem được.</p>
      )}
      <h3 className="plan-h">Ngoại lệ</h3>
      {!series.variants.length && <p className="hint small">Chưa có. Chạm một buổi dự kiến để bỏ, đổi giờ, hoặc giữ khi trùng.</p>}
      <ul className="list">
        {series.variants.map((v) => (
          <li key={v.id} className="row spread plan-variant">
            <span className="grow">
              {cap(selectorLabel(v.selector, periods))}: {variantText(v.action)}
            </span>
            {series.canManage && (
              <button
                className="button small"
                disabled={act.busy}
                onClick={() =>
                  confirmThen({ title: 'Xoá ngoại lệ này?', message: `${cap(selectorLabel(v.selector, periods))}: ${variantText(v.action)}. Các buổi đó sẽ trở về theo nhịp.`, confirmLabel: 'Xoá', danger: true }, () =>
                    act.run(() => api.removeVariant(v.id), () => onDone('Đã xoá ngoại lệ')),
                  )
                }
              >
                Xoá
              </button>
            )}
          </li>
        ))}
      </ul>
      {series.canManage && periods.some((p) => p.kind === 'period') && <PeriodVariant series={series} periods={periods} onDone={onDone} />}
      {series.canManage && (
        <button className="button danger" disabled={act.busy} onClick={() => void removeSeries()}>
          Ngừng hoặc xoá nhịp…
        </button>
      )}
    </Sheet>
  );
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Ngoại lệ theo Giai đoạn: bỏ, hoặc đổi giờ trong suốt giai đoạn (vd. Mùa hè học Kinh Thánh 8:00). */
function PeriodVariant({ series, periods, onDone }: { series: EventSeriesDto; periods: PlanPeriodDto[]; onDone: (msg?: string) => void }) {
  const act = useAction();
  const options = periods.filter((p) => p.kind === 'period');
  const [periodId, setPeriodId] = useState(options[0]!.id);
  const [mode, setMode] = useState<'skip' | 'time'>('time');
  const [time, setTime] = useState(series.localTime);
  return (
    <div className="grid plan-subform">
      <span className="hint small">Ngoại lệ trong một giai đoạn</span>
      <div className="row">
        <select value={periodId} onChange={(e) => setPeriodId(e.target.value)} aria-label="Giai đoạn">
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={mode} onChange={(e) => setMode(e.target.value as 'skip' | 'time')} aria-label="Thay đổi">
          <option value="time">đổi giờ</option>
          <option value="skip">nghỉ</option>
        </select>
        {mode === 'time' && <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Giờ trong giai đoạn" />}
        <button
          className="button small"
          disabled={act.busy}
          onClick={() =>
            act.run(
              () => api.addVariant(series.id, { selector: { kind: 'period', periodId }, action: mode === 'skip' ? { type: 'skip' } : { type: 'override', localTime: time } }),
              () => onDone('Đã thêm ngoại lệ'),
            )
          }
        >
          Thêm
        </button>
      </div>
      {act.error && <p className="error">{act.error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- giai đoạn

export function PeriodSheet({ orgId, period, defaultStart, onDone, onClose }: { orgId: string; period?: PlanPeriodDto; defaultStart: Date; onDone: (msg?: string) => void; onClose: () => void }) {
  const act = useAction();
  const [kind, setKind] = useState<PlanPeriodDto['kind']>(period?.kind ?? 'period');
  const [name, setName] = useState(period?.name ?? '');
  const [startsOn, setStartsOn] = useState(period?.startsOn ?? ymd(defaultStart));
  const [endsOn, setEndsOn] = useState(period?.endsOn ?? ymd(new Date(defaultStart.getFullYear(), defaultStart.getMonth() + 3, 0)));
  const [color, setColor] = useState<PlanPeriodDto['color']>(period?.color ?? 'green');
  const [note, setNote] = useState(period?.note ?? '');
  const body = { name: name.trim(), kind, startsOn, endsOn: kind === 'special_day' ? startsOn : endsOn, color, note: note.trim() || null };
  return (
    <Sheet title={period ? `Sửa "${period.name}"` : 'Giai đoạn mới'} onClose={onClose}>
      <p className="hint small">Giai đoạn là khoảng ngày có tên (Mùa Vọng, Hè, Quý 1…); ngày đặc biệt là một ngày (Giáng sinh, Tết). Buổi của nhịp rơi vào ngày đặc biệt sẽ hiện "cần quyết".</p>
      <form
        className="grid"
        onSubmit={(e) => {
          e.preventDefault();
          void act.run(() => (period ? api.updatePeriod(period.id, { ...body, expectedVersion: period.version }) : api.createPeriod(orgId, body)), () => onDone(period ? 'Đã sửa giai đoạn' : 'Đã thêm giai đoạn'));
        }}
      >
        <div className="row">
          <label className="row">
            <input type="radio" checked={kind === 'period'} onChange={() => setKind('period')} /> Giai đoạn
          </label>
          <label className="row">
            <input type="radio" checked={kind === 'special_day'} onChange={() => (setKind('special_day'), color === 'green' && setColor('gold'))} /> Ngày đặc biệt
          </label>
        </div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'period' ? 'Tên (vd. Mùa hè)' : 'Tên (vd. Giáng sinh)'} maxLength={120} required />
        <div className="row">
          <Field label={kind === 'period' ? 'Từ ngày' : 'Ngày'}>
            <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} required />
          </Field>
          {kind === 'period' && (
            <Field label="Tới ngày">
              <input type="date" value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)} required />
            </Field>
          )}
        </div>
        <div className="row plan-colors" role="radiogroup" aria-label="Màu">
          {PERIOD_COLORS.map((c) => (
            <button type="button" key={c} role="radio" aria-checked={c === color} aria-label={COLOR_LABEL[c]} className={`pcolor pc-${c}${c === color ? ' on' : ''}`} onClick={() => setColor(c)} />
          ))}
        </div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú (mục tiêu, chủ đề…)" rows={2} maxLength={2000} />
        {act.error && <p className="error">{act.error}</p>}
        <button className="button primary" disabled={act.busy}>
          {period ? 'Lưu' : 'Thêm'}
        </button>
        {period && (
          <button
            type="button"
            className="button danger"
            disabled={act.busy}
            onClick={() =>
              confirmThen({ title: `Xoá "${period.name}"?`, message: 'Các buổi đã tạo giữ nguyên; ngoại lệ gắn với giai đoạn này thôi áp dụng.', confirmLabel: 'Xoá', danger: true }, () =>
                act.run(() => api.archivePeriod(period.id), () => onDone('Đã xoá giai đoạn')),
              )
            }
          >
            Xoá giai đoạn
          </button>
        )}
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------- lặp tuần / tháng

export function RepeatWeekSheet({ orgId, events, yearEnd, onDone, onClose }: { orgId: string; events: Ev[]; yearEnd: string; onDone: (msg?: string) => void; onClose: () => void }) {
  const act = useAction();
  const candidates = events.filter((e) => !e.seriesId && !e.occurrence && e.status !== 'cancelled');
  const [picked, setPicked] = useState(() => new Set(candidates.map((e) => e.id)));
  const [interval, setInterval] = useState(1);
  const [untilOn, setUntilOn] = useState(yearEnd);
  const toggle = (id: string) => setPicked((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));
  return (
    <Sheet title="Lặp tuần này" onClose={onClose}>
      <p className="hint small">Mỗi buổi được chọn thành một nhịp cùng thứ, cùng giờ, cùng vị trí và việc. Buổi các tuần sau hiện "dự kiến" để bạn xem trước khi tạo bản nháp.</p>
      {!candidates.length && <p className="hint">Mọi buổi trong tuần đã thuộc một nhịp.</p>}
      <ul className="list">
        {candidates.map((e) => (
          <li key={e.id}>
            <label className="series-row">
              <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} />
              <span className="grid grow">
                <strong>{e.title}</strong>
                <span className="hint small">
                  {WEEKDAYS[weekdayIso(ymd(new Date(e.startsAt)))]} {timeLabel(e.startsAt)}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {candidates.length > 0 && (
        <>
          <div className="row">
            <Field label="Lặp">
              <select value={interval} onChange={(e) => setInterval(Number(e.target.value))}>
                <option value={1}>Mỗi tuần</option>
                <option value={2}>Cách 2 tuần</option>
                <option value={4}>Cách 4 tuần</option>
              </select>
            </Field>
            <Field label="Tới ngày">
              <input type="date" value={untilOn} onChange={(e) => setUntilOn(e.target.value)} />
            </Field>
          </div>
          {act.error && <p className="error">{act.error}</p>}
          <button
            className="button primary"
            disabled={act.busy || !picked.size}
            onClick={() => act.run(() => api.seriesFromEvents(orgId, { items: [...picked].map((eventId) => ({ eventId })), interval, untilOn: untilOn || null }), (r) => onDone(`Đã tạo ${r.length} nhịp`))}
          >
            Tạo {picked.size} nhịp
          </button>
        </>
      )}
    </Sheet>
  );
}

const KIND_LABEL: Record<MonthProposalDto['kind'], string> = { weekly: 'Hằng tuần', monthly: 'Hằng tháng', variant: 'Ngoại lệ của nhịp tuần', covered: 'Đã có nhịp' };

export function RepeatMonthSheet({ orgId, month, yearEnd, onDone, onClose }: { orgId: string; month: Date; yearEnd: string; onDone: (msg?: string) => void; onClose: () => void }) {
  const key = ymd(month).slice(0, 7);
  const props = useLoad(() => api.monthProposals(orgId, key), [orgId, key]);
  const act = useAction();
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [untilOn, setUntilOn] = useState(yearEnd);
  const list = props.data ?? [];
  const usable = list.filter((p) => p.kind !== 'covered');
  const sel = picked ?? new Set(usable.filter((p) => !p.note.startsWith('Rơi vào ngày đặc biệt')).map((p) => p.eventId));
  const toggle = (p: MonthProposalDto) => {
    const s = new Set(sel);
    if (s.has(p.eventId)) s.delete(p.eventId);
    else {
      s.add(p.eventId);
      // Ngoại lệ cần nhịp tuần mà nó gắn vào.
      if (p.kind === 'variant' && p.variantOfEventId && list.some((x) => x.eventId === p.variantOfEventId && x.kind === 'weekly')) s.add(p.variantOfEventId);
    }
    if (p.kind === 'weekly' && !s.has(p.eventId)) for (const v of list) if (v.variantOfEventId === p.eventId) s.delete(v.eventId);
    setPicked(s);
  };
  return (
    <Sheet title={`Lặp tháng ${month.getMonth() + 1}`} onClose={onClose}>
      <p className="hint small">Đọc tháng này thành quy tắc: buổi có mỗi tuần → nhịp tuần; buổi một lần → "thứ n của tháng", hoặc ngoại lệ của nhịp tuần cùng giờ (vd. CN đầu tháng là Tiệc thánh).</p>
      {props.error && <p className="error">{props.error}</p>}
      {props.data && !usable.length && <p className="hint">Tháng này không có buổi nào cần lặp (đã có nhịp hoặc chưa có buổi).</p>}
      <ul className="list">
        {list.map((p) => {
          const n = p.kind === 'weekly' ? null : nthOfMonth(ymd(new Date(p.startsAt)));
          return (
            <li key={p.eventId}>
              <label className="series-row">
                <input type="checkbox" disabled={p.kind === 'covered'} checked={sel.has(p.eventId)} onChange={() => toggle(p)} />
                <span className="grid grow">
                  <strong>{p.title}</strong>
                  <span className="hint small">
                    {KIND_LABEL[p.kind]} · {ruleLabel(p.rule)} {timeLabel(p.startsAt)}
                    {n && p.kind !== 'covered' ? ` · từ buổi ${dm(new Date(p.startsAt))}` : ''}
                  </span>
                  <span className="hint small">{p.note}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {usable.length > 0 && (
        <>
          <Field label="Tới ngày">
            <input type="date" value={untilOn} onChange={(e) => setUntilOn(e.target.value)} />
          </Field>
          {act.error && <p className="error">{act.error}</p>}
          <button
            className="button primary"
            disabled={act.busy || !sel.size}
            onClick={() =>
              act.run(
                () =>
                  api.seriesFromMonth(orgId, {
                    items: usable.filter((p) => sel.has(p.eventId)).map((p) => ({ eventId: p.eventId, kind: p.kind as 'weekly' | 'monthly' | 'variant', rule: p.rule, variantOfEventId: p.variantOfEventId })),
                    untilOn: untilOn || null,
                  }),
                (r) => onDone(`Đã tạo ${r.series.length} nhịp${r.variants.length ? `, ${r.variants.length} ngoại lệ` : ''}`),
              )
            }
          >
            Áp dụng {sel.size} mục
          </button>
        </>
      )}
    </Sheet>
  );
}
