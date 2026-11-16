import type { AssignmentDto, EventDto, MemberDto, PositionDto } from '@collab/shared';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { addMinutes, timeLabel } from '../lib/datetime';
import { useAction } from '../lib/useLoad';
import { dialogs } from '../ui/dialogs';
import { Icon } from '../ui/icons';
import { Sheet } from '../ui/kit';
import { initialsOf } from '../ui/Shell';
import { assignmentStatusLabel } from './EventLabels';

/**
 * Bảng phân công (F4, IN-58): danh sách gọn không nút trên từng dòng. Chạm một dòng (vị trí hoặc người) để chọn;
 * mọi thao tác nằm ở thanh chỉnh sửa riêng: "Chỉnh sửa" mở danh sách thao tác hợp với dòng đã chọn, "Xoá" luôn hỏi lại.
 */
type Sel = { kind: 'position'; positionId: string } | { kind: 'person'; positionId: string; assignmentId: string } | null;

const OCCUPYING = ['draft', 'requested', 'accepted', 'reconfirm'];
const tone = (s: AssignmentDto['status']) =>
  s === 'accepted' ? 'tag ok' : s === 'declined' || s === 'reconfirm' ? 'tag warn' : s === 'requested' ? 'tag info' : 'tag';

const fmtDay = (d: string) => d.split('-').reverse().slice(0, 2).join('/');

export function AssignmentBoard({
  e,
  meId,
  members,
  onChanged,
  onNotice,
}: {
  e: EventDto;
  meId: string;
  members: MemberDto[];
  onChanged: () => void;
  onNotice: (s: string | null) => void;
}) {
  const act = useAction();
  const [sel, setSel] = useState<Sel>(null);
  const [adding, setAdding] = useState(false);
  const cancelled = e.status === 'cancelled';
  const published = e.status === 'published';
  const canEditAny = !cancelled && (e.positions.some((p) => p.canManage) || e.canAddPositions);

  // Dòng đã chọn biến mất sau khi tải lại (bị gỡ, bị xoá) → bỏ chọn.
  const pos = sel ? e.positions.find((p) => p.id === sel.positionId) : undefined;
  const asg = sel?.kind === 'person' ? pos?.assignments.find((a) => a.id === sel.assignmentId) : undefined;
  useEffect(() => {
    if (sel && (!pos || (sel.kind === 'person' && (!asg || asg.status === 'cancelled')))) setSel(null);
  }, [sel, pos, asg]);
  useEffect(() => {
    // Esc bỏ chọn, trừ khi đang mở hộp thoại/bảng trượt (Esc khi đó chỉ đóng hộp thoại).
    const esc = (k: KeyboardEvent) => k.key === 'Escape' && !document.querySelector('.sheet-layer') && setSel(null);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  const total = e.positions.reduce((n, p) => n + p.slots, 0);
  const filled = e.positions.reduce((n, p) => n + p.filled, 0);
  const waiting = e.positions.flatMap((p) => p.assignments).filter((a) => a.status === 'requested' || a.status === 'reconfirm').length;
  const declined = e.positions.flatMap((p) => p.assignments).filter((a) => a.status === 'declined').length;

  const pick = (s: Sel) => (canEditAny ? setSel((cur) => (JSON.stringify(cur) === JSON.stringify(s) ? null : s)) : undefined);
  const editable = (p?: PositionDto) => !!p && p.canManage && !cancelled;
  const freeMembers = (p: PositionDto) => {
    const taken = new Set(p.assignments.filter((a) => a.status !== 'cancelled').map((a) => a.userId));
    return members.filter((m) => !taken.has(m.userId));
  };

  const assignTo = async (p: PositionDto) => {
    const options = freeMembers(p);
    if (!options.length) return onNotice('Không còn ai trong tổ chức để xếp.');
    const who = await dialogs.choose({ title: `Xếp người vào ${p.name}`, options: options.map((m) => ({ label: m.displayName, value: m.userId })) });
    if (who)
      void act.run(
        () => api.assign(p.id, who),
        (r) => {
          const notes = r.warnings.map((w) =>
            w.code === 'member_busy'
              ? `${r.assignment.displayName} đã đánh dấu bận ${w.startsOn === w.endsOn ? `ngày ${fmtDay(w.startsOn)}` : `từ ${fmtDay(w.startsOn)} đến ${fmtDay(w.endsOn)}`}.`
              : `${r.assignment.displayName} đã được xếp vào "${w.title}" trùng giờ.`,
          );
          onNotice(notes.length ? `Lưu ý: ${notes.join(' ')}` : null);
          onChanged();
        },
      );
  };

  type Op = 'assign' | 'slots' | 'rename' | 'offset' | 'accept' | 'decline' | 'replace';
  const edit = async () => {
    if (!pos || !editable(pos)) return;
    if (asg) {
      const onBehalf = published && asg.userId !== meId && (asg.status === 'requested' || asg.status === 'reconfirm');
      const options: Array<{ label: string; detail?: string; value: Op }> = [
        ...(onBehalf ? [{ label: 'Nhận hộ', detail: 'Ghi nhận người này đã đồng ý', value: 'accept' as const }] : []),
        ...(onBehalf ? [{ label: 'Từ chối hộ', detail: 'Cần ghi lý do', value: 'decline' as const }] : []),
        ...(published && asg.status !== 'draft' ? [{ label: 'Thay người khác…', detail: 'Người cũ và người mới đều được báo', value: 'replace' as const }] : []),
      ];
      if (!options.length) return onNotice('Người này chưa có thao tác chỉnh nào. Dùng "Xoá" để bỏ khỏi vị trí.');
      const op = await dialogs.choose<Op>({ title: `${asg.displayName} · ${pos.name}`, message: assignmentStatusLabel[asg.status], options });
      if (op === 'accept') void act.run(() => api.respondAssignment(asg.id, { response: 'accept', expectedStatus: asg.status }), onChanged);
      else if (op === 'decline') {
        const r = await dialogs.prompt({ title: 'Từ chối hộ', message: 'Lý do: chỉ người điều phối và người được xếp thấy.', placeholder: 'Lý do', required: true, confirmLabel: 'Từ chối', danger: true });
        if (r?.trim()) void act.run(() => api.respondAssignment(asg.id, { response: 'decline', reason: r.trim(), expectedStatus: asg.status }), onChanged);
      } else if (op === 'replace') {
        const options2 = freeMembers(pos);
        if (!options2.length) return onNotice('Không còn ai trong tổ chức để thay.');
        const who = await dialogs.choose({ title: `Thay ${asg.displayName} ở ${pos.name}`, options: options2.map((m) => ({ label: m.displayName, value: m.userId })) });
        if (who) void act.run(() => api.replaceAssignment(asg.id, who, asg.status), onChanged);
      }
      return;
    }
    const op = await dialogs.choose<Op>({
      title: pos.name,
      message: `${pos.filled}/${pos.slots} người${pos.groupName ? ` · ${pos.groupName}` : ''}`,
      options: [
        ...(pos.filled < pos.slots ? [{ label: 'Xếp người…', value: 'assign' as const }] : []),
        { label: 'Đổi số người cần', detail: `Hiện ${pos.slots}`, value: 'slots' },
        { label: 'Đổi tên vị trí', value: 'rename' },
        { label: 'Đổi giờ có mặt', detail: pos.reportOffsetMin ? `Trước ${-pos.reportOffsetMin} phút` : 'Đúng giờ bắt đầu', value: 'offset' },
      ],
    });
    if (op === 'assign') return assignTo(pos);
    if (op === 'slots') {
      const v = await dialogs.prompt({ title: `Số người cần cho ${pos.name}`, initial: String(pos.slots), inputType: 'number', required: true, confirmLabel: 'Lưu' });
      const n = Number(v);
      if (Number.isInteger(n) && n > 0 && n !== pos.slots) void act.run(() => api.updatePosition(pos.id, { expectedVersion: pos.version, slots: n }), onChanged);
    } else if (op === 'rename') {
      const v = await dialogs.prompt({ title: 'Tên vị trí', initial: pos.name, required: true, maxLength: 120, confirmLabel: 'Lưu' });
      if (v?.trim() && v.trim() !== pos.name) void act.run(() => api.updatePosition(pos.id, { expectedVersion: pos.version, name: v.trim() }), onChanged);
    } else if (op === 'offset') {
      const v = await dialogs.prompt({ title: 'Có mặt trước giờ bắt đầu (phút)', initial: String(-pos.reportOffsetMin), inputType: 'number', required: true, confirmLabel: 'Lưu' });
      const n = Number(v);
      if (Number.isInteger(n) && n >= 0 && -n !== pos.reportOffsetMin) void act.run(() => api.updatePosition(pos.id, { expectedVersion: pos.version, reportOffsetMin: -n }), onChanged);
    }
  };

  const remove = async () => {
    if (!pos || !editable(pos)) return;
    if (asg) {
      const draft = asg.status === 'draft';
      const ok = await dialogs.confirm({
        title: `Gỡ ${asg.displayName} khỏi ${pos.name}?`,
        message: draft ? 'Buổi chưa công bố nên chưa ai được báo.' : asg.status === 'declined' ? 'Người này đã từ chối; dòng sẽ được dọn khỏi bảng.' : 'Người này sẽ nhận thông báo đã gỡ.',
        confirmLabel: 'Gỡ',
        danger: true,
      });
      if (!ok) return;
      void act.run<unknown>(() => (draft ? api.cancelDraftAssignment(asg.id) : api.cancelAssignment(asg.id, asg.status)), () => (setSel(null), onChanged()));
      return;
    }
    const people = pos.assignments.filter((a) => OCCUPYING.includes(a.status)).length;
    const ok = await dialogs.confirm({
      title: `Xoá vị trí ${pos.name}?`,
      message: people ? `${people} người đang được xếp ở vị trí này${published ? ' sẽ nhận thông báo huỷ' : ''}.` : 'Vị trí chưa có ai.',
      confirmLabel: 'Xoá vị trí',
      danger: true,
    });
    if (ok) void act.run(() => api.removePosition(pos.id), () => (setSel(null), onChanged()));
  };

  const selLabel = asg && pos ? `${asg.displayName} · ${pos.name}` : pos ? `Vị trí ${pos.name}` : null;
  // "Xoá" một người đã từ chối: backend không gỡ dòng declined (không chiếm chỗ) → ẩn nút.
  const canRemove = !!pos && editable(pos) && (!asg || asg.status !== 'declined');

  return (
    <section className="card board">
      <div className="board-head">
        <h2>Phân công</h2>
        {total > 0 && (
          <span className="board-sum">
            <strong>
              {filled}/{total}
            </strong>{' '}
            chỗ{waiting ? ` · ${waiting} chờ trả lời` : ''}
            {declined ? ` · ${declined} từ chối` : ''}
          </span>
        )}
      </div>
      {e.positions.length === 0 && <p className="hint">Chưa có vị trí.</p>}
      {e.positions.length > 0 && (
        <div className="board-table" role="grid" aria-label="Bảng phân công">
          {e.positions.map((p) => {
            const people = p.assignments.filter((a) => a.status !== 'cancelled');
            const empty = Math.max(0, p.slots - p.filled);
            const selectable = canEditAny && editable(p);
            const posSel = sel?.kind === 'position' && sel.positionId === p.id;
            return (
              <div key={p.id} role="rowgroup" className="board-group">
                <div
                  role="row"
                  aria-selected={posSel}
                  tabIndex={selectable ? 0 : -1}
                  className={`board-row board-pos${posSel ? ' on' : ''}${selectable ? ' pickable' : ''}`}
                  onClick={() => selectable && pick({ kind: 'position', positionId: p.id })}
                  onKeyDown={(k) => selectable && (k.key === 'Enter' || k.key === ' ') && (k.preventDefault(), pick({ kind: 'position', positionId: p.id }))}
                >
                  <span className="board-main">
                    <strong>{p.name}</strong>
                    <span className="hint">
                      {p.groupName ?? 'Không thuộc nhóm'}
                      {p.reportOffsetMin !== 0 && ` · có mặt ${timeLabel(addMinutes(e.startsAt, p.reportOffsetMin))}`}
                    </span>
                  </span>
                  <span className={p.filled < p.slots ? 'count short' : 'count'}>
                    {p.filled}/{p.slots}
                  </span>
                </div>
                {people.map((a) => {
                  const on = sel?.kind === 'person' && sel.assignmentId === a.id;
                  const s: Sel = { kind: 'person', positionId: p.id, assignmentId: a.id };
                  return (
                    <div
                      key={a.id}
                      role="row"
                      aria-selected={on}
                      tabIndex={selectable ? 0 : -1}
                      className={`board-row board-person${on ? ' on' : ''}${selectable ? ' pickable' : ''}${a.status === 'declined' ? ' muted' : ''}`}
                      onClick={() => selectable && pick(s)}
                      onKeyDown={(k) => selectable && (k.key === 'Enter' || k.key === ' ') && (k.preventDefault(), pick(s))}
                    >
                      <span className="avatar sm" aria-hidden>
                        {initialsOf(a.displayName)}
                      </span>
                      <span className="board-main">
                        <span>
                          {a.displayName}
                          {a.userId === meId && <span className="hint"> (bạn)</span>}
                        </span>
                        {(a.declineReason || (a.respondedBy && a.respondedBy !== a.userId && a.status !== 'requested')) && (
                          <span className="hint">
                            {a.declineReason ? `“${a.declineReason}”` : 'người điều phối trả lời thay'}
                          </span>
                        )}
                      </span>
                      <span className={tone(a.status)}>{assignmentStatusLabel[a.status]}</span>
                    </div>
                  );
                })}
                {Array.from({ length: empty }, (_, i) => (
                  <div
                    key={`empty-${i}`}
                    role="row"
                    tabIndex={-1}
                    className={`board-row board-empty${selectable ? ' pickable' : ''}`}
                    onClick={() => selectable && setSel({ kind: 'position', positionId: p.id })}
                  >
                    <span className="avatar sm empty" aria-hidden />
                    <span className="board-main hint">Còn trống</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {act.error && <p className="error">{act.error}</p>}
      {canEditAny && (
        <div className={`board-bar${selLabel ? ' active' : ''}`} role="toolbar" aria-label="Chỉnh sửa phân công">
          <span className="board-sel">{selLabel ?? 'Chọn một dòng để chỉnh sửa'}</span>
          {selLabel ? (
            <>
              <button className="button small" onClick={() => setSel(null)} aria-label="Bỏ chọn">
                Bỏ chọn
              </button>
              <button className="button small primary" disabled={act.busy} onClick={() => void edit()}>
                <Icon name="more" size={16} /> Chỉnh sửa
              </button>
              {canRemove && (
                <button className="button small danger" disabled={act.busy} onClick={() => void remove()}>
                  {asg ? 'Gỡ' : 'Xoá'}
                </button>
              )}
            </>
          ) : (
            e.canAddPositions && (
              <button className="button small primary" onClick={() => setAdding(true)}>
                <Icon name="plus" size={16} /> Thêm vị trí
              </button>
            )
          )}
        </div>
      )}
      {adding && (
        <Sheet title="Thêm vị trí" onClose={() => setAdding(false)}>
          <AddPosition e={e} onAdded={() => (setAdding(false), onChanged())} />
        </Sheet>
      )}
    </section>
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
        void act.run(() => api.createPosition(e.id, { name, groupId: groupId || null, slots, reportOffsetMin: -offset }), onAdded);
      }}
    >
      <input value={name} onChange={(x) => setName(x.target.value)} placeholder="Tên vị trí (vd. Âm thanh)" required maxLength={120} autoFocus />
      <select value={groupId} onChange={(x) => setGroupId(x.target.value)} aria-label="Nhóm">
        {e.canEdit && <option value="">Không thuộc nhóm</option>}
        {e.groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <div className="row">
        <label className="row hint">
          Số người <input type="number" min={1} max={100} value={slots} onChange={(x) => setSlots(Number(x.target.value))} style={{ width: 72 }} />
        </label>
        <label className="row hint">
          Có mặt trước (phút) <input type="number" min={0} step={5} value={offset} onChange={(x) => setOffset(Number(x.target.value))} style={{ width: 72 }} />
        </label>
      </div>
      {act.error && <p className="error">{act.error}</p>}
      <button className="button primary" disabled={act.busy || !name}>
        Thêm vị trí
      </button>
    </form>
  );
}
