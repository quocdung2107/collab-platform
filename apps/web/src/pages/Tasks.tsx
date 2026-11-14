import type { MemberDto, TaskDto, TaskStatus, TaskSummaryDto } from '@collab/shared';
import { useEffect, useState } from 'react';
import { api, type NewTaskBody } from '../lib/api';
import { dayLabel, fromLocalInput, timeLabel, toLocalInput } from '../lib/datetime';
import { useRealtime } from '../lib/realtime';
import { href } from '../lib/route';
import { useAction, useLoad } from '../lib/useLoad';
import { ChatPanel } from './ChatPanel';
import { Follow } from './EventPage';
import { NotAvailable } from './OrgPage';

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
            <span className="grid">
              <a href={href({ name: 'task', id: t.id })}>{t.title}</a>
              <span className="hint">
                {t.owner ? t.owner.displayName : 'Chưa giao'}
                {t.acceptance === 'pending' && ' (chờ nhận)'}
                {t.acceptance === 'declined' && ' (đã từ chối)'} · {dueText(t.dueAt)}
              </span>
            </span>
            <span className="row">
              {t.blocked && <span className="tag warn">Bị chặn</span>}
              {t.needsHelp && <span className="tag warn">Cần giúp</span>}
              {t.overdue && <span className="tag warn">Quá hạn</span>}
              <span className="tag">{taskStatusLabel[t.status]}</span>
            </span>
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

  if (task.error) return <NotAvailable />;
  if (!task.data) return <p className="center">Đang tải…</p>;
  const t = task.data;
  const run = <T,>(fn: () => Promise<T>) => void act.run(fn, task.reload);
  const back =
    t.scope.type === 'event' && t.scope.id
      ? { href: href({ name: 'event', id: t.scope.id }), label: t.scope.name ?? 'Buổi' }
      : t.scope.type === 'group' && t.scope.id
        ? { href: href({ name: 'group', id: t.scope.id }), label: t.scope.name ?? 'Nhóm' }
        : { href: href({ name: 'home' }), label: 'Hôm nay' };
  const open = t.status === 'open' || t.status === 'in_progress';

  return (
    <>
      <section className="card">
        <a href={back.href} className="hint">
          ← {back.label}
        </a>
        <h1>
          {t.title} <span className="tag">{taskStatusLabel[t.status]}</span>
          {t.blocked && <span className="tag warn">Bị chặn</span>}
          {t.needsHelp && <span className="tag warn">Cần giúp</span>}
          {t.overdue && <span className="tag warn">Quá hạn</span>}
        </h1>
        {t.description && <p className="pre">{t.description}</p>}
        <p className="hint">
          {t.scope.type === 'private' ? 'Việc riêng' : t.scope.type === 'group' ? `Việc của nhóm ${t.scope.name ?? ''}` : `Việc của buổi ${t.scope.name ?? ''}`} · {dueText(t.dueAt)}
          {t.dueOffsetMin !== null && ' (theo giờ buổi)'}
        </p>
        <p className="hint">
          Phụ trách: {t.owner?.displayName ?? 'chưa giao'}
          {t.acceptance === 'pending' && ' (chờ nhận)'}
          {t.acceptance === 'declined' && ` (đã từ chối${t.declineReason ? `: ${t.declineReason}` : ''})`}
          {t.assignedBy && ` · Giao bởi ${t.assignedBy.displayName}`} · Tạo bởi {t.createdBy.displayName}
          {t.collaborators.length > 0 && ` · Cùng làm: ${t.collaborators.map((c) => c.displayName).join(', ')}`}
        </p>
        {act.error && <p className="error">{act.error}</p>}

        <div className="row">
          {t.can.respond && (
            <>
              <button className="button small primary" disabled={act.busy} onClick={() => run(() => api.respondTask(taskId, { response: 'accept' }))}>
                Nhận việc
              </button>
              <button
                className="button small"
                disabled={act.busy}
                onClick={() => {
                  const reason = window.prompt('Lý do từ chối (người giao sẽ thấy)');
                  if (reason !== null) run(() => api.respondTask(taskId, { response: 'decline', reason: reason.trim() || undefined }));
                }}
              >
                Từ chối
              </button>
            </>
          )}
          {t.can.status && t.status === 'open' && (
            <button className="button small" disabled={act.busy} onClick={() => run(() => api.taskStatus(taskId, { expectedVersion: t.version, status: 'in_progress' }))}>
              Bắt đầu
            </button>
          )}
          {t.can.status && open && (
            <button className="button small primary" disabled={act.busy} onClick={() => run(() => api.taskStatus(taskId, { expectedVersion: t.version, status: 'done' }))}>
              Xong
            </button>
          )}
          {t.can.reopenCancel && t.status === 'done' && (
            <button className="button small" disabled={act.busy} onClick={() => run(() => api.taskStatus(taskId, { expectedVersion: t.version, status: 'open' }))}>
              Mở lại
            </button>
          )}
          {t.can.flag && (
            <>
              <button className="button small" disabled={act.busy} onClick={() => run(() => api.taskFlags(taskId, { needsHelp: !t.needsHelp }))}>
                {t.needsHelp ? 'Bỏ cờ cần giúp' : 'Cần giúp'}
              </button>
              <button className="button small" disabled={act.busy} onClick={() => run(() => api.taskFlags(taskId, { blocked: !t.blocked }))}>
                {t.blocked ? 'Bỏ cờ bị chặn' : 'Bị chặn'}
              </button>
            </>
          )}
          {t.can.edit && (
            <button className="button small" onClick={() => setEditing((x) => !x)}>
              {editing ? 'Đóng sửa' : 'Sửa'}
            </button>
          )}
          {t.can.reopenCancel && open && (
            <button
              className="button small danger"
              disabled={act.busy}
              onClick={() => {
                const reason = window.prompt('Huỷ việc này? Lý do (không bắt buộc):', '');
                if (reason !== null) run(() => api.cancelTask(taskId, { expectedVersion: t.version, reason: reason.trim() || undefined }));
              }}
            >
              Huỷ việc
            </button>
          )}
          {t.collaborators.some((c) => c.userId === meId) && open && (
            <button className="button small" disabled={act.busy} onClick={() => run(() => api.taskCollaborators(taskId, { remove: [meId] }))}>
              Thôi cùng làm
            </button>
          )}
        </div>
        <Follow eventId={taskId} type="task" label="Thông báo về việc này:" />
        {editing && <EditTask t={t} onSaved={() => (setEditing(false), task.reload())} />}
        {(t.can.assign || t.can.collaborators) && <People t={t} members={members.data ?? []} onChanged={task.reload} />}
      </section>

      <section className="card">
        <h2>Trao đổi về việc này</h2>
        {t.conversationId ? (
          <ChatPanel key={t.conversationId} conversationId={t.conversationId} meId={meId} members={[t.owner, t.assignedBy, t.createdBy, ...t.collaborators].filter((x): x is NonNullable<typeof x> => !!x)} />
        ) : (
          <button className="button small" disabled={act.busy} onClick={() => run(() => api.openTaskConversation(taskId))}>
            Bắt đầu trao đổi
          </button>
        )}
      </section>
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
