import type { ProjectRole } from '../config/projectCollaboration';

const rank: Record<ProjectRole, number> = { viewer: 1, editor: 2, owner: 3 };

export function roleAtLeast(role: ProjectRole, minimum: ProjectRole): boolean {
  return rank[role] >= rank[minimum];
}

export function canInvite(role: ProjectRole): boolean { return roleAtLeast(role, 'editor'); }
export function canManageMembers(role: ProjectRole): boolean { return role === 'owner'; }
export function canDeleteProject(role: ProjectRole): boolean { return role === 'owner'; }
export function canWriteFiles(role: ProjectRole): boolean { return roleAtLeast(role, 'editor'); }
export function canViewProject(role: ProjectRole): boolean { return roleAtLeast(role, 'viewer'); }

export function validInvite({ signedInEmail, invitedEmail, expired, revoked, accepted }: {
  signedInEmail: string; invitedEmail: string; expired: boolean; revoked: boolean; accepted: boolean;
}): { ok: true } | { ok: false; code: string } {
  if (accepted) return { ok: false, code: 'invite_used' };
  if (revoked) return { ok: false, code: 'invite_revoked' };
  if (expired) return { ok: false, code: 'invite_expired' };
  if (signedInEmail.trim().toLowerCase() !== invitedEmail.trim().toLowerCase()) return { ok: false, code: 'invite_email_mismatch' };
  return { ok: true };
}

export type TransferStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
export function transferTransition(status: TransferStatus, action: 'accept' | 'decline' | 'cancel'): TransferStatus {
  if (status !== 'pending') throw new Error('Only pending transfers can change state.');
  return action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'cancelled';
}

export function memberCapReached(activeInvitedMembers: number, pendingInvites: number, cap: number): boolean {
  return activeInvitedMembers + pendingInvites >= cap;
}
