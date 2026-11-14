import type {
  AcceptInviteResult,
  ApiErrorBody,
  CreatedInviteDto,
  GroupDetailDto,
  GroupRole,
  GroupSummaryDto,
  InviteDto,
  InvitePreviewDto,
  MeResponse,
  MemberDto,
  OrganizationDto,
  OrgRole,
} from '@collab/shared';
import { supabase } from './supabase';

// Rỗng = bản build chưa có máy chủ API (vd. GitHub Pages trước khi host API). Chỉ dùng localhost khi chạy dev.
const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || (import.meta.env.DEV ? 'http://localhost:8080' : '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody['error'],
  ) {
    super(body.message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_URL) {
    throw new ApiError(0, { code: 'internal', message: 'Bản này chưa nối với máy chủ API. Đăng nhập Google đã thành công.' });
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body?.error ?? { code: 'internal', message: res.statusText });
  }
  return (await res.json()) as T;
}

const json = (method: string, body?: unknown, idempotent = false): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
  // Lệnh tạo mới mang Idempotency-Key để bấm lặp / mạng chập chờn không tạo trùng (EVENT_API_CONTRACTS §4).
  headers: idempotent ? { 'Idempotency-Key': crypto.randomUUID() } : undefined,
});

export const api = {
  me: () => request<MeResponse>('/v1/me'),

  createOrg: (name: string) => request<OrganizationDto>('/v1/organizations', json('POST', { name }, true)),
  org: (orgId: string) => request<OrganizationDto>(`/v1/organizations/${orgId}`),
  members: (orgId: string) => request<MemberDto[]>(`/v1/organizations/${orgId}/members`),
  setMemberRole: (orgId: string, userId: string, role: OrgRole) =>
    request(`/v1/organizations/${orgId}/members/${userId}`, json('PATCH', { role })),
  removeMember: (orgId: string, userId: string) => request(`/v1/organizations/${orgId}/members/${userId}`, json('DELETE')),
  leaveOrg: (orgId: string) => request(`/v1/organizations/${orgId}/leave`, json('POST')),

  invites: (orgId: string) => request<InviteDto[]>(`/v1/organizations/${orgId}/invites`),
  createInvite: (orgId: string, body: { groupId?: string; maxUses?: number; expiresInHours?: number }) =>
    request<CreatedInviteDto>(`/v1/organizations/${orgId}/invites`, json('POST', body, true)),
  revokeInvite: (orgId: string, inviteId: string) => request(`/v1/organizations/${orgId}/invites/${inviteId}`, json('DELETE')),
  previewInvite: (token: string) => request<InvitePreviewDto>(`/v1/invites/${token}`),
  acceptInvite: (token: string) => request<AcceptInviteResult>(`/v1/invites/${token}/accept`, json('POST')),

  groups: (orgId: string) => request<GroupSummaryDto[]>(`/v1/organizations/${orgId}/groups`),
  createGroup: (orgId: string, name: string) => request<GroupDetailDto>(`/v1/organizations/${orgId}/groups`, json('POST', { name }, true)),
  group: (groupId: string) => request<GroupDetailDto>(`/v1/groups/${groupId}`),
  archiveGroup: (groupId: string, expectedVersion: number) =>
    request<GroupDetailDto>(`/v1/groups/${groupId}/archive`, json('POST', { expectedVersion })),
  addGroupMember: (groupId: string, userId: string) => request<GroupDetailDto>(`/v1/groups/${groupId}/members`, json('POST', { userId })),
  setGroupRole: (groupId: string, userId: string, role: GroupRole) =>
    request<GroupDetailDto>(`/v1/groups/${groupId}/members/${userId}`, json('PATCH', { role })),
  removeGroupMember: (groupId: string, userId: string) => request(`/v1/groups/${groupId}/members/${userId}`, json('DELETE')),
  leaveGroup: (groupId: string) => request(`/v1/groups/${groupId}/leave`, json('POST')),
};

export const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Không kết nối được máy chủ. Thử lại sau.');
