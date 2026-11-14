import type { MemberDto, TaskDto, TaskStatus, TaskSummaryDto } from '@collab/shared';
import { useEffect, useState } from 'react';
import { api, type NewTaskBody } from '../lib/api';
import { dayLabel, fromLocalInput, timeLabel, toLocalInput } from '../lib/datetime';
import { useRealtime } from '../lib/realtime';
import { go, href } from '../lib/route';
import { useAction, useLoad } from '../lib/useLoad';
import { dialogs } from '../ui/dialogs';
import { Icon } from '../ui/icons';
import { Banner, Skeleton } from '../ui/kit';
import { useSetTitle } from '../ui/title';
import { ChatLink } from './ChatScreen';
import { Follow } from './EventPage';
import { NotAvailable } from './OrgPage';
import { Related } from './Related';
import { History } from './History';
import { Files } from './Files';

export const taskStatusLabel: Record<TaskStatus, string> = { open: 'Chưa làm', in_progress: 'Đang làm', done: 'Xong', cancelled: 'Đã huỷ' };
const dueText = (iso: string | null) => (iso ? `hạn ${dayLabel(iso)} ${timeLabel(iso)}` : 'không hạn');

/** Danh sách Task (của buổi / của nhóm) + form tạo nhanh. */
export function TaskList({
  load,
  deps,
  realtimeTopics,
  newTask,
}: {
  load: () => Promise<TaskSummaryDto[]>;
  deps: unknown[];
  realtimeTopics: string[];
  newTask: { scope: NewTaskBody['scope']; members: MemberDto[]; eventStartsAt?: string } | null;
}) {
  const list = useLoad(load, deps);
  useRealtime(realtimeTopics, list.reload);
  return (
    <section className="card">
      <h2>Việc</h2>
      {list.error && <p className="error">{list.error}</p>}
      {list.data && list.data.length === 0 && <p className="hint">Chưa có việc.</p>}
      <ul className="list">
        {list.data?.map((t) => (
          <li key={t.id}>
            <a className="cell-link" href={href({ name: 'task', id: t.id })}>
              <span className={`check ${t.status}`} aria-hidden="true" />
              <span className="grid">
                <strong className={t.status === 'done' || t.status === 'cancelled' ? 'struck' : undefined}>{t.title}</strong>
                <span className="hint">
                  {t.owner ? t.owner.displayName : 'Chưa giao'}
                  {t.acceptance === 'pending' && ' (chờ nhận)'}
                  {t.acceptance === 'declined' && ' (đã từ chối)'} · {dueText(t.dueAt)}
                </span>
              </span>
              <span className="tags">
                {t.blocked && <span className="tag warn">Bị chặn</span>}
                {t.needsHelp && <span className="tag warn">Cần giúp</span>}
                {t.overdue && <span className="tag warn">Quá hạn</span>}
                {t.status === 'in_progress' && <span className="tag info">Đang làm</span>}
              </span>
            </a>
          </li>
        ))}
      </ul>
      {newTask && <NewTask {...newTask} onCreated={list.reload} />}
    </section>
  );
}

function NewTask({ scope, members, eventStartsAt, onCreated }: { scope: NewTaskBody['scope']; members: MemberDto[]; eventStartsAt?: string; onCreated: () => void }) {
  const act = useAction();
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  const [needAccept, setNeedAccept] = useState(false);
  return (
    <form
      className="grid"
      onSubmit={(x) => {
        x.preventDefault();
        if (!title.trim()) return;
        // Việc của buổi: hạn lưu theo độ lệch với giờ bắt đầu để tự dời khi dời lịch (F7-T4).
        const dueAt = due ? fromLocalInput(due) : null;
        const offset = dueAt && eventStartsAt ? Math.round((new Date(dueAt).getTime() - new Date(eventStartsAt).getTime()) / 60000) : null;
        void act.run(
          () =>
            api.createTask({
              title: title.trim(),
              scope,
              ownerId: owner || null,
              requiresAcceptance: needAccept,
              ...(offset !== null ? { dueOffsetMin: offset } : { dueAt }),
            }),
          () => (setTitle(''), setOwner(''), setDue(''), onCreated()),
        );
      }}
    >
      <input value={title} onChange={(x) => setTitle(x.target.value)} placeholder="Thêm việc…" maxLength={200} />
      {title && (
        <>
          <div className="row">
            <select value={owner} onChange={(x) => setOwner(x.target.value)}>
              <option value="">Chưa giao</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                </option>
              ))}
            </select>
            <input type="datetime-local" value={due} onChange={(x) => setDue(x.target.value)} title="Hạn" />
          </div>
          {owner && (
            <label className="row hint">
              <input type="checkbox" checked={needAccept} onChange={(x) => setNeedAccept(x.target.checked)} /> Cần người nhận xác nhận
            </label>
          )}
          <button className="button" disabled={act.busy}>
            Tạo việc
          </button>
        </>
      )}
      {act.error && <p className="error">{act.error}</p>}
    </form>
  );
}

/** Trang Task (F8): thông tin, nhận/từ chối, tiến độ, cờ, giao lại, người cùng làm, trao đổi. */
export function TaskPage({ taskId, meId }: { taskId: string; meId: string }) {
  const task = useLoad(() => api.task(taskId), [taskId]);
  useRealtime([`user:${meId}`, `task:${taskId}`], task.reload);
  const orgId = task.data?.orgId;
  const needMembers = Boolean(task.data && (task.data.can.assign || task.data.can.collaborators));
  const members = useLoad(() => (orgId && needMembers ? api.members(orgId) : Promise.resolve([] as MemberDto[])), [orgId, needMembers]);
  const act = useAction();
  const [editing, setEditing] = useState(false);
  // Mở Task → thông báo về Task thành đã đọc; giao không cần nhận thì "Cần bạn" thành xong (F8-T2).
  useEffect(() => {
    void api.readTarget('task', taskId).catch(() => undefined);
  }, [taskId]);

  useSetTitle(task.data ? { title: task.data.title, subtitle: 'Việc' } : null);
  if (task.error) return <NotAvailable />;
  if (!task.data) return <Skeleton rows={3} sections={2} />;
  const t = task.data;
  const run = <T,>(fn: () => Promise<T>) => void act.run(fn, task.reload);
  const open = t.status === 'open' || t.status === 'in_progress';
  const scopeLink =
    t.scope.type === 'event' && t.scope.id
      ? { href: href({ name: 'event', id: t.scope.id }), label: `Buổi ${t.scope.name ?? ''}` }
      : t.scope.type === 'group' && t.scope.id
        ? { href: href({ name: 'group', id: t.scope.id }), label: `Nhóm ${t.scope.name ?? ''}` }
        : null;

  type Op = 'done' | 'start' | 'reopen' | 'help' | 'blocked' | 'edit' | 'cancel' | 'leave';
  const more = async () => {
    const op = await dialogs.choose<Op>({
      title: t.title,
      options: [
        ...(t.can.respond && t.can.status && open ? [{ label: 'Đánh dấu xong', value: 'done' as const }] : []),
        ...(t.can.status && t.status === 'open' ? [{ label: 'Bắt đầu làm', value: 'start' as const }] : []),
        ...(t.can.reopenCancel && t.status === 'done' ? [{ label: 'Mở lại', value: 'reopen' as const }] : []),
        ...(t.can.flag ? [{ label: t.needsHelp ? 'Bỏ cờ "Cần giúp"' : 'Báo cần giúp', value: 'help' as const }] : []),
        ...(t.can.flag ? [{ label: t.blocked ? 'Bỏ cờ "Bị chặn"' : 'Báo bị chặn', value: 'blocked' as const }] : []),
        ...(t.can.edit ? [{ label: editing ? 'Đóng phần sửa' : 'Sửa tên, mô tả, hạn', value: 'edit' as const }] : []),
        ...(t.collaborators.some((c) => c.userId === meId) && open ? [{ label: 'Thôi cùng làm', value: 'leave' as const }] : []),
        ...(t.can.reopenCancel && open ? [{ label: 'Huỷ việc', value: 'cancel' as const, danger: true }] : []),
      ],
    });
    if (op === 'done') run(() => api.taskStatus(taskId, { expectedVersion: t.version, status: 'done' }));
    else if (op === 'start') run(() => api.taskStatus(taskId, { expectedVersion: t.version, status: 'in_progress' }));
    else if (op === 'reopen') run(() => api.taskStatus(taskId, { expectedVersion: t.version, status: 'open' }));
    else if (op === 'help') run(() => api.taskFlags(taskId, { needsHelp: !t.needsHelp }));
    else if (op === 'blocked') run(() => api.taskFlags(taskId, { blocked: !t.blocked }));
    else if (op === 'edit') setEditing((x) => !x);
    else if (op === 'leave') run(() => api.taskCollaborators(taskId, { remove: [meId] }));
    else if (op === 'cancel') {
      const reason = await dialogs.prompt({ title: 'Huỷ việc này?', placeholder: 'Lý do (không bắt buộc)', confirmLabel: 'Huỷ việc', danger: true });
      if (reason !== null) run(() => api.cancelTask(taskId, { expectedVersion: t.version, reason: reason.trim() || undefined }));
    }
  };

  return (
    <>
      {t.status === 'cancelled' && <Banner tone="danger">Việc này đã huỷ.</Banner>}
      {t.acceptance === 'declined' && t.can.assign && <Banner tone="warn">{t.owner?.displayName ?? 'Người được giao'} đã từ chối{t.declineReason ? `: “${t.declineReason}”` : ''}. Hãy giao lại.</Banner>}
      <section className="card hero">
        <h1>{t.title}</h1>
        <div className="tags">
          <span className={t.status === 'done' ? 'tag ok' : t.status === 'in_progress' ? 'tag info' : 'tag'}>{taskStatusLabel[t.status]}</span>
          {t.blocked && <span className="tag warn">Bị chặn</span>}
          {t.needsHelp && <span className="tag warn">Cần giúp</span>}
          {t.overdue && <span className="tag warn">Quá hạn</span>}
        </div>
        {t.description && <p className="pre">{t.description}</p>}
        <ul className="facts">
          <li>
            <Icon name="user" size={18} />
            <span>
              Phụ trách: <strong>{t.owner?.displayName ?? 'chưa giao'}</strong>
              {t.acceptance === 'pending' && ' (chờ nhận)'}
              {t.acceptance === 'declined' && ' (đã từ chối)'}
              {t.collaborators.length > 0 && ` · cùng làm: ${t.collaborators.map((c) => c.displayName).join(', ')}`}
            </span>
          </li>
          <li>
            <Icon name="clock" size={18} />
            <span>
              {t.dueAt ? `Hạn ${dayLabel(t.dueAt)} ${timeLabel(t.dueAt)}` : 'Không có hạn'}
              {t.dueOffsetMin !== null && ' (theo giờ buổi)'}
            </span>
          </li>
          <li>
            <Icon name={t.scope.type === 'event' ? 'calendar' : t.scope.type === 'group' ? 'groups' : 'work'} size={18} />
            <span>{scopeLink ? <a href={scopeLink.href}>{scopeLink.label}</a> : 'Việc riêng'}</span>
          </li>
          <li className="hint">
            <Icon name="work" size={18} />
            <span>
              {t.assignedBy ? `Giao bởi ${t.assignedBy.displayName} · ` : ''}Tạo bởi {t.createdBy.displayName}
            </span>
          </li>
        </ul>
        {t.source && (
          <p className="hint">
            Tạo từ tin nhắn:{' '}
            {t.source.available && t.source.anchor ? (
              <a href={href(t.source.anchor.type === 'group' ? { name: 'group', id: t.source.anchor.id } : { name: t.source.anchor.type, id: t.source.anchor.id })}>
                {t.source.senderName ?? 'Ai đó'} trong {t.source.anchor.name}: "{t.source.excerpt}"
              </a>
            ) : (
              'Tin nhắn gốc không khả dụng'
            )}
          </p>
        )}
        {act.error && <p className="error">{act.error}</p>}

        <div className="hero-actions">
          {t.can.respond && (
            <>
              <button
                className="button grow"
                disabled={act.busy}
                onClick={async () => {
                  const reason = await dialogs.prompt({ title: 'Từ chối việc này?', message: 'Người giao sẽ thấy lý do.', placeholder: 'Lý do', confirmLabel: 'Từ chối', danger: true });
                  if (reason !== null) run(() => api.respondTask(taskId, { response: 'decline', reason: reason.trim() || undefined }));
                }}
              >
                Từ chối
              </button>
              <button className="button primary grow" disabled={act.busy} onClick={() => run(() => api.respondTask(taskId, { response: 'accept' }))}>
                Nhận việc
              </button>
            </>
          )}
          {!t.can.respond && t.can.status && open && (
            <button className="button primary grow" disabled={act.busy} onClick={() => run(() => api.taskStatus(taskId, { expectedVersion: t.version, status: 'done' }))}>
              Đánh dấu xong
            </button>
          )}
          <button className="button" onClick={() => void more()}>
            <Icon name="more" size={18} /> Thao tác
          </button>
        </div>
        <Follow eventId={taskId} type="task" label="Thông báo về việc này:" />
        {editing && <EditTask t={t} onSaved={() => (setEditing(false), task.reload())} />}
        {(t.can.assign || t.can.collaborators) && <People t={t} members={members.data ?? []} onChanged={task.reload} />}
      </section>

      {t.conversationId ? (
        <ChatLink conversationId={t.conversationId} label="Trao đổi về việc này" />
      ) : (
        <button
          className="button"
          disabled={act.busy}
          onClick={() => void act.run(() => api.openTaskConversation(taskId), (r) => go({ name: 'chat', id: r.conversationId }))}
        >
          <Icon name="chats" size={18} /> Bắt đầu trao đổi
        </button>
      )}

      <Related type="task" id={taskId} topic={`task:${taskId}`} canLink={t.can.edit} />
      <Files owner="tasks" id={taskId} orgId={t.orgId} topic={`task:${taskId}`} canAdd={t.can.flag} meId={meId} />
      <History type="task" id={taskId} topic={`task:${taskId}`} />
    </>
  );
}

function EditTask({ t, onSaved }: { t: TaskDto; onSaved: () => void }) {
  const act = useAction();
  const [title, setTitle] = useState(t.title);
  const [description, setDescription] = useState(t.description ?? '');
  const [due, setDue] = useState(t.dueAt ? toLocalInput(t.dueAt) : '');
  return (
    <form
      className="grid"
      onSubmit={(x) => {
        x.preventDefault();
        const dueAt = due ? fromLocalInput(due) : null;
        const sameDue = (dueAt ? new Date(dueAt).getTime() : null) === (t.dueAt ? new Date(t.dueAt).getTime() : null);
        void act.run(() => api.updateTask(t.id, { expectedVersion: t.version, title, description: description || null, ...(sameDue ? {} : { dueAt }) }), onSaved);
      }}
    >
      <input value={title} onChange={(x) => setTitle(x.target.value)} required maxLength={200} />
      <textarea value={description} onChange={(x) => setDescription(x.target.value)} placeholder="Mô tả" rows={3} />
      <label className="row hint">
        Hạn <input type="datetime-local" value={due} onChange={(x) => setDue(x.target.value)} />
      </label>
      {t.dueOffsetMin !== null && <p className="hint">Đổi hạn ở đây sẽ thành hạn cố định (không tự dời theo buổi nữa).</p>}
      {act.error && <p className="error">{act.error}</p>}
      <button className="button" disabled={act.busy}>
        Lưu
      </button>
    </form>
  );
}

function People({ t, members, onChanged }: { t: TaskDto; members: MemberDto[]; onChanged: () => void }) {
  const act = useAction();
  const [owner, setOwner] = useState('');
  const [collab, setCollab] = useState('');
  const taken = new Set([t.owner?.userId, ...t.collaborators.map((c) => c.userId)]);
  return (
    <div className="grid">
      {t.can.assign && (
        <form
          className="row"
          onSubmit={(x) => {
            x.preventDefault();
            if (owner) void act.run(() => api.assignTask(t.id, { expectedVersion: t.version, ownerId: owner === '-' ? null : owner }), () => (setOwner(''), onChanged()));
          }}
        >
          <select value={owner} onChange={(x) => setOwner(x.target.value)}>
            <option value="">{t.owner ? 'Giao lại cho…' : 'Giao cho…'}</option>
            {t.owner && <option value="-">Bỏ giao</option>}
            {members
              .filter((m) => m.userId !== t.owner?.userId || t.acceptance === 'declined')
              .map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                </option>
              ))}
          </select>
          <button className="button small" disabled={act.busy || !owner}>
            Giao
          </button>
        </form>
      )}
      {t.can.collaborators && (
        <form
          className="row"
          onSubmit={(x) => {
            x.preventDefault();
            if (collab) void act.run(() => api.taskCollaborators(t.id, { add: [collab] }), () => (setCollab(''), onChanged()));
          }}
        >
          <select value={collab} onChange={(x) => setCollab(x.target.value)}>
            <option value="">Thêm người cùng làm…</option>
            {members
              .filter((m) => !taken.has(m.userId))
              .map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                </option>
              ))}
          </select>
          <button className="button small" disabled={act.busy || !collab}>
            Thêm
          </button>
          {t.collaborators.map((c) => (
            <button key={c.userId} className="button small danger" disabled={act.busy} onClick={(x) => (x.preventDefault(), void act.run(() => api.taskCollaborators(t.id, { remove: [c.userId] }), onChanged))}>
              Bỏ {c.displayName}
            </button>
          ))}
        </form>
      )}
      {act.error && <p className="error">{act.error}</p>}
    </div>
  );
}
