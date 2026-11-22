import type { WorkspaceAssignmentDto, WorkspaceTaskDto } from '@collab/shared';
import { api } from '../lib/api';
import { setCurrentOrg } from '../lib/currentOrg';
import { shortDay, timeLabel } from '@collab/client';
import { Icon } from '../ui/icons';
import { DateTile, Skeleton } from '../ui/kit';
import { useRealtime } from '../lib/realtime';
import { go, href } from '../lib/route';
import { useLoad } from '@collab/client';
import { groupShort } from '@collab/client';
import { RespondButtons } from './Respond';

type Item = WorkspaceAssignmentDto | WorkspaceTaskDto;

/** My Workspace (UX §4.1): Cần xử lý (điều phối) · Cần phản hồi · Sắp tới · Có gì mới. */
export function Today({ meId, renderTask }: { meId: string; renderTask?: (t: WorkspaceTaskDto, reload: () => void) => React.ReactNode }) {
  const ws = useLoad(() => api.workspace(), []);
  useRealtime([`user:${meId}`], ws.reload);
  if (ws.error) return <p className="error">{ws.error}</p>;
  if (!ws.data) return <Skeleton rows={2} sections={2} />;
  const w = ws.data;
  const empty = !w.needsResponse.length && !w.upcoming.length && !w.news.length && !w.coordinate?.shortPositions.length && !w.coordinate?.declinedTasks.length;

  const needs = (x: Item) => (x.kind === 'assignment' ? x.status === 'requested' || x.status === 'reconfirm' : false);
  const row = (x: Item, withDate = false) =>
    x.kind === 'assignment' ? (
      <li key={x.id} className="item">
        <a className="cell-link" href={href({ name: 'event', id: x.eventId })}>
          {withDate ? (
            <DateTile iso={x.reportAt} />
          ) : (
            <span className="leading-icon kind-event">
              <Icon name="calendar" size={18} />
            </span>
          )}
          <span className="grid">
            <strong>{x.eventTitle}</strong>
            <span className="hint">
              {x.positionName} · có mặt {timeLabel(x.reportAt)}
              {withDate ? '' : `, ${shortDay(x.reportAt)}`}
              {x.location ? ` · ${x.location}` : ''}
            </span>
            <span className="hint small">
              {x.groupName ? `${x.groupName} · ` : ''}
              {x.orgName}
            </span>
          </span>
          {x.status === 'reconfirm' && <span className="tag warn">Đã dời giờ</span>}
          {x.status === 'accepted' && <span className="tag ok">Đã nhận</span>}
        </a>
        {needs(x) && <RespondButtons assignmentId={x.id} status={x.status} onDone={ws.reload} large />}
      </li>
    ) : (
      <li key={x.id} className="item">
        {renderTask ? (
          renderTask(x, ws.reload)
        ) : (
          <a className="cell-link" href={href({ name: 'task', id: x.id })}>
            {withDate && x.dueAt ? (
              <DateTile iso={x.dueAt} />
            ) : (
              <span className="leading-icon kind-task">
                <Icon name="work" size={18} />
              </span>
            )}
            <span className="grid">
              <strong>{x.title}</strong>
              <span className="hint">
                Việc{x.scope.name ? ` · ${x.scope.name}` : ''}
                {x.dueAt ? ` · hạn ${timeLabel(x.dueAt)} ${shortDay(x.dueAt)}` : ''}
              </span>
              <span className="hint small">
                {x.orgName}
                {x.acceptance === 'pending' ? ' · chờ bạn nhận' : ''}
              </span>
            </span>
            {x.overdue ? <span className="tag warn">Quá hạn</span> : x.acceptance === 'pending' ? <span className="tag info">Chờ nhận</span> : null}
          </a>
        )}
      </li>
    );

  return (
    <>
      {w.coordinate && (w.coordinate.shortPositions.length > 0 || w.coordinate.declinedTasks.length > 0) && (
        <section className="card">
          <h2>Cần xử lý</h2>
          <ul className="list">
            {groupShort(w.coordinate.shortPositions).map((g) => (
              <li key={g.eventId}>
                <a className="cell-link" href={href({ name: 'event', id: g.eventId })}>
                  <span className="leading-icon kind-warn">
                    <Icon name="alert" size={18} />
                  </span>
                  <span className="grid">
                    <strong>
                      {g.eventTitle} · {shortDay(g.startsAt)}
                    </strong>
                    <span className="hint">{g.positions.map((p) => `${p.name} thiếu ${p.missing}`).join(' · ')}</span>
                  </span>
                  <span className={g.draft ? 'tag' : 'tag warn'}>{g.draft ? 'Bản nháp' : `thiếu ${g.total}`}</span>
                </a>
              </li>
            ))}
            {w.coordinate.declinedTasks.map((t) => (
              <li key={t.id}>
                <a className="cell-link" href={href({ name: 'task', id: t.id })}>
                  <span className="leading-icon kind-warn">
                    <Icon name="alert" size={18} />
                  </span>
                  <span className="grid">
                    <strong>{t.title}</strong>
                    <span className="hint">{t.declinedBy} đã từ chối: cần giao lại</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {w.needsResponse.length > 0 && (
        <section className="card">
          <h2>Cần phản hồi ({w.needsResponse.length})</h2>
          <ul className="list">{w.needsResponse.map((x) => row(x))}</ul>
        </section>
      )}
      {w.upcoming.length > 0 && (
        <section className="card">
          <h2>Sắp tới</h2>
          <ul className="list">{w.upcoming.map((x) => row(x, true))}</ul>
        </section>
      )}
      {w.news.length > 0 && (
        <section className="card">
          <h2>Có gì mới</h2>
          <ul className="list">
            {w.news.map((n) => (
              <li key={n.id}>
                <button
                  className="cell-link notif-body"
                  onClick={() =>
                    void api.readNotification(n.id).then(() => {
                      if (n.link?.route === 'event') go({ name: 'event', id: n.link.id });
                      else if (n.link?.route === 'group') go({ name: 'group', id: n.link.id });
                      else if (n.link?.route === 'org') go({ name: 'org', id: n.link.id });
                      else ws.reload();
                    })
                  }
                >
                  <span className="leading-icon kind-news">
                    <Icon name="bell" size={18} />
                  </span>
                  <span className="grid">
                  <strong>{n.title}</strong>
                  {n.lines.map((l, i) => (
                    <span key={i} className="notif-line">
                      {l}
                    </span>
                  ))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {empty && (
        <section className="card empty-state">
          <Icon name="work" size={40} />
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
