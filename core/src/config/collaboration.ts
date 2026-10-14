export type ProjectRole = 'owner' | 'editor' | 'viewer';
export type ProjectTier = 'free' | 'pro' | 'pro_plus';

export const PROJECT_MEMBER_CAPS: Record<ProjectTier, number> = {
  free: 2,
  pro: 10,
  pro_plus: 10,
};

export const PROJECT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PROJECT_TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PROJECT_INVITE_RATE_LIMIT = { max: 10, windowMs: 60 * 60 * 1000 } as const;

const ROLE_RANK: Record<ProjectRole, number> = { viewer: 1, editor: 2, owner: 3 };

export function roleAtLeast(role: ProjectRole, minimum: ProjectRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function canInvite(role: ProjectRole): boolean {
  return roleAtLeast(role, 'editor');
}

export function canWriteProject(role: ProjectRole): boolean {
  return roleAtLeast(role, 'editor');
}

export function canManageProject(role: ProjectRole): boolean {
  return role === 'owner';
}

export function canDeleteProject(role: ProjectRole): boolean {
  return role === 'owner';
}

export function memberCapForTier(tier: ProjectTier): number {
  return PROJECT_MEMBER_CAPS[tier];
}

export function activeInviteOrMemberCount(memberCount: number, pendingInviteCount: number): number {
  return Math.max(0, memberCount - 1) + Math.max(0, pendingInviteCount);
}

export function canAddMember(tier: ProjectTier, memberCount: number, pendingInviteCount = 0): boolean {
  return activeInviteOrMemberCount(memberCount, pendingInviteCount) < memberCapForTier(tier);
}

export function nextTransferStatus(
  current: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired',
  action: 'accept' | 'decline' | 'cancel',
): 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired' {
  if (current !== 'pending') return current;
  if (action === 'accept') return 'accepted';
  if (action === 'decline') return 'declined';
  return 'cancelled';
}

export function maskEmail(email: string): string {
  const [local, domain] = email.trim().toLowerCase().split('@');
  if (!local || !domain) return 'hidden email';
  if (local.length <= 2) return `${local[0] ?? '*'}***@${domain}`;
  return `${local[0]}${'*'.repeat(Math.min(4, local.length - 2))}${local.at(-1)}@${domain}`;
}
