import type { EventDto, MemberDto, PositionDto } from '@collab/shared';
import { useEffect, useState } from 'react';
import { api, type EventPatch } from '../lib/api';
import { addMinutes, fromLocalInput, rangeLabel, timeLabel, toLocalInput } from '../lib/datetime';
import { useRealtime } from '../lib/realtime';
import { go, href } from '../lib/route';
import { useAction, useLoad } from '../lib/useLoad';
import { ChatPanel } from './ChatPanel';
import { assignmentStatusLabel, eventStatusLabel } from './EventLabels';
import { NotAvailable } from './OrgPage';

/** Trang buổi (F3, F4): thông tin, vị trí phục vụ, xếp người, thread trao đổi. */
export function EventPage({ eventId, meId }: { eventId: string; meId: string }) {
  const ev = useLoad(() => api.event(eventId), [eventId]);
  const orgId = ev.data?.orgId;
  const canStaff = Boolean(ev.data && (ev.data.canEdit || ev.data.positions.some((p) => p.canManage) || ev.data.canAddPositions));
  const members = useLoad(() => (orgId && canStaff ? api.members(orgId) : Promise.resolve([] as MemberDto[])), [orgId, canStaff]);
  useRealtime([`user:${meId}`, `event:${eventId}`], ev.reload);
  const act = useAction();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Mở buổi → các thông báo về buổi này thành đã đọc ("Cần bạn" vẫn chờ tới khi trả lời).
  useEffect(() => {
    void api.readTarget('event', eventId).catch(() => undefined);
  }, [eventId]);

  if (ev.error) return <NotAvailable />;
  if (!ev.data) return <p className="center">Đang tải…</p>;
  const e = ev.data;
  const isDraft = e.status === 'draft';

  // Người có thể nhắc tên trong thread: người phụ trách và người được xếp (máy chủ kiểm lại quyền xem).
  const people = new Map<string, string>();
  for (const o of e.owners) people.set(o.userId, o.displayName);
  for (const p of e.positions) for (const a of p.assignments) if (a.status !== 'draft') people.set(a.userId, a.displayName);

  return (
    <>
      <section className="card">
        <a href={href({ name: 'org', id: e.orgId })} className="hint">
          ← Lịch
        </a>
        <h1>
          {e.title} {e.status !== 'published' && <span className="tag">{eventStatusLabel[e.status]}</span>}
        </h1>
        <p>
          {rangeLabel(e.startsAt, e.endsAt)}
          {e.location && <span className="hint"> · {e.location}</span>}
        </p>
        {e.description && <p className="pre">{e.description}</p>}
        <p className="hint">
          {e.groups.length > 0 && <>Nhóm: {e.groups.map((g) => g.name).join(', ')} · </>}
          {e.visibility === 'org' ? 'Cả tổ chức thấy' : 'Chỉ nhóm tham gia và người được xếp thấy'}
          {' · '}Phụ trách: {e.owners.map((o) => o.displayName).join(', ')}
        </p>
        {notice && <p className="hint">{notice}</p>}
        {act.error && <p className="error">{act.error}</p>}
        {e.canEdit && (
          <div className="row">
            {isDraft && (
              <button
                className="button primary"
                disabled={act.busy}
                onClick={() =>
                  window.confirm('Công bố buổi này? Mọi người đã xếp sẽ nhận yêu cầu phục vụ.') &&
                  void act.run(
                    () => api.publishEvent(eventId, e.version),
                    (r) => (setNotice(`Đã công bố. ${r.requestedCount} người nhận yêu cầu phục vụ.`), ev.reload()),
                  )
                }
              >
                Công bố
              </button>
            )}
            {e.status !== 'cancelled' && (
              <button className="button small" onClick={() => setEditing((x) => !x)}>
                {editing ? 'Đóng sửa' : 'Sửa thông tin'}
              </button>
            )}
            <a className="button small" href={href({ name: 'newevent', id: e.orgId, copy: e.id })}>
              Sao chép
            </a>
            <button
              className="button small"
              disabled={act.busy}
              onClick={() => {
                const name = window.prompt('Tên mẫu', e.title);
                if (name) void act.run(() => api.templateFromEvent(eventId, name), () => setNotice(`Đã lưu mẫu "${name}".`));
              }}
            >
              Lưu làm mẫu
            </button>
            {isDraft && (
              <button
                className="button small danger"
                disabled={act.busy}
                onClick={() => window.confirm('Xoá bản nháp này?') && void act.run(() => api.deleteDraft(eventId, e.version), () => go({ name: 'org', id: e.orgId }))}
              >
                Xoá nháp
              </button>
            )}
          </div>
        )}
        {!isDraft && <Follow eventId={eventId} />}
        {editing && e.canEdit && <EditEvent e={e} onSaved={() => (setEditing(false), ev.reload())} />}
        {e.canEdit && editing && <Owners e={e} members={members.data ?? []} onChanged={ev.reload} />}
      </section>

      <section className="card">
        <h2>Vị trí phục vụ</h2>
        {e.positions.length === 0 && <p className="hint">Chưa có vị trí.</p>}
        {e.positions.map((p) => (
          <Position key={p.id} p={p} e={e} members={members.data ?? []} onChanged={ev.reload} onWarn={setNotice} />
        ))}
        {e.canAddPositions && e.status !== 'cancelled' && <AddPosition e={e} onAdded={ev.reload} />}
      </section>

      {e.conversationId && (
        <section className="card">
          <h2>Trao đổi về buổi này</h2>
          <ChatPanel
            key={e.conversationId}
            conversationId={e.conversationId}
            meId={meId}
            members={[...people].map(([userId, displayName]) => ({ userId, displayName }))}
          />
        </section>
      )}
      {isDraft && <p className="hint center">Thread trao đổi mở khi buổi được công bố.</p>}
    </>
  );
}

function EditEvent({ e, onSaved }: { e: EventDto; onSaved: () => void }) {
  const act = useAction();
  const isDraft = e.status === 'draft';
  const [title, setTitle] = useState(e.title);
  const [description, setDescription] = useState(e.description ?? '');
  const [location, setLocation] = useState(e.location ?? '');
  const [startsAt, setStartsAt] = useState(toLocalInput(e.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInput(e.endsAt));
  return (
    <form
      className="grid"
      onSubmit={(ev) => {
        ev.preventDefault();
        const patch: EventPatch = { title, description, location };
        if (isDraft) Object.assign(patch, { startsAt: fromLocalInput(startsAt), endsAt: fromLocalInput(endsAt) });
        void act.run(() => api.updateEvent(e.id, { ...patch, expectedVersion: e.version }), onSaved);
      }}
    >
      <input value={title} onChange={(x) => setTitle(x.target.value)} required maxLength={200} />
      <textarea value={description} onChange={(x) => setDescription(x.target.value)} placeholder="Mô tả" rows={3} />
      {/* Đã công bố: dời giờ/địa điểm phải qua luồng thông báo thay đổi (F7, lát sau). */}
      <input value={location} onChange={(x) => setLocation(x.target.value)} placeholder="Địa điểm" disabled={!isDraft} />
      {isDraft ? (
        <div className="row">
          <input type="datetime-local" value={startsAt} onChange={(x) => setStartsAt(x.target.value)} />
          <input type="datetime-local" value={endsAt} onChange={(x) => setEndsAt(x.target.value)} />
        </div>
      ) : (
        <p className="hint">Đổi giờ, địa điểm của buổi đã công bố sẽ có ở bước "Dời lịch" (thông báo cho mọi người).</p>
      )}
      {act.error && <p className="error">{act.error}</p>}
      <button className="button" disabled={act.busy}>
        Lưu
      </button>
    </form>
  );
}

function Owners({ e, members, onChanged }: { e: EventDto; members: MemberDto[]; onChanged: () => void }) {
  const act = useAction();
  const [pick, setPick] = useState('');
  const ownerIds = new Set(e.owners.map((o) => o.userId));
  return (
    <div className="grid">
      <h2>Người phụ trách</h2>
      <ul className="list">
        {e.owners.map((o) => (
          <li key={o.userId}>
            {o.displayName}
            {e.owners.length > 1 && (
              <button className="button small danger" disabled={act.busy} onClick={() => void act.run(() => api.changeOwners(e.id, { expectedVersion: e.version, remove: [o.userId] }), onChanged)}>
                Bỏ
              </button>
            )}
          </li>
        ))}
      </ul>
      <form
        className="row"
        onSubmit={(x) => {
          x.preventDefault();
          if (pick) void act.run(() => api.changeOwners(e.id, { expectedVersion: e.version, add: [pick] }), () => (setPick(''), onChanged()));
        }}
      >
        <select value={pick} onChange={(x) => setPick(x.target.value)}>
          <option value="">Thêm người phụ trách…</option>
          {members.filter((m) => !ownerIds.has(m.userId)).map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.displayName}
            </option>
          ))}
        </select>
        <button className="button small" disabled={act.busy || !pick}>
          Thêm
        </button>
      </form>
      {act.error && <p className="error">{act.error}</p>}
    </div>
  );
}

function Position({
  p,
  e,
  members,
  onChanged,
  onWarn,
}: {
  p: PositionDto;
  e: EventDto;
  members: MemberDto[];
  onChanged: () => void;
  onWarn: (s: string | null) => void;
}) {
  const act = useAction();
  const [pick, setPick] = useState('');
  const editable = p.canManage && e.status !== 'cancelled';
  const taken = new Set(p.assignments.filter((a) => a.status !== 'declined' && a.status !== 'cancelled').map((a) => a.userId));
  return (
    <div className="position">
      <div className="row spread">
        <strong>{p.name}</strong>
        <span className={p.filled < p.slots ? 'tag warn' : 'tag'}>
          {p.filled}/{p.slots}
        </span>
      </div>
      <p className="hint">
        {p.groupName ?? 'Không thuộc nhóm'}
        {p.reportOffsetMin !== 0 && ` · có mặt ${timeLabel(addMinutes(e.startsAt, p.reportOffsetMin))}`}
      </p>
      <ul className="list">
        {p.assignments.map((a) => (
          <li key={a.id}>
            <span>
              {a.displayName}
              {a.declineReason && <span className="hint"> · “{a.declineReason}”</span>}
            </span>
            <span className="row">
              <span className="hint">{assignmentStatusLabel[a.status]}</span>
              {editable && a.status === 'draft' && (
                <button className="button small danger" disabled={act.busy} onClick={() => void act.run(() => api.cancelDraftAssignment(a.id), onChanged)}>
                  Bỏ
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {editable && p.filled < p.slots && (
        <form
          className="row"
          onSubmit={(x) => {
            x.preventDefault();
            if (!pick) return;
            void act.run(
              () => api.assign(p.id, pick),
              (r) => {
                setPick('');
                const w = r.warnings[0];
                onWarn(w ? `Lưu ý: ${r.assignment.displayName} đã được xếp vào "${w.title}" trùng giờ.` : null);
                onChanged();
              },
            );
          }}
        >
          <select value={pick} onChange={(x) => setPick(x.target.value)}>
            <option value="">Xếp người…</option>
            {members.filter((m) => !taken.has(m.userId)).map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName}
              </option>
            ))}
          </select>
          <button className="button small" disabled={act.busy || !pick}>
            Xếp
          </button>
        </form>
      )}
      {editable && (
        <div className="row">
          <button
            className="button small"
            disabled={act.busy}
            onClick={() => {
              const n = Number(window.prompt('Số người cần', String(p.slots)));
              if (n > 0 && n !== p.slots) void act.run(() => api.updatePosition(p.id, { expectedVersion: p.version, slots: n }), onChanged);
            }}
          >
            Đổi số người
          </button>
          <button
            className="button small danger"
            disabled={act.busy}
            onClick={() => window.confirm(`Bỏ vị trí ${p.name}?${e.status === 'published' ? ' Người đã xếp sẽ được báo huỷ.' : ''}`) && void act.run(() => api.removePosition(p.id), onChanged)}
          >
            Bỏ vị trí
          </button>
        </div>
      )}
      {act.error && <p className="error">{act.error}</p>}
    </div>
  );
}

function AddPosition({ e, onAdded }: { e: EventDto; onAdded: () => void }) {
  const act = useAction();
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState(e.groups[0]?.id ?? '');
  const [slots, setSlots] = useState(1);
  const [offset, setOffset] = useState(0);
  return (
    <form
      className="grid"
      onSubmit={(x) => {
        x.preventDefault();
        void act.run(() => api.createPosition(e.id, { name, groupId: groupId || null, slots, reportOffsetMin: -offset }), () => (setName(''), onAdded()));
      }}
    >
      <h2>Thêm vị trí</h2>
      <input value={name} onChange={(x) => setName(x.target.value)} placeholder="Tên vị trí (vd. Âm thanh)" required maxLength={120} />
      <div className="row">
        <select value={groupId} onChange={(x) => setGroupId(x.target.value)}>
          {e.canEdit && <option value="">Không thuộc nhóm</option>}
          {e.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <label className="row hint">
          Số người <input type="number" min={1} max={100} value={slots} onChange={(x) => setSlots(Number(x.target.value))} style={{ width: 72 }} />
        </label>
        <label className="row hint">
          Có mặt trước (phút) <input type="number" min={0} step={5} value={offset} onChange={(x) => setOffset(Number(x.target.value))} style={{ width: 72 }} />
        </label>
      </div>
      {act.error && <p className="error">{act.error}</p>}
      <button className="button" disabled={act.busy || !name}>
        Thêm vị trí
      </button>
    </form>
  );
}

/** Theo dõi / tắt tiếng (NOTIFICATION_ENGINE §6): tắt tiếng không bỏ thông báo thuộc trách nhiệm của bạn. */
function Follow({ eventId }: { eventId: string }) {
  const sub = useLoad(() => api.subscription('event', eventId), [eventId]);
  const act = useAction();
  if (!sub.data) return null;
  return (
    <label className="row hint">
      Thông báo về buổi này:
      <select
        value={sub.data.mode ?? ''}
        disabled={act.busy}
        onChange={(x) => void act.run(() => api.setSubscription('event', eventId, (x.target.value || null) as 'follow' | 'mute' | null), sub.reload)}
      >
        <option value="">Mặc định</option>
        <option value="follow">Theo dõi mọi cập nhật</option>
        <option value="mute">Tắt tiếng (vẫn nhận việc cần bạn)</option>
      </select>
    </label>
  );
}
