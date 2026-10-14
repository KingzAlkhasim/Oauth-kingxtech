import crypto from 'crypto';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import {
  PROJECT_INVITE_TTL_MS,
  PROJECT_INVITE_RATE_LIMIT,
  PROJECT_TRANSFER_TTL_MS,
  canAddMember,
  canInvite,
  canManageProject,
  maskEmail,
  type ProjectRole,
  type ProjectTier,
} from '../config/collaboration';

export class CollaborationError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type MemberRow = { project_id: string; user_id: string; role: ProjectRole; invited_by: string | null; created_at: string };

const inviteHits = new Map<string, { count: number; start: number }>();

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 320) {
    throw new CollaborationError(400, 'invalid_email', 'Enter a valid email address.');
  }
  return normalized;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function newInviteToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function rateLimitInvite(userId: string): void {
  const now = Date.now();
  const entry = inviteHits.get(userId);
  if (!entry || now - entry.start >= PROJECT_INVITE_RATE_LIMIT.windowMs) {
    inviteHits.set(userId, { count: 1, start: now });
    return;
  }
  if (entry.count >= PROJECT_INVITE_RATE_LIMIT.max) {
    throw new CollaborationError(429, 'invite_rate_limited', 'Too many invitations. Please try again later.');
  }
  entry.count += 1;
}

export async function getProjectRole(userId: string, projectId: string): Promise<ProjectRole | null> {
  const { data, error } = await supabaseAdmin
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`project membership lookup failed: ${error.message}`);
  return (data?.role as ProjectRole | undefined) ?? null;
}

export async function requireProjectRole(userId: string, projectId: string, minimum: ProjectRole): Promise<ProjectRole> {
  const role = await getProjectRole(userId, projectId);
  const ranks: Record<ProjectRole, number> = { viewer: 1, editor: 2, owner: 3 };
  if (!role || ranks[role] < ranks[minimum]) {
    throw new CollaborationError(403, 'project_forbidden', 'You do not have permission to perform this action on this project.');
  }
  return role;
}

export async function getProjectTier(userId: string): Promise<ProjectTier> {
  const { data, error } = await supabaseAdmin.from('billing_profile').select('plan').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`billing profile lookup failed: ${error.message}`);
  if (data?.plan === 'pro_plus') return 'pro_plus';
  if (data?.plan === 'pro' || data?.plan === 'paid') return 'pro';
  return 'free';
}

export async function listProjectMembers(projectId: string, requesterId: string) {
  await requireProjectRole(requesterId, projectId, 'viewer');
  const { data: members, error } = await supabaseAdmin
    .from('project_members')
    .select('project_id,user_id,role,invited_by,created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`member list failed: ${error.message}`);

  return Promise.all((members ?? []).map(async (member: MemberRow) => {
    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(member.user_id);
    const email = userData.user?.email ?? '';
    const metadata = userData.user?.user_metadata as Record<string, unknown> | undefined;
    const displayName = typeof metadata?.display_name === 'string'
      ? metadata.display_name
      : typeof metadata?.full_name === 'string'
        ? metadata.full_name
        : typeof metadata?.name === 'string'
          ? metadata.name
          : email ? maskEmail(email) : 'KingxTech user';
    return {
      userId: member.user_id,
      role: member.role,
      displayName,
      maskedEmail: email ? maskEmail(email) : 'hidden email',
      createdAt: member.created_at,
    };
  }));
}

export async function listProjectInvites(projectId: string, requesterId: string) {
  const role = await requireProjectRole(requesterId, projectId, 'editor');
  const { data, error } = await supabaseAdmin
    .from('project_invites')
    .select('id,project_id,email,role,expires_at,accepted_at,revoked_at,created_at')
    .eq('project_id', projectId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`invite list failed: ${error.message}`);
  return { role, invites: (data ?? []).map((invite) => ({ ...invite, email: maskEmail(invite.email) })) };
}

export async function createProjectInvite(userId: string, projectId: string, emailInput: string, role: 'editor' | 'viewer') {
  const memberRole = await requireProjectRole(userId, projectId, 'editor');
  if (!canInvite(memberRole)) throw new CollaborationError(403, 'invite_forbidden', 'Only project owners and editors can invite members.');
  rateLimitInvite(userId);
  const email = normalizeEmail(emailInput);

  const [{ data: members, error: membersError }, { data: pending, error: pendingError }, { data: project, error: projectError }] = await Promise.all([
    supabaseAdmin.from('project_members').select('user_id').eq('project_id', projectId),
    supabaseAdmin.from('project_invites').select('id').eq('project_id', projectId).is('accepted_at', null).is('revoked_at', null).gt('expires_at', new Date().toISOString()),
    supabaseAdmin.from('projects').select('id,name').eq('id', projectId).maybeSingle(),
  ]);
  if (membersError) throw new Error(`member cap lookup failed: ${membersError.message}`);
  if (pendingError) throw new Error(`pending invite lookup failed: ${pendingError.message}`);
  if (!project) throw new CollaborationError(404, 'project_not_found', 'Project not found.');

  const tier = await getProjectTier(userId);
  if (!canAddMember(tier, members?.length ?? 0, pending?.length ?? 0)) {
    throw new CollaborationError(409, 'member_cap_reached', `This project has reached its ${tier === 'free' ? 'Free' : 'Pro'} member limit.`);
  }

  const { data: existingMember } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const invitedUser = existingMember.users.find((u) => u.email?.toLowerCase() === email);
  if (invitedUser && (members ?? []).some((m) => m.user_id === invitedUser.id)) {
    throw new CollaborationError(409, 'already_member', 'That user is already a member of this project.');
  }

  const { data: duplicate } = await supabaseAdmin
    .from('project_invites')
    .select('id')
    .eq('project_id', projectId)
    .eq('email', email)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (duplicate) throw new CollaborationError(409, 'invite_exists', 'A pending invitation already exists for that email.');

  const token = newInviteToken();
  const { data: invite, error } = await supabaseAdmin.from('project_invites').insert({
    project_id: projectId,
    email,
    role,
    token_hash: hashToken(token),
    invited_by: userId,
    expires_at: new Date(Date.now() + PROJECT_INVITE_TTL_MS).toISOString(),
  }).select('id,project_id,role,expires_at,created_at').single();
  if (error) throw new Error(`invite create failed: ${error.message}`);

  return { invite, token, projectName: project.name, inviteUrl: `/invite/${token}` };
}

export async function revokeProjectInvite(userId: string, projectId: string, inviteId: string) {
  await requireProjectRole(userId, projectId, 'editor');
  const { error } = await supabaseAdmin.from('project_invites').update({ revoked_at: new Date().toISOString() }).eq('id', inviteId).eq('project_id', projectId).is('accepted_at', null).is('revoked_at', null);
  if (error) throw new Error(`invite revoke failed: ${error.message}`);
}

export async function acceptProjectInvite(userId: string, email: string | undefined, token: string) {
  if (!email) throw new CollaborationError(400, 'email_required', 'Your signed-in account must have an email address to accept this invitation.');
  if (!token || token.length > 200) throw new CollaborationError(400, 'invalid_invite', 'This invitation link is invalid.');
  const tokenHash = hashToken(token);
  const { data: invite, error } = await supabaseAdmin.from('project_invites').select('*').eq('token_hash', tokenHash).maybeSingle();
  if (error) throw new Error(`invite lookup failed: ${error.message}`);
  if (!invite) throw new CollaborationError(404, 'invalid_invite', 'This invitation link is invalid or has already been used.');
  if (invite.accepted_at) throw new CollaborationError(409, 'invite_used', 'This invitation has already been used.');
  if (invite.revoked_at) throw new CollaborationError(410, 'invite_revoked', 'This invitation was revoked.');
  if (new Date(invite.expires_at).getTime() <= Date.now()) throw new CollaborationError(410, 'invite_expired', 'This invitation has expired. Ask the project owner for a new invitation.');
  if (invite.email.toLowerCase() !== email.toLowerCase()) throw new CollaborationError(403, 'invite_email_mismatch', 'This invitation was sent to a different email address. Sign in with the invited account.');

  const existingRole = await getProjectRole(userId, invite.project_id);
  if (existingRole) {
    await supabaseAdmin.from('project_invites').update({ accepted_at: new Date().toISOString() }).eq('id', invite.id);
    return { projectId: invite.project_id, role: existingRole };
  }

  const { data: member, error: memberError } = await supabaseAdmin.from('project_members').insert({
    project_id: invite.project_id,
    user_id: userId,
    role: invite.role,
    invited_by: invite.invited_by,
  }).select('project_id,user_id,role').single();
  if (memberError) throw new Error(`membership create failed: ${memberError.message}`);

  const { error: consumeError } = await supabaseAdmin.from('project_invites').update({ accepted_at: new Date().toISOString() }).eq('id', invite.id).is('accepted_at', null).is('revoked_at', null);
  if (consumeError) throw new Error(`invite consume failed: ${consumeError.message}`);
  await writeProjectAudit(invite.project_id, userId, 'Project member joined', `Role: ${invite.role}`);
  return member;
}

export async function changeMemberRole(ownerId: string, projectId: string, memberId: string, role: 'editor' | 'viewer') {
  await requireProjectRole(ownerId, projectId, 'owner');
  if (memberId === ownerId) throw new CollaborationError(400, 'owner_role_locked', 'Transfer ownership before changing the current owner role.');
  const { error } = await supabaseAdmin.from('project_members').update({ role }).eq('project_id', projectId).eq('user_id', memberId).neq('role', 'owner');
  if (error) throw new Error(`member role update failed: ${error.message}`);
  await writeProjectAudit(projectId, ownerId, 'Project member role changed', `${memberId}: ${role}`);
}

export async function removeMember(requesterId: string, projectId: string, memberId: string) {
  const requesterRole = await requireProjectRole(requesterId, projectId, 'viewer');
  if (memberId === requesterId && requesterRole === 'owner') {
    throw new CollaborationError(400, 'owner_cannot_leave', 'Transfer ownership before leaving this project.');
  }
  if (requesterId !== memberId && !canManageProject(requesterRole)) {
    throw new CollaborationError(403, 'remove_forbidden', 'Only the owner can remove another member.');
  }
  const { error } = await supabaseAdmin.from('project_members').delete().eq('project_id', projectId).eq('user_id', memberId).neq('role', 'owner');
  if (error) throw new Error(`member removal failed: ${error.message}`);
  await writeProjectAudit(projectId, requesterId, 'Project member removed', memberId === requesterId ? 'Left project' : `Removed ${memberId}`);
}

export async function createTransferRequest(ownerId: string, projectId: string, targetUserId: string) {
  await requireProjectRole(ownerId, projectId, 'owner');
  if (ownerId === targetUserId) throw new CollaborationError(400, 'invalid_transfer_target', 'Choose another project member.');
  const targetRole = await getProjectRole(targetUserId, projectId);
  if (!targetRole) throw new CollaborationError(404, 'transfer_target_not_member', 'The transfer target must already be a project member.');
  const { data: pending } = await supabaseAdmin.from('project_transfer_requests').select('id').eq('project_id', projectId).eq('status', 'pending').maybeSingle();
  if (pending) throw new CollaborationError(409, 'transfer_pending', 'A transfer request is already pending.');

  const { data, error } = await supabaseAdmin.from('project_transfer_requests').insert({
    project_id: projectId,
    from_user_id: ownerId,
    to_user_id: targetUserId,
    expires_at: new Date(Date.now() + PROJECT_TRANSFER_TTL_MS).toISOString(),
  }).select('*').single();
  if (error) throw new Error(`transfer request failed: ${error.message}`);
  await writeProjectAudit(projectId, ownerId, 'Ownership transfer offered', targetUserId);
  return data;
}

export async function acceptTransfer(targetUserId: string, requestId: string) {
  const { data, error } = await supabaseAdmin.rpc('accept_project_transfer', { p_request_id: requestId, p_actor_user_id: targetUserId });
  if (error) {
    if (/pending|expired|member/i.test(error.message)) throw new CollaborationError(409, 'transfer_unavailable', error.message);
    throw new Error(`transfer acceptance failed: ${error.message}`);
  }
  await writeProjectAudit(data.project_id, targetUserId, 'Ownership transfer accepted', `Previous owner: ${data.previous_owner_id}`);
  return data;
}

export async function declineTransfer(targetUserId: string, requestId: string) {
  const { data: request } = await supabaseAdmin.from('project_transfer_requests').select('id,project_id,to_user_id,status').eq('id', requestId).maybeSingle();
  if (!request || request.to_user_id !== targetUserId || request.status !== 'pending') throw new CollaborationError(404, 'transfer_not_found', 'Transfer request not found.');
  const { error } = await supabaseAdmin.from('project_transfer_requests').update({ status: 'declined' }).eq('id', requestId).eq('status', 'pending');
  if (error) throw new Error(`transfer decline failed: ${error.message}`);
  await writeProjectAudit(request.project_id, targetUserId, 'Ownership transfer declined', requestId);
}

export async function cancelTransfer(ownerId: string, requestId: string) {
  const { data: request } = await supabaseAdmin.from('project_transfer_requests').select('id,project_id,from_user_id,status').eq('id', requestId).maybeSingle();
  if (!request || request.from_user_id !== ownerId || request.status !== 'pending') throw new CollaborationError(404, 'transfer_not_found', 'Transfer request not found.');
  await requireProjectRole(ownerId, request.project_id, 'owner');
  const { error } = await supabaseAdmin.from('project_transfer_requests').update({ status: 'cancelled' }).eq('id', requestId).eq('status', 'pending');
  if (error) throw new Error(`transfer cancel failed: ${error.message}`);
  await writeProjectAudit(request.project_id, ownerId, 'Ownership transfer cancelled', requestId);
}

export async function getPendingTransfers(userId: string) {
  const { data, error } = await supabaseAdmin.from('project_transfer_requests').select('id,project_id,from_user_id,to_user_id,status,expires_at,created_at').eq('to_user_id', userId).eq('status', 'pending').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false });
  if (error) throw new Error(`pending transfer lookup failed: ${error.message}`);
  return data ?? [];
}

async function writeProjectAudit(projectId: string, userId: string, action: string, detail: string) {
  const { error } = await supabaseAdmin.from('activity_log').insert({ project_id: projectId, user_id: userId, action, detail });
  if (error) console.error('Project collaboration audit failed:', error.message);
}
