import { useEffect, useState, type ReactNode } from 'react';

/** Khung xương khi tải (UX §3 "Trạng thái chung"): giữ bố cục, không nhảy chữ "Đang tải…". */
export function Skeleton({ rows = 3, sections = 1 }: { rows?: number; sections?: number }) {
  return (
    <>
      {Array.from({ length: sections }, (_, s) => (
        <section key={s} className="card skeleton" aria-busy="true" aria-label="Đang tải">
          <span className="sk sk-label" />
          {Array.from({ length: rows }, (_, i) => (
            <span key={i} className="sk-row">
              <span className="sk sk-icon" />
              <span className="grid grow">
                <span className="sk sk-line" />
                <span className="sk sk-line short" />
              </span>
            </span>
          ))}
        </section>
      ))}
    </>
  );
}

/** Băng trạng thái đầu trang: bản nháp, đã huỷ, vị trí của bạn… */
export function Banner({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'danger' | 'ok'; children: ReactNode }) {
  return <div className={`banner ${tone}`}>{children}</div>;
}

/** Ô ngày kiểu lịch: "16 / CN". */
export function DateTile({ iso }: { iso: string }) {
  const d = new Date(iso);
  const wd = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][d.getDay()];
  return (
    <span className="date-tile" aria-hidden="true">
      <b>{d.getDate()}</b>
      <span>{wd}</span>
    </span>
  );
}

/** Thanh chọn phân đoạn (Tất cả / Của tôi…). */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Công tắc kiểu iOS trên nền checkbox thật (giữ hành vi biểu mẫu, đọc màn hình). */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className="switch-row">
      <span className="grow">{label}</span>
      <input type="checkbox" role="switch" className="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** Bảng trượt có nội dung tự do (cây tổng quan, bảng nhịp…); đóng bằng nền mờ, Escape hoặc khi đổi màn hình. */
export function Sheet({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', onClose);
    return () => (window.removeEventListener('keydown', onKey), window.removeEventListener('hashchange', onClose));
  }, [onClose]);
  return (
    <div className="sheet-layer">
      <div className="sheet-dim" onClick={onClose} />
      <div className={wide ? 'sheet wide' : 'sheet'} role="dialog" aria-modal="true" aria-label={title}>
        <span className="sheet-grab" aria-hidden="true" />
        <h2 className="sheet-title">{title}</h2>
        {children}
        <button className="button" onClick={onClose}>
          Xong
        </button>
      </div>
    </div>
  );
}

/** Khớp media query, cập nhật khi đổi kích thước cửa sổ. */
export function useMedia(query: string) {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}
