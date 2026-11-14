import { useCallback, useEffect, useState } from 'react';
import { errorText } from './api';

/** Tải dữ liệu qua API; reload() để tải lại sau lệnh hoặc tín hiệu realtime. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fn = useCallback(load, deps);
  useEffect(() => {
    let live = true;
    fn().then(
      (d) => live && (setData(d), setError(null)),
      (e: unknown) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [fn, tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}

/** Chạy một lệnh, báo lỗi dễ hiểu, rồi gọi after(). */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(fn: () => Promise<T>, after?: (r: T) => void) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      after?.(r);
      return r;
    } catch (e) {
      setError(errorText(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}
