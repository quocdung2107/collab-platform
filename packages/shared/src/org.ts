import type { GroupRole, OrgRole } from './identity.js';

export interface OrganizationDto {
  id: string;
  name: string;
  timezone: string;
  defaultEventVisibility: 'org' | 'groups';
  reconfirmThresholdMin: number;
  version: number;
  myRole: OrgRole;
}

export interface MemberDto {
  userId: string;
  displayName: string;
  role: OrgRole;
  joinedAt: string;
  /** Theo contact_visibility của người đó; null khi người xem không được thấy. */
  email: string | null;
  phone: string | null;
}

export interface InviteDto {
  id: string;
  role: 'admin' | 'member';
  groupId: string | null;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string;
  createdAt: string;
}

export interface CreatedInviteDto extends InviteDto {
  /** Token gốc chỉ trả về một lần khi tạo (T13). */
  token: string;
}

export type InviteStatus = 'valid' | 'expired' | 'revoked' | 'used_up';

export interface InvitePreviewDto {
  orgName: string;
  status: InviteStatus;
  alreadyMember: boolean;
}

export interface AcceptInviteResult {
  orgId: string;
  alreadyMember: boolean;
  groupId: string | null;
}

export interface GroupSummaryDto {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  myRole: GroupRole | null;
  archived: boolean;
  version: number;
}

export interface GroupMemberDto {
  userId: string;
  displayName: string;
  role: GroupRole;
  addedAt: string;
}

export interface GroupDetailDto extends GroupSummaryDto {
  orgId: string;
  members: GroupMemberDto[];
}
