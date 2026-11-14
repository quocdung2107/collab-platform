import { useState } from 'react';
import { api, errorText } from '../lib/api';
import { openAttachment, sizeLabel, uploadFile } from '../lib/files';
import { useRealtime } from '../lib/realtime';
import { useAction, useLoad } from '../lib/useLoad';

/** Tệp của buổi / việc (PERMISSION_MODEL §4.7): ai xem được đối tượng thì mở được tệp; người có quyền thêm thì tải lên. */
export function Files({ owner, id, orgId, topic, canAdd, meId }: { owner: 'events' | 'tasks'; id: string; orgId: string; topic: string; canAdd: boolean; meId: string }) {
  const list = useLoad(() => api.attachments(owner, id), [owner, id]);
  useRealtime([topic], list.reload);
  const act = useAction();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!list.data || (!list.data.length && !canAdd)) return null;
  return (
    <section className="card">
      <h2>Tệp</h2>
      <ul className="list">
        {list.data.map((a) => (
          <li key={a.id}>
            <button className="link" onClick={() => void openAttachment(a.id).catch((e) => setErr(errorText(e)))}>
              📎 {a.filename}
            </button>
            <span className="row">
              <span className="hint">
                {sizeLabel(a.sizeBytes)} · {a.uploadedBy.displayName}
              </span>
              {(canAdd || a.uploadedBy.userId === meId) && (
                <button className="button small danger" disabled={act.busy} onClick={() => void act.run(() => api.removeAttachment(a.id), list.reload)}>
                  Gỡ
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {canAdd && (
        <label className="button small">
          {busy ? 'Đang tải…' : 'Thêm tệp'}
          <input
            type="file"
            hidden
            disabled={busy}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              setBusy(true);
              setErr(null);
              try {
                await api.addAttachment(owner, id, await uploadFile(orgId, f));
                list.reload();
              } catch (x) {
                setErr(x instanceof Error ? x.message : errorText(x));
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      )}
      {(err || act.error) && <p className="error">{err ?? act.error}</p>}
    </section>
  );
}
