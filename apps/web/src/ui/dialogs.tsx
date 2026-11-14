import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * Bảng trượt từ đáy thay cho window.confirm / prompt (UX §3, phụ lục AD-25: dùng được một tay).
 * Gọi được từ bất kỳ đâu và trả Promise; <DialogHost/> gắn một lần ở gốc ứng dụng.
 */
export interface ConfirmOpts {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
}
export interface PromptOpts extends ConfirmOpts {
  initial?: string;
  placeholder?: string;
  /** Bắt buộc nhập (nút xác nhận tắt khi trống). */
  required?: boolean;
  multiline?: boolean;
  inputType?: 'text' | 'number';
  /** Gợi ý chạm nhanh, điền vào ô nhập (vd. lý do từ chối thường gặp). */
  suggestions?: string[];
  maxLength?: number;
}
export interface ChooseOpts<T> {
  title: string;
  message?: string;
  options: Array<{ label: string; detail?: string; value: T; danger?: boolean }>;
}

type Req =
  | { kind: 'confirm'; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOpts; resolve: (v: string | null) => void }
  | { kind: 'choose'; opts: ChooseOpts<unknown>; resolve: (v: unknown) => void };

let current: Req | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const open = (r: Req) => {
  // Chỉ một bảng một lúc: bảng cũ coi như huỷ.
  if (current) close(null);
  current = r;
  emit();
};
function close(value: unknown) {
  const r = current;
  current = null;
  emit();
  if (!r) return;
  if (r.kind === 'confirm') r.resolve(Boolean(value));
  else if (r.kind === 'prompt') r.resolve(value as string | null);
  else r.resolve(value);
}

export const dialogs = {
  confirm: (opts: ConfirmOpts) => new Promise<boolean>((resolve) => open({ kind: 'confirm', opts, resolve })),
  prompt: (opts: PromptOpts) => new Promise<string | null>((resolve) => open({ kind: 'prompt', opts, resolve })),
  choose: <T,>(opts: ChooseOpts<T>) =>
    new Promise<T | null>((resolve) => open({ kind: 'choose', opts: opts as ChooseOpts<unknown>, resolve: resolve as (v: unknown) => void })),
};

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const snapshot = () => current;

export function DialogHost() {
  const req = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close(req.kind === 'confirm' ? false : null);
    window.addEventListener('keydown', onKey);
    // Đổi màn hình (vd. cử chỉ quay lại) đóng bảng.
    const onHash = () => close(req.kind === 'confirm' ? false : null);
    window.addEventListener('hashchange', onHash);
    return () => (window.removeEventListener('keydown', onKey), window.removeEventListener('hashchange', onHash));
  }, [req]);
  if (!req) return null;
  const cancel = () => close(req.kind === 'confirm' ? false : null);
  return (
    <div className="sheet-layer">
      <div className="sheet-dim" onClick={cancel} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={req.opts.title}>
        <span className="sheet-grab" aria-hidden="true" />
        <h2 className="sheet-title">{req.opts.title}</h2>
        {req.opts.message && <p className="hint pre">{req.opts.message}</p>}
        {req.kind === 'confirm' && (
          <div className="sheet-actions">
            <button className="button" onClick={cancel}>
              Thôi
            </button>
            <AutoFocusButton className={req.opts.danger ? 'button danger-solid' : 'button primary'} onClick={() => close(true)}>
              {req.opts.confirmLabel ?? 'Đồng ý'}
            </AutoFocusButton>
          </div>
        )}
        {req.kind === 'prompt' && <PromptBody opts={req.opts} onCancel={cancel} onOk={(v) => close(v)} />}
        {req.kind === 'choose' && (
          <>
            <ul className="sheet-options">
              {req.opts.options.map((o, i) => (
                <li key={i}>
                  <button className={o.danger ? 'sheet-option danger' : 'sheet-option'} onClick={() => close(o.value)}>
                    <strong>{o.label}</strong>
                    {o.detail && <span className="hint">{o.detail}</span>}
                  </button>
                </li>
              ))}
            </ul>
            <button className="button" onClick={cancel}>
              Thôi
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function AutoFocusButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return <button ref={ref} {...props} />;
}

function PromptBody({ opts, onCancel, onOk }: { opts: PromptOpts; onCancel: () => void; onOk: (v: string) => void }) {
  const [value, setValue] = useState(opts.initial ?? '');
  const ok = !opts.required || value.trim().length > 0;
  const common = {
    value,
    autoFocus: true,
    placeholder: opts.placeholder,
    maxLength: opts.maxLength ?? 500,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(e.target.value),
  };
  return (
    <form
      className="grid sheet-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onOk(value);
      }}
    >
      {opts.suggestions && opts.suggestions.length > 0 && (
        <div className="chips">
          {opts.suggestions.map((s) => (
            <button type="button" key={s} className={value === s ? 'chip-choice on' : 'chip-choice'} onClick={() => setValue(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      {opts.multiline ? <textarea rows={3} {...common} /> : <input type={opts.inputType ?? 'text'} inputMode={opts.inputType === 'number' ? 'numeric' : undefined} {...common} />}
      <div className="sheet-actions">
        <button type="button" className="button" onClick={onCancel}>
          Thôi
        </button>
        <button className={opts.danger ? 'button danger-solid' : 'button primary'} disabled={!ok}>
          {opts.confirmLabel ?? 'Xong'}
        </button>
      </div>
    </form>
  );
}

/** Hỏi xác nhận rồi mới chạy fn (thay cho `window.confirm(...) && fn()`). */
export function confirmThen(opts: ConfirmOpts, fn: () => unknown) {
  void dialogs.confirm(opts).then((ok) => {
    if (ok) void fn();
  });
}
