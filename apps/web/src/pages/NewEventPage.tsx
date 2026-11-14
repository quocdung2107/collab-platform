import type { CreatedEventDto, EventVisibility } from '@collab/shared';
import { useState } from 'react';
import { api } from '../lib/api';
import { addMinutes, fromLocalInput, toLocalInput } from '../lib/datetime';
import { go, href } from '../lib/route';
import { useAction, useLoad } from '../lib/useLoad';

type Mode = 'blank' | 'template' | 'copy';

/** Tạo bản nháp (F3): trống, từ mẫu, hoặc sao chép buổi trước. */
export function NewEventPage({ orgId, copyFrom }: { orgId: string; copyFrom?: string }) {
  const groups = useLoad(() => api.groups(orgId), [orgId]);
  const templates = useLoad(() => api.templates(orgId), [orgId]);
  const source = useLoad(() => (copyFrom ? api.event(copyFrom) : Promise.resolve(null)), [copyFrom]);
  const act = useAction();
  const [mode, setMode] = useState<Mode>(copyFrom ? 'copy' : 'blank');
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [startsAt, setStartsAt] = useState(() => toLocalInput(nextSunday9am()));
  const [durationMin, setDurationMin] = useState(120);
  const [visibility, setVisibility] = useState<EventVisibility>('org');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [keepPeople, setKeepPeople] = useState(false);
  const [created, setCreated] = useState<CreatedEventDto | null>(null);

  const activeGroups = (groups.data ?? []).filter((g) => !g.archived);
  const toggle = (id: string) => setGroupIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const submit = () => {
    const start = fromLocalInput(startsAt);
    const body =
      mode === 'template'
        ? { templateId, startsAt: start, ...(title ? { title } : {}), ...(location ? { location } : {}) }
        : mode === 'copy' && copyFrom
          ? { copyFromId: copyFrom, startsAt: start, keepPeople }
          : { title, location: location || undefined, startsAt: start, endsAt: addMinutes(start, durationMin), visibility, groupIds };
    void act.run(
      () => api.createEvent(orgId, body),
      (r) => (r.warnings.length ? setCreated(r) : go({ name: 'event', id: r.event.id })),
    );
  };

  if (created) {
    return (
      <section className="card">
        <h1>Đã tạo bản nháp</h1>
        <ul>
          {created.warnings.map((w, i) => (
            <li key={i} className="hint">
              {w.code === 'archived_group_skipped' ? `Nhóm "${w.detail}" đã lưu trữ nên được bỏ qua.` : w.detail}
            </li>
          ))}
        </ul>
        <a className="button primary" href={href({ name: 'event', id: created.event.id })}>
          Mở buổi
        </a>
      </section>
    );
  }

  return (
    <section className="card">
      <a href={href({ name: 'org', id: orgId })} className="hint">
        ← Tổ chức
      </a>
      <h1>{mode === 'copy' ? `Sao chép "${source.data?.title ?? '…'}"` : 'Tạo buổi'}</h1>
      {!copyFrom && (
        <div className="row">
          <label className="row">
            <input type="radio" checked={mode === 'blank'} onChange={() => setMode('blank')} /> Trống
          </label>
          <label className="row">
            <input type="radio" checked={mode === 'template'} onChange={() => setMode('template')} disabled={!templates.data?.length} /> Từ mẫu
          </label>
        </div>
      )}
      <form
        className="grid"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {mode === 'template' && (
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} required>
            <option value="">Chọn mẫu…</option>
            {templates.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.definition.positions.length} vị trí, {t.definition.durationMin} phút)
              </option>
            ))}
          </select>
        )}
        {mode !== 'copy' && (
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={mode === 'template' ? 'Tên buổi (để trống = tên mẫu)' : 'Tên buổi'} required={mode === 'blank'} maxLength={200} />
        )}
        <label className="grid hint">
          Bắt đầu
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
        </label>
        {mode === 'blank' && (
          <>
            <label className="grid hint">
              Thời lượng (phút)
              <input type="number" min={5} step={5} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} />
            </label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Địa điểm" maxLength={300} />
            <fieldset className="grid">
              <legend className="hint">Nhóm tham gia</legend>
              {activeGroups.map((g) => (
                <label key={g.id} className="row">
                  <input type="checkbox" checked={groupIds.includes(g.id)} onChange={() => toggle(g.id)} /> {g.name}
                </label>
              ))}
            </fieldset>
            <label className="grid hint">
              Ai thấy buổi này
              <select value={visibility} onChange={(e) => setVisibility(e.target.value as EventVisibility)}>
                <option value="org">Cả tổ chức</option>
                <option value="groups">Chỉ các nhóm tham gia và người được xếp</option>
              </select>
            </label>
          </>
        )}
        {mode === 'copy' && (
          <label className="row">
            <input type="checkbox" checked={keepPeople} onChange={(e) => setKeepPeople(e.target.checked)} /> Giữ nguyên người (chỉ gửi khi công bố)
          </label>
        )}
        {act.error && <p className="error">{act.error}</p>}
        <button className="button primary" disabled={act.busy}>
          Tạo bản nháp
        </button>
        <p className="hint">Bản nháp chỉ người điều phối thấy. Mọi người chỉ nhận yêu cầu phục vụ khi bạn bấm Công bố.</p>
      </form>
    </section>
  );
}

function nextSunday9am(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}
