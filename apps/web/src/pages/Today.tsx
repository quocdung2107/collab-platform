import type { WorkspaceAssignmentDto, WorkspaceTaskDto } from '@collab/shared';
import { api } from '../lib/api';
import { setCurrentOrg } from '../lib/currentOrg';
import { dayLabel, timeLabel } from '../lib/datetime';
import { useRealtime } from '../lib/realtime';
import { go, href } from '../lib/route';
import { useLoad } from '../lib/useLoad';
import { RespondButtons } from './Respond';

type Item = WorkspaceAssignmentDto | WorkspaceTaskDto;

/** My Workspace (UX §4.1): Cần xử lý (điều phối) · Cần phản hồi · Sắp tới · Có gì mới. */
export function Today({ meId, renderTask }: { meId: string; renderTask?: (t: WorkspaceTaskDto, reload: () => void) => React.ReactNode }) {
  const ws = useLoad(() => api.workspace(), []);
  useRealtime([`user:${meId}`], ws.reload);
  if (ws.error) return <p className="error">{ws.error}</p>;
  if (!ws.data) return <p className="center">Đang tải…</p>;
  const w = ws.data;
  const empty = !w.needsResponse.length && !w.upcoming.length && !w.news.length && !w.coordinate?.shortPositions.length && !w.coordinate?.declinedTasks.length;

  const row = (x: Item) =>
    x.kind === 'assignment' ? (
      <li key={x.id}>
        <span className="grid">
          <a href={href({ name: 'event', id: x.eventId })}>{x.eventTitle}</a>
          <span className="hint">
            {x.positionName}
            {x.groupName ? ` · ${x.groupName}` : ''} · có mặt {dayLabel(x.reportAt)} {timeLabel(x.reportAt)}
            {x.location ? ` · ${x.location}` : ''} · {x.orgName}
          </span>
        </span>
        {(x.status === 'requested' || x.status === 'reconfirm') && <RespondButtons assignmentId={x.id} status={x.status} onDone={ws.reload} />}
      </li>
    ) : (
      <li key={x.id}>
        {renderTask ? (
          renderTask(x, ws.reload)
        ) : (
          <span className="grid">
            <a href={href({ name: 'task', id: x.id })}>{x.title}</a>
            <span className="hint">
              Việc{x.scope.name ? ` · ${x.scope.name}` : ''}
              {x.dueAt ? ` · hạn ${dayLabel(x.dueAt)} ${timeLabel(x.dueAt)}` : ''} · {x.orgName}
              {x.acceptance === 'pending' ? ' · chờ bạn nhận' : ''}
            </span>
          </span>
        )}
        {x.overdue && <span className="tag warn">Quá hạn</span>}
      </li>
    );

  return (
    <>
      {w.coordinate && (w.coordinate.shortPositions.length > 0 || w.coordinate.declinedTasks.length > 0) && (
        <section className="card">
          <h2>Cần xử lý</h2>
          <ul className="list">
            {w.coordinate.shortPositions.map((p) => (
              <li key={p.positionId}>
                <span className="grid">
                  <a href={href({ name: 'event', id: p.eventId })}>{p.eventTitle}</a>
                  <span className="hint">
                    {p.positionName}
                    {p.groupName ? ` · ${p.groupName}` : ''} · {dayLabel(p.startsAt)}
                  </span>
                </span>
                <span className="tag warn">
                  thiếu {p.slots - p.filled}/{p.slots}
                </span>
              </li>
            ))}
            {w.coordinate.declinedTasks.map((t) => (
              <li key={t.id}>
                <a href={href({ name: 'task', id: t.id })}>{t.title}</a>
                <span className="hint">{t.declinedBy} đã từ chối: cần giao lại</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {w.needsResponse.length > 0 && (
        <section className="card">
          <h2>Cần phản hồi ({w.needsResponse.length})</h2>
          <ul className="list">{w.needsResponse.map(row)}</ul>
        </section>
      )}
      {w.upcoming.length > 0 && (
        <section className="card">
          <h2>Sắp tới</h2>
          <ul className="list">{w.upcoming.map(row)}</ul>
        </section>
      )}
      {w.news.length > 0 && (
        <section className="card">
          <h2>Có gì mới</h2>
          <ul className="list">
            {w.news.map((n) => (
              <li key={n.id}>
                <button
                  className="link notif-body"
                  onClick={() =>
                    void api.readNotification(n.id).then(() => {
                      if (n.link?.route === 'event') go({ name: 'event', id: n.link.id });
                      else if (n.link?.route === 'group') go({ name: 'group', id: n.link.id });
                      else if (n.link?.route === 'org') go({ name: 'org', id: n.link.id });
                      else ws.reload();
                    })
                  }
                >
                  <strong>{n.title}</strong>
                  {n.lines.map((l, i) => (
                    <span key={i} className="notif-line">
                      {l}
                    </span>
                  ))}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {empty && (
        <section className="card">
          <p>Bạn chưa có việc nào.</p>
          {w.firstOrgId && (
            <a className="button" href={href({ name: 'calendar' })} onClick={() => setCurrentOrg(w.firstOrgId!)}>
              Xem lịch sắp tới
            </a>
          )}
        </section>
      )}
    </>
  );
}
