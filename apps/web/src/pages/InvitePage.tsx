import { api } from '../lib/api';
import { go } from '../lib/route';
import { useAction, useLoad } from '../lib/useLoad';

const STATUS = { expired: 'Liên kết mời đã hết hạn.', revoked: 'Liên kết mời đã bị thu hồi.', used_up: 'Liên kết mời đã hết lượt dùng.' };

export function InvitePage({ token, onJoined }: { token: string; onJoined: () => void }) {
  const preview = useLoad(() => api.previewInvite(token), [token]);
  const accept = useAction();
  const p = preview.data;
  return (
    <section className="card">
      <h1>Lời mời tham gia</h1>
      {preview.error && <p className="error">Liên kết mời không tồn tại hoặc đã bị xoá.</p>}
      {p && (
        <>
          <p>
            Tổ chức: <strong>{p.orgName}</strong>
          </p>
          {p.status !== 'valid' && !p.alreadyMember ? (
            <p className="error">{STATUS[p.status]} Hãy xin người quản lý một liên kết mới.</p>
          ) : (
            <button
              className="button primary"
              disabled={accept.busy}
              onClick={() =>
                void accept.run(
                  () => api.acceptInvite(token),
                  (r) => {
                    onJoined();
                    go(r.groupId ? { name: 'group', id: r.groupId } : { name: 'org', id: r.orgId });
                  },
                )
              }
            >
              {p.alreadyMember ? 'Bạn đã là thành viên — mở tổ chức' : 'Tham gia'}
            </button>
          )}
        </>
      )}
      {accept.error && <p className="error">{accept.error}</p>}
    </section>
  );
}
