export type OrgRole = 'owner' | 'admin' | 'member';
export type GroupRole = 'leader' | 'member';

export interface MeResponse {
  user: {
    id: string;
    displayName: string;
    email: string | null;
    locale: string;
  };
  memberships: Array<{ orgId: string; orgName: string; role: OrgRole }>;
}
