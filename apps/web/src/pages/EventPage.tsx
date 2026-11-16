import type { EventDto, MemberDto, PositionDto } from '@collab/shared';
import { useEffect, useState } from 'react';
import { api, type EventPatch } from '../lib/api';
import { downloadIcs } from '../lib/ics';
import { addMinutes, fromLocalInput, rangeLabel, timeLabel, toLocalInput } from '../lib/datetime';
import { useRealtime } from '../lib/realtime';
import { go, href } from '../lib/route';
import { useAction, useLoad } from '../lib/useLoad';
import { confirmThen, dialogs } from '../ui/dialogs';
import { Icon } from '../ui/icons';
import { Banner, Skeleton } from '../ui/kit';
import { useSetTitle } from '../ui/title';
import { ChatLink } from './ChatScreen';
import { assignmentStatusLabel, eventStatusLabel } from './EventLabels';
import { NotAvailable } from './OrgPage';
import { RespondButtons } from './Respond';
import { TaskList } from './Tasks';
import { AssignmentBoard } from './AssignmentBoard';
import { Related } from './Related';
import { History } from './History';
import { Files } from './Files';

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

  useSetTitle(ev.data ? { title: ev.data.title, subtitle: 'Buổi' } : null);
  if (ev.error) return <NotAvailable />;
  if (!ev.data) return <Skeleton rows={3} sections={2} />;
  const e = ev.data;
  const isDraft = e.status === 'draft';
  const cancelled = e.status === 'cancelled';
  // Băng "Vị trí của bạn" (UX §4.4): mọi vị trí của tôi còn hiệu lực trong buổi đã công bố.
  const mine =
    e.status === 'published'
      ? e.positions.flatMap((p) => p.assignments.filter((a) => a.userId === meId && ['requested', 'reconfirm', 'accepted'].includes(a.status)).map((a) => ({ p, a })))
      : [];

  // Xoá buổi ở mọi trạng thái (AD-33), luôn hỏi lại; lời nhắc nói đúng hậu quả theo trạng thái.
  const upcoming = e.status === 'published' && new Date(e.endsAt).getTime() > Date.now();
  const notify = new Set(e.positions.flatMap((p) => p.assignments.filter((a) => ['requested', 'accepted', 'reconfirm'].includes(a.status)).map((a) => a.userId))).size;
  const deleteDetail = isDraft
    ? e.seriesId
      ? 'Ngày này của nhịp sẽ thành "đã xoá", không tạo lại'
      : 'Chưa ai được báo'
    : upcoming
      ? `Huỷ trước, ${notify} người được báo, rồi ẩn khỏi lịch`
      : 'Ẩn khỏi lịch, không báo ai';
  const removeEvent = async () => {
    const done = (r: { notifiedCount: number }) => (setNotice(null), go({ name: 'calendar' }), r);
    if (upcoming) {
      const reason = await dialogs.prompt({
        title: 'Xoá buổi sắp diễn ra?',
        message: `Buổi sẽ được huỷ trước: ${notify} người đang được xếp nhận thông báo huỷ. Sau đó buổi ẩn khỏi lịch và mọi danh sách; lịch sử vẫn giữ. Không hoàn tác được.`,
        placeholder: 'Lý do gửi kèm thông báo (không bắt buộc)',
        confirmLabel: 'Huỷ và xoá',
        danger: true,
      });
      if (reason !== null) void act.run(() => api.removeEvent(eventId, { expectedVersion: e.version, reason: reason.trim() || undefined }), done);
      return;
    }
    const ok = await dialogs.confirm({
      title: isDraft ? 'Xoá bản nháp này?' : 'Xoá buổi này?',
      message: isDraft
        ? e.seriesId
          ? 'Chưa ai được báo. Ngày này của nhịp sẽ thành "đã xoá" và không được tạo lại. Không hoàn tác được.'
          : 'Chưa ai được báo về buổi này. Không hoàn tác được.'
        : `Buổi ${cancelled ? 'đã huỷ' : 'đã qua'} sẽ ẩn khỏi lịch và mọi danh sách; không ai nhận thông báo. Lịch sử hoạt động vẫn giữ. Không hoàn tác được.`,
      confirmLabel: 'Xoá',
      danger: true,
    });
    if (ok) void act.run(() => api.removeEvent(eventId, { expectedVersion: e.version }), done);
  };

  type Op = 'edit' | 'copy' | 'template' | 'delete';
  const more = async () => {
    const op = await dialogs.choose<Op>({
      title: e.title,
      options: [
        ...(!cancelled ? [{ label: editing ? 'Đóng phần sửa' : 'Sửa thông tin, đổi giờ, huỷ buổi', value: 'edit' as const }] : []),
        { label: 'Sao chép thành buổi mới', value: 'copy' },
        { label: 'Lưu làm mẫu', value: 'template' },
        { label: isDraft ? 'Xoá bản nháp' : 'Xoá buổi', detail: deleteDetail, value: 'delete' as const, danger: true },
      ],
    });
    if (op === 'edit') setEditing((x) => !x);
    else if (op === 'copy') go({ name: 'newevent', id: e.orgId, copy: e.id });
    else if (op === 'template') {
      const name = await dialogs.prompt({ title: 'Lưu làm mẫu', message: 'Mẫu giữ các vị trí và nhóm để dựng buổi sau nhanh hơn.', initial: e.title, required: true, confirmLabel: 'Lưu mẫu', maxLength: 120 });
      if (name?.trim()) void act.run(() => api.templateFromEvent(eventId, name.trim()), () => setNotice(`Đã lưu mẫu "${name.trim()}".`));
    } else if (op === 'delete') void removeEvent();
  };

  return (
    <>
      {isDraft && <Banner>Bản nháp, chưa gửi cho ai. Xếp người xong thì bấm Công bố.</Banner>}
      {cancelled && <Banner tone="danger">Buổi này đã huỷ. Mọi vị trí đã được huỷ và người được xếp đã được báo.</Banner>}
      {mine.map(({ p, a }) => (
        <section key={a.id} className="card mine-banner">
          <h2>Vị trí của bạn</h2>
          <div className="row spread">
            <span className="grid">
              <strong>{p.name}</strong>
              <span className="hint">
                Có mặt {timeLabel(addMinutes(e.startsAt, p.reportOffsetMin))}
                {p.groupName ? ` · ${p.groupName}` : ''}
              </span>
            </span>
            <span className={a.status === 'accepted' ? 'tag ok' : a.status === 'reconfirm' ? 'tag warn' : 'tag info'}>{assignmentStatusLabel[a.status]}</span>
          </div>
          <RespondButtons assignmentId={a.id} status={a.status} onDone={ev.reload} large />
        </section>
      ))}

      <section className="card hero">
        <h1>
          {e.title} {e.status !== 'published' && <span className={cancelled ? 'tag warn' : 'tag'}>{eventStatusLabel[e.status]}</span>}
        </h1>
        <ul className="facts">
          <li>
            <Icon name="clock" size={18} />
            <span>{rangeLabel(e.startsAt, e.endsAt)}</span>
          </li>
          {e.location && (
            <li>
              <Icon name="pin" size={18} />
              <span>{e.location}</span>
            </li>
          )}
          <li>
            <Icon name="user" size={18} />
            <span>Phụ trách: {e.owners.map((o) => o.displayName).join(', ')}</span>
          </li>
          <li>
            <Icon name="groups" size={18} />
            <span>
              {e.groups.length > 0 && <>{e.groups.map((g) => g.name).join(', ')} · </>}
              {e.visibility === 'org' ? 'cả tổ chức thấy' : 'chỉ nhóm tham gia và người được xếp thấy'}
            </span>
          </li>
        </ul>
        {e.description && <p className="pre">{e.description}</p>}
        {!isDraft && !cancelled && (
          <button className="button small" onClick={() => downloadIcs(e)}>
            <Icon name="calendar" size={16} /> Thêm vào lịch điện thoại
          </button>
        )}
        {notice && <p className="notice">{notice}</p>}
        {act.error && <p className="error">{act.error}</p>}
        {e.canEdit && (
          <div className="hero-actions">
            {isDraft && (
              <button
                className="button primary grow"
                disabled={act.busy}
                onClick={() =>
                  confirmThen({ title: 'Công bố buổi này?', message: 'Mọi người đã xếp sẽ nhận yêu cầu phục vụ.', confirmLabel: 'Công bố' }, () =>
                    act.run(
                      () => api.publishEvent(eventId, e.version),
                      (r) => (setNotice(`Đã công bố. ${r.requestedCount} người nhận yêu cầu phục vụ.`), ev.reload()),
                    ),
                  )
                }
              >
                Công bố
              </button>
            )}
            <button className="button" onClick={() => void more()}>
              <Icon name="more" size={18} /> Thao tác
            </button>
          </div>
        )}
        {!isDraft && <Follow eventId={eventId} />}
        {editing && e.canEdit && <EditEvent e={e} onSaved={() => (setEditing(false), ev.reload())} />}
        {editing && e.canEdit && e.status === 'published' && <ChangeEvent e={e} onDone={(msg) => (setEditing(false), setNotice(msg), ev.reload())} />}
        {e.canEdit && editing && <Owners e={e} members={members.data ?? []} onChanged={ev.reload} />}
      </section>

      {e.conversationId && <ChatLink conversationId={e.conversationId} label="Thảo luận về buổi này" />}
      {isDraft && <p className="hint center">Thảo luận mở khi buổi được công bố.</p>}

      <AssignmentBoard e={e} meId={meId} members={members.data ?? []} onChanged={ev.reload} onNotice={setNotice} />

      <TaskList
        load={() => api.eventTasks(eventId)}
        deps={[eventId, e.version]}
        realtimeTopics={[`event:${eventId}`]}
        newTask={!cancelled && (e.canEdit || e.canAddPositions) ? { scope: { type: 'event', eventId }, members: members.data ?? [], eventStartsAt: e.startsAt } : null}
      />

      {!isDraft && <Related type="event" id={eventId} topic={`event:${eventId}`} canLink={e.canEdit} />}
      <Files owner="events" id={eventId} orgId={e.orgId} topic={`event:${eventId}`} canAdd={e.canEdit && !cancelled} meId={meId} />
      <History type="event" id={eventId} topic={`event:${eventId}`} />
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
      {/* Đã công bố: dời giờ/địa điểm đi qua lệnh riêng để báo đúng người (F7). */}
      <input value={location} onChange={(x) => setLocation(x.target.value)} placeholder="Địa điểm" disabled={!isDraft} />
      {isDraft ? (
        <div className="row">
          <input type="datetime-local" value={startsAt} onChange={(x) => setStartsAt(x.target.value)} />
          <input type="datetime-local" value={endsAt} onChange={(x) => setEndsAt(x.target.value)} />
        </div>
      ) : (
        <p className="hint">Đổi giờ, địa điểm hoặc huỷ buổi đã công bố: dùng phần "Thay đổi buổi" bên dưới (người được xếp sẽ được báo).</p>
      )}
      {act.error && <p className="error">{act.error}</p>}
      <button className="button" disabled={act.busy}>
        Lưu
      </button>
    </form>
  );
}

/** F7: dời giờ (có thể yêu cầu xác nhận lại), đổi địa điểm, huỷ buổi. */
function ChangeEvent({ e, onDone }: { e: EventDto; onDone: (msg: string) => void }) {
  const act = useAction();
  const [startsAt, setStartsAt] = useState(toLocalInput(e.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInput(e.endsAt));
  const [location, setLocation] = useState(e.location ?? '');
  const [reason, setReason] = useState('');
  const durationMin = (new Date(e.endsAt).getTime() - new Date(e.startsAt).getTime()) / 60000;
  return (
    <div className="grid">
      <h2>Thay đổi buổi</h2>
      <form
        className="grid"
        onSubmit={(x) => {
          x.preventDefault();
          void act.run(
            () => api.rescheduleEvent(e.id, { expectedVersion: e.version, startsAt: fromLocalInput(startsAt), endsAt: fromLocalInput(endsAt), reason: reason || undefined }),
            ({ summary: s }) =>
              onDone(
                `Đã dời giờ. ${s.notifiedCount} người được báo` +
                  (s.reconfirmCount ? `, ${s.reconfirmCount} người cần xác nhận lại` : '') +
                  (s.tasksShifted ? `, ${s.tasksShifted} việc dời hạn theo buổi` : '') +
                  (s.tasksAbsoluteDue.length ? `. Việc giữ hạn cố định, xem lại: ${s.tasksAbsoluteDue.map((t) => t.title).join(', ')}` : '') +
                  '.',
              ),
          );
        }}
      >
        <div className="row">
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(x) => {
              setStartsAt(x.target.value);
              // Giữ thời lượng khi đổi giờ bắt đầu.
              if (x.target.value) setEndsAt(toLocalInput(addMinutes(fromLocalInput(x.target.value), durationMin)));
            }}
            required
          />
          <input type="datetime-local" value={endsAt} onChange={(x) => setEndsAt(x.target.value)} required />
        </div>
        <input value={reason} onChange={(x) => setReason(x.target.value)} placeholder="Lý do (không bắt buộc)" maxLength={500} />
        <button className="button" disabled={act.busy || (fromLocalInput(startsAt) === e.startsAt && fromLocalInput(endsAt) === e.endsAt)}>
          Dời giờ
        </button>
      </form>
      <form
        className="row"
        onSubmit={(x) => {
          x.preventDefault();
          void act.run(() => api.relocateEvent(e.id, { expectedVersion: e.version, location: location.trim() || null }), () => onDone('Đã đổi địa điểm, người được xếp đã được báo.'));
        }}
      >
        <input value={location} onChange={(x) => setLocation(x.target.value)} placeholder="Địa điểm" maxLength={300} />
        <button className="button small" disabled={act.busy || location.trim() === (e.location ?? '')}>
          Đổi địa điểm
        </button>
      </form>
      <button
        className="button small danger"
        disabled={act.busy}
        onClick={async () => {
          const r = await dialogs.prompt({
            title: 'Huỷ buổi này?',
            message: 'Mọi vị trí sẽ bị huỷ và người được xếp nhận thông báo.',
            placeholder: 'Lý do (không bắt buộc)',
            confirmLabel: 'Huỷ buổi',
            danger: true,
          });
          if (r !== null) void act.run(() => api.cancelEvent(e.id, { expectedVersion: e.version, reason: r.trim() || undefined }), () => onDone('Đã huỷ buổi.'));
        }}
      >
        Huỷ buổi
      </button>
      {act.error && <p className="error">{act.error}</p>}
    </div>
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

/** Theo dõi / tắt tiếng (NOTIFICATION_ENGINE §6): tắt tiếng không bỏ thông báo thuộc trách nhiệm của bạn. */
export function Follow({ eventId, type = 'event', label = 'Thông báo về buổi này:' }: { eventId: string; type?: 'event' | 'task'; label?: string }) {
  const sub = useLoad(() => api.subscription(type, eventId), [eventId, type]);
  const act = useAction();
  if (!sub.data) return null;
  return (
    <label className="row hint">
      {label}
      <select
        value={sub.data.mode ?? ''}
        disabled={act.busy}
        onChange={(x) => void act.run(() => api.setSubscription(type, eventId, (x.target.value || null) as 'follow' | 'mute' | null), sub.reload)}
      >
        <option value="">Bình thường</option>
        <option value="follow">Theo dõi mọi cập nhật</option>
        <option value="mute">Tắt tiếng (vẫn nhận việc cần bạn)</option>
      </select>
    </label>
  );
}
