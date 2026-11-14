import type { MeResponse } from '@collab/shared';
import { useEffect, useState } from 'react';

type Membership = MeResponse['memberships'][number];

/**
 * Tổ chức đang xem cho các tab theo tổ chức (Lịch, Chat, Nhóm) — UX §2 "Đổi tổ chức" trong menu cá nhân.
 * Lấy tổ chức đã chọn nếu còn là thành viên, nếu không thì tổ chức đầu tiên.
 */
export function pickOrg(memberships: Membership[], stored: string | null): Membership | null {
  return memberships.find((m) => m.orgId === stored) ?? memberships[0] ?? null;
}

const KEY = 'collab.currentOrg';
const EVENT = 'collab:current-org';
const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

/** Chọn tổ chức đang xem (menu cá nhân, sau khi nhận lời mời, sau khi tạo tổ chức). */
export function setCurrentOrg(orgId: string) {
  try {
    localStorage.setItem(KEY, orgId);
  } catch {
    /* bộ nhớ bị chặn: chỉ nhớ trong phiên qua sự kiện dưới */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: orgId }));
}

export function useCurrentOrg(memberships: Membership[]) {
  const [stored, setStored] = useState(read);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === KEY && setStored(e.newValue);
    const onPick = (e: Event) => setStored((e as CustomEvent<string>).detail);
    window.addEventListener('storage', onStorage);
    window.addEventListener(EVENT, onPick);
    return () => (window.removeEventListener('storage', onStorage), window.removeEventListener(EVENT, onPick));
  }, []);
  return pickOrg(memberships, stored);
}
