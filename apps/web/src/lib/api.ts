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
  MessageDto,
  MessagePageDto,
  ConversationSummaryDto,
  MemberDto,
  OrganizationDto,
  OrgRole,
  CreatedAssignmentDto,
  AssignmentResultDto,
  AssignmentStatus,
  CreatedEventDto,
  EventDto,
  EventSummaryDto,
  EventTemplateDto,
  EventVisibility,
  NotificationCountsDto,
  NotificationPageDto,
  SubscriptionMode,
  WorkspaceDto,
  TaskDto,
  TaskSummaryDto,
  RelatedDto,
  AttachmentDto,
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
  workspace: () => request<WorkspaceDto>('/v1/me/workspace'),

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

  conversations: (orgId: string) => request<ConversationSummaryDto[]>(`/v1/organizations/${orgId}/conversations`),
  groupConversation: (groupId: string) => request<ConversationSummaryDto>(`/v1/groups/${groupId}/conversation`),
  messages: (conversationId: string, q: { beforeSeq?: number; afterSeq?: number; limit?: number } = {}) => {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
    return request<MessagePageDto>(`/v1/conversations/${conversationId}/messages${qs.size ? `?${qs}` : ''}`);
  },
  /** clientMsgId là khoá idempotent (F9-T1): gửi lại cùng khoá không tạo tin thứ hai. */
  sendMessage: (conversationId: string, body: { clientMsgId: string; body: string; replyToId?: string; mentionIds?: string[]; attachments?: UploadedFile[] }) =>
    request<MessageDto>(`/v1/conversations/${conversationId}/messages`, json('POST', body)),
  editMessage: (messageId: string, body: { body: string; mentionIds: string[] }) => request<MessageDto>(`/v1/messages/${messageId}`, json('PATCH', body)),
  deleteMessage: (messageId: string) => request<MessageDto>(`/v1/messages/${messageId}`, json('DELETE')),
  markRead: (conversationId: string, seq: number) =>
    request<ConversationSummaryDto>(`/v1/conversations/${conversationId}/read`, json('POST', { seq })),

  events: (orgId: string, q: { from: string; to: string; mine?: boolean }) =>
    request<EventSummaryDto[]>(`/v1/organizations/${orgId}/events?${new URLSearchParams({ from: q.from, to: q.to, ...(q.mine ? { mine: 'true' } : {}) })}`),
  createEvent: (orgId: string, body: NewEventBody) => request<CreatedEventDto>(`/v1/organizations/${orgId}/events`, json('POST', body, true)),
  event: (eventId: string) => request<EventDto>(`/v1/events/${eventId}`),
  updateEvent: (eventId: string, body: EventPatch & { expectedVersion: number }) => request<EventDto>(`/v1/events/${eventId}`, json('PATCH', body)),
  rescheduleEvent: (eventId: string, body: { expectedVersion: number; startsAt: string; endsAt: string; reason?: string }) =>
    request<{ event: EventDto; summary: RescheduleSummary }>(`/v1/events/${eventId}/reschedule`, json('POST', body)),
  relocateEvent: (eventId: string, body: { expectedVersion: number; location: string | null }) => request<EventDto>(`/v1/events/${eventId}/relocate`, json('POST', body)),
  cancelEvent: (eventId: string, body: { expectedVersion: number; reason?: string }) => request<EventDto>(`/v1/events/${eventId}/cancel`, json('POST', body)),
  task: (id: string) => request<TaskDto>(`/v1/tasks/${id}`),
  requestUpload: (orgId: string, body: { filename: string; size: number }) =>
    request<{ key: string; uploadUrl: string; token: string }>(`/v1/organizations/${orgId}/uploads`, json('POST', body)),
  attachmentUrl: (id: string) => request<{ url: string; expiresAt: string }>(`/v1/attachments/${id}/url`),
  attachments: (owner: 'events' | 'tasks', id: string) => request<AttachmentDto[]>(`/v1/${owner}/${id}/attachments`),
  addAttachment: (owner: 'events' | 'tasks', id: string, file: UploadedFile) => request<AttachmentDto>(`/v1/${owner}/${id}/attachments`, json('POST', file, true)),
  removeAttachment: (id: string) => request(`/v1/attachments/${id}`, json('DELETE')),
  related: (type: 'event' | 'task', id: string) => request<RelatedDto>(`/v1/${type}s/${id}/related`),
  linkObjects: (from: { type: 'event' | 'task'; id: string }, to: { type: 'event' | 'task'; id: string }) =>
    request<{ linkId: string }>('/v1/links', json('POST', { from, to }, true)),
  unlink: (linkId: string) => request(`/v1/links/${linkId}`, json('DELETE')),
  eventTasks: (eventId: string) => request<TaskSummaryDto[]>(`/v1/events/${eventId}/tasks`),
  groupTasks: (groupId: string) => request<TaskSummaryDto[]>(`/v1/groups/${groupId}/tasks`),
  createTask: (body: NewTaskBody) => request<TaskDto>('/v1/tasks', json('POST', body, true)),
  updateTask: (id: string, body: { expectedVersion: number; title?: string; description?: string | null; dueAt?: string | null; dueOffsetMin?: number | null }) =>
    request<TaskDto>(`/v1/tasks/${id}`, json('PATCH', body)),
  assignTask: (id: string, body: { expectedVersion: number; ownerId: string | null; requiresAcceptance?: boolean }) =>
    request<TaskDto | null>(`/v1/tasks/${id}/assign`, json('POST', body)),
  respondTask: (id: string, body: { response: 'accept' | 'decline'; reason?: string }) => request<TaskDto>(`/v1/tasks/${id}/respond`, json('POST', body)),
  taskStatus: (id: string, body: { expectedVersion: number; status: 'open' | 'in_progress' | 'done' }) => request<TaskDto>(`/v1/tasks/${id}/status`, json('POST', body)),
  cancelTask: (id: string, body: { expectedVersion: number; reason?: string }) => request<TaskDto>(`/v1/tasks/${id}/cancel`, json('POST', body)),
  taskFlags: (id: string, body: { blocked?: boolean; needsHelp?: boolean }) => request<TaskDto>(`/v1/tasks/${id}/flags`, json('POST', body)),
  taskCollaborators: (id: string, body: { add?: string[]; remove?: string[] }) => request<TaskDto | null>(`/v1/tasks/${id}/collaborators`, json('POST', body)),
  openTaskConversation: (id: string) => request<{ conversationId: string }>(`/v1/tasks/${id}/conversation`, json('POST', {})),
  deleteDraft: (eventId: string, expectedVersion: number) => request(`/v1/events/${eventId}`, json('DELETE', { expectedVersion })),
  publishEvent: (eventId: string, expectedVersion: number) =>
    request<{ event: EventDto; requestedCount: number }>(`/v1/events/${eventId}/publish`, json('POST', { expectedVersion })),
  changeOwners: (eventId: string, body: { expectedVersion: number; add?: string[]; remove?: string[] }) =>
    request<EventDto>(`/v1/events/${eventId}/owners`, json('POST', body)),
  createPosition: (eventId: string, body: PositionBody) => request<EventDto>(`/v1/events/${eventId}/positions`, json('POST', body, true)),
  updatePosition: (positionId: string, body: Partial<PositionBody> & { expectedVersion: number }) =>
    request<EventDto>(`/v1/positions/${positionId}`, json('PATCH', body)),
  removePosition: (positionId: string) => request<EventDto>(`/v1/positions/${positionId}`, json('DELETE')),
  assign: (positionId: string, userId: string) => request<CreatedAssignmentDto>(`/v1/positions/${positionId}/assignments`, json('POST', { userId })),
  respondAssignment: (assignmentId: string, body: { response: 'accept' | 'decline'; reason?: string; expectedStatus?: AssignmentStatus }) =>
    request<AssignmentResultDto>(`/v1/assignments/${assignmentId}/respond`, json('POST', body)),
  cancelAssignment: (assignmentId: string, expectedStatus?: AssignmentStatus) =>
    request<AssignmentResultDto>(`/v1/assignments/${assignmentId}/cancel`, json('POST', { expectedStatus })),
  replaceAssignment: (assignmentId: string, newUserId: string, expectedStatus?: AssignmentStatus) =>
    request<CreatedAssignmentDto>(`/v1/assignments/${assignmentId}/replace`, json('POST', { newUserId, expectedStatus })),
  cancelDraftAssignment: (assignmentId: string) => request<EventDto>(`/v1/assignments/${assignmentId}`, json('DELETE')),

  templates: (orgId: string) => request<EventTemplateDto[]>(`/v1/organizations/${orgId}/templates`),
  templateFromEvent: (eventId: string, name: string) => request<EventTemplateDto>(`/v1/events/${eventId}/template`, json('POST', { name }, true)),
  archiveTemplate: (templateId: string) => request(`/v1/templates/${templateId}/archive`, json('POST')),

  notifications: (q: { before?: string; pending?: boolean } = {}) =>
    request<NotificationPageDto>(`/v1/notifications?${new URLSearchParams({ ...(q.before ? { before: q.before } : {}), ...(q.pending ? { pending: 'true' } : {}) })}`),
  notificationCounts: () => request<NotificationCountsDto>('/v1/notifications/counts'),
  readNotification: (id: string) => request<NotificationCountsDto>(`/v1/notifications/${id}/read`, json('POST')),
  readAllNotifications: () => request<NotificationCountsDto>('/v1/notifications/read-all', json('POST')),
  /** Mở đối tượng → mọi thông báo trỏ tới nó thành đã đọc (NOTIFICATION_ENGINE §8.7). */
  readTarget: (type: 'event' | 'group' | 'organization' | 'task' | 'message', id: string) =>
    request<NotificationCountsDto>('/v1/notifications/read-target', json('POST', { type, id })),
  subscription: (type: 'event' | 'task' | 'conversation', id: string) => request<{ mode: SubscriptionMode | null }>(`/v1/subscriptions/${type}/${id}`),
  setSubscription: (type: 'event' | 'task' | 'conversation', id: string, mode: SubscriptionMode | null) =>
    request<{ mode: SubscriptionMode | null }>(`/v1/subscriptions/${type}/${id}`, mode ? json('PUT', { mode }) : json('DELETE')),
};

export interface UploadedFile {
  key: string;
  filename: string;
}

export interface NewTaskBody {
  orgId?: string;
  title: string;
  description?: string | null;
  scope?: { type: 'event' | 'group' | 'private'; eventId?: string; groupId?: string };
  sourceMessageId?: string;
  ownerId?: string | null;
  requiresAcceptance?: boolean;
  dueAt?: string | null;
  dueOffsetMin?: number | null;
}

export interface RescheduleSummary {
  reconfirmCount: number;
  notifiedCount: number;
  tasksShifted: number;
  tasksAbsoluteDue: Array<{ id: string; title: string; dueAt: string }>;
}

export interface EventPatch {
  title?: string;
  description?: string;
  location?: string;
  startsAt?: string;
  endsAt?: string;
  groupIds?: string[];
  visibility?: EventVisibility;
}
export interface NewEventBody extends EventPatch {
  startsAt: string;
  templateId?: string;
  copyFromId?: string;
  keepPeople?: boolean;
}
export interface PositionBody {
  name: string;
  groupId: string | null;
  slots: number;
  reportOffsetMin: number;
}

export const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Không kết nối được máy chủ. Thử lại sau.');
