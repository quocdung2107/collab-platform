import { useState } from 'react';
import { api } from '../lib/api';
import { useRealtime } from '../lib/realtime';
import { go, href } from '../lib/route';
import { useAction, useLoad } from '../lib/useLoad';
import { ChatPanel } from './ChatPanel';
import { NotAvailable } from './OrgPage';
import { TaskList } from './Tasks';

export function GroupPage({ groupId, meId }: { groupId: string; meId: string }) {
  const group = useLoad(() => api.group(groupId), [groupId]);
  const orgId = group.data?.orgId;
  const org = useLoad(() => (orgId ? api.org(orgId) : Promise.resolve(null)), [orgId]);
  const orgMembers = useLoad(() => (orgId ? api.members(orgId) : Promise.resolve([])), [orgId]);
  useRealtime([`user:${meId}`, `group:${groupId}`], group.reload);
  const act = useAction();
  const [pick, setPick] = useState('');
  const isMember = Boolean(group.data?.myRole);
  // AD-11: chỉ thành viên nhóm đọc hội thoại nhóm (kể cả org admin).
  const conv = useLoad(() => (isMember ? api.groupConversation(groupId) : Promise.resolve(null)), [groupId, isMember]);

  if (group.error) return <NotAvailable />;
  if (!group.data) return <p className="center">Đang tải…</p>;
  const g = group.data;
  const isOrgAdmin = org.data?.myRole === 'owner' || org.data?.myRole === 'admin';
  const canManage = !g.archived && (isOrgAdmin || g.myRole === 'leader');
  const inGroup = new Set(g.members.map((m) => m.userId));
  const candidates = (orgMembers.data ?? []).filter((m) => !inGroup.has(m.userId));

  return (
    <>
    {conv.data && (
      <section className="card">
        <h2>Trò chuyện nhóm</h2>
        <ChatPanel key={conv.data.id} conversationId={conv.data.id} meId={meId} members={g.members} />
      </section>
    )}
    <TaskList
      load={() => api.groupTasks(groupId)}
      deps={[groupId]}
      realtimeTopics={[`group:${groupId}`]}
      newTask={!g.archived && (isMember || isOrgAdmin) ? { scope: { type: 'group', groupId }, members: orgMembers.data ?? [] } : null}
    />
    {!g.myRole && (
      <section className="card">
        <p className="hint">Chỉ thành viên nhóm đọc được trò chuyện của nhóm.</p>
      </section>
    )}
    <section className="card">
      <h1>
        {g.name} {g.archived && <span className="hint">(đã lưu trữ)</span>}
      </h1>
      {g.description && <p>{g.description}</p>}
      {act.error && <p className="error">{act.error}</p>}

      <h2>Thành viên ({g.memberCount})</h2>
      <ul className="list">
        {g.members.map((m) => (
          <li key={m.userId}>
            <span>
              {m.displayName}
              {m.userId === meId && ' (bạn)'}
            </span>
            <span className="row">
              {canManage ? (
                <select
                  value={m.role}
                  disabled={act.busy}
                  onChange={(e) => void act.run(() => api.setGroupRole(groupId, m.userId, e.target.value as 'leader' | 'member'), group.reload)}
                >
                  <option value="leader">Trưởng nhóm</option>
                  <option value="member">Thành viên</option>
                </select>
              ) : (
                <span className="hint">{m.role === 'leader' ? 'Trưởng nhóm' : 'Thành viên'}</span>
              )}
              {canManage && m.userId !== meId && (
                <button className="button small danger" disabled={act.busy} onClick={() => void act.run(() => api.removeGroupMember(groupId, m.userId), group.reload)}>
                  Gỡ
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>

      {canManage && candidates.length > 0 && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (pick) void act.run(() => api.addGroupMember(groupId, pick), () => (setPick(''), group.reload()));
          }}
        >
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Chọn thành viên tổ chức…</option>
            {candidates.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName}
              </option>
            ))}
          </select>
          <button className="button" disabled={act.busy || !pick}>
            Thêm
          </button>
        </form>
      )}

      <div className="row">
        {g.myRole && !g.archived && (
          <button className="button small" disabled={act.busy} onClick={() => void act.run(() => api.leaveGroup(groupId), group.reload)}>
            Rời nhóm
          </button>
        )}
        {canManage && (
          <button
            className="button small danger"
            disabled={act.busy}
            onClick={() =>
              window.confirm(`Lưu trữ nhóm ${g.name}?`) &&
              void act.run(() => api.archiveGroup(groupId, g.version), () => go({ name: 'groups' }))
            }
          >
            Lưu trữ nhóm
          </button>
        )}
      </div>
    </section>
    </>
  );
}
