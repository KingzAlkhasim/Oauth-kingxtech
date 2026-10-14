import crypto from 'crypto';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { getUserTier } from './credits';
import { PROJECT_INVITE_EXPIRY_DAYS, PROJECT_INVITE_RATE_LIMIT, PROJECT_MEMBER_CAPS, PROJECT_TRANSFER_EXPIRY_DAYS, type ProjectRole } from '../config/projectCollaboration';
import { env } from '../config/env';

export class ProjectRoleError extends Error {
  status = 403;
  code = 'project_role_forbidden';
  constructor(message = 'You do not have permission to perform this action.') { super(message); }
}

const rank: Record<ProjectRole, number> = { viewer: 1, editor: 2, owner: 3 };
const inviteAttempts = new Map<string, number[]>();

export async function getProjectRole(userId: string, projectId: string): Promise<ProjectRole | null> {
  const { data, error } = await supabaseAdmin.from('project_members').select('role').eq('project_id', projectId).eq('user_id', userId).maybeSingle();
  if (!error && data?.role && data.role in rank) return data.role as ProjectRole;
  const { data: project, error: projectError } = await supabaseAdmin.from('projects').select('user_id').eq('id', projectId).maybeSingle();
  if (projectError) throw new Error(`Project access lookup failed: ${projectError.message}`);
  if (project?.user_id === userId) return 'owner';
  return null;
}

export async function assertProjectRole(userId: string, projectId: string, minimum: ProjectRole): Promise<ProjectRole> {
  const role = await getProjectRole(userId, projectId);
  if (!role || rank[role] < rank[minimum]) throw new ProjectRoleError(`You need ${minimum} access to this project.`);
  return role;
}

export function canWriteProject(role: ProjectRole): boolean { return rank[role] >= rank.editor; }
export function canManageProject(role: ProjectRole): boolean { return role === 'owner'; }

function inviteRateLimited(userId: string): boolean {
  const now = Date.now();
  const existing = (inviteAttempts.get(userId) ?? []).filter((time) => now - time < PROJECT_INVITE_RATE_LIMIT.windowMs);
  if (existing.length >= PROJECT_INVITE_RATE_LIMIT.max) { inviteAttempts.set(userId, existing); return true; }
  existing.push(now); inviteAttempts.set(userId, existing); return false;
}

function sha256(value: string): string { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function maskEmail(email: string): string {
  const [local, domain = ''] = email.split('@');
  if (!local || !domain) return 'hidden email';
  const visible = local.length <= 2 ? local[0] : local.slice(0, 2);
  return `${visible}${'•'.repeat(Math.max(1, Math.min(5, local.length - visible.length)))}@${domain}`;
}
function appOrigin(): string { return env.ALLOWED_ORIGINS[0] || 'https://auth.kingxtech.name.ng'; }

async function audit(userId: string, projectId: string, action: string, detail: Record<string, unknown> = {}) {
  await supabaseAdmin.from('activity_log').insert({ user_id: userId, project_id: projectId, action, detail: JSON.stringify(detail) });
}

async function memberCap(projectId: string): Promise<number> {
  const owner = await supabaseAdmin.from('projects').select('user_id').eq('id', projectId).single();
  if (owner.error) throw new Error(`Project lookup failed: ${owner.error.message}`);
  const tier = await getUserTier(owner.data.user_id);
  return PROJECT_MEMBER_CAPS[tier];
}

export async function listProjectMembers(userId: string, projectId: string) {
  await assertProjectRole(userId, projectId, 'viewer');
  const { data: members, error } = await supabaseAdmin.from('project_members').select('user_id,role,created_at').eq('project_id', projectId).order('created_at');
  if (error) throw new Error(`Member list failed: ${error.message}`);
  const rows = await Promise.all((members ?? []).map(async (member) => {
    const { data: profile } = await supabaseAdmin.from('profiles').select('full_name,username').eq('id', member.user_id).maybeSingle();
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(member.user_id);
    const email = authUser.user?.email;
    return { userId: member.user_id, role: member.role, createdAt: member.created_at, displayName: profile?.full_name || profile?.username || 'KingxTech member', maskedEmail: email ? maskEmail(email) : null };
  }));
  return rows;
}

export async function listPendingInvites(userId: string, projectId: string) {
  await assertProjectRole(userId, projectId, 'editor');
  const { data, error } = await supabaseAdmin.from('project_invites').select('id,email,role,expires_at,created_at').eq('project_id', projectId).is('accepted_at', null).is('revoked_at', null).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false });
  if (error) throw new Error(`Invite list failed: ${error.message}`);
  return (data ?? []).map((invite) => ({ id: invite.id, email: maskEmail(invite.email), role: invite.role, expiresAt: invite.expires_at, createdAt: invite.created_at }));
}

export async function createProjectInvite(userId: string, projectId: string, email: string, role: 'editor' | 'viewer') {
  await assertProjectRole(userId, projectId, 'editor');
  if (inviteRateLimited(userId)) throw Object.assign(new Error('Too many invitations. Please wait before sending another.'), { status: 429, code: 'invite_rate_limited' });
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw Object.assign(new Error('Enter a valid email address.'), { status: 400, code: 'invalid_email' });
  if (!['editor','viewer'].includes(role)) throw Object.assign(new Error('Invalid project role.'), { status: 400, code: 'invalid_role' });

  const { data: owner, error: ownerError } = await supabaseAdmin.from('projects').select('user_id,name').eq('id', projectId).single();
  if (ownerError) throw new Error(`Project lookup failed: ${ownerError.message}`);
  const cap = await memberCap(projectId);
  const [{ count: memberCount }, { count: pendingCount }] = await Promise.all([
    supabaseAdmin.from('project_members').select('user_id', { count: 'exact', head: true }).eq('project_id', projectId).neq('role', 'owner'),
    supabaseAdmin.from('project_invites').select('id', { count: 'exact', head: true }).eq('project_id', projectId).is('accepted_at', null).is('revoked_at', null).gt('expires_at', new Date().toISOString()),
  ]);
  if ((memberCount ?? 0) + (pendingCount ?? 0) >= cap) throw Object.assign(new Error(`This project has reached its ${cap}-member invitation limit. Upgrade the project owner plan for more members.`), { status: 409, code: 'member_cap_reached', cap });

  const { data: existingMember } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const target = existingMember.users.find((u) => u.email?.toLowerCase() === normalizedEmail);
  if (target) {
    const { data: member } = await supabaseAdmin.from('project_members').select('user_id').eq('project_id', projectId).eq('user_id', target.id).maybeSingle();
    if (member) throw Object.assign(new Error('That user is already a project member.'), { status: 409, code: 'already_member' });
  }
  const { data: duplicate } = await supabaseAdmin.from('project_invites').select('id').eq('project_id', projectId).ilike('email', normalizedEmail).is('accepted_at', null).is('revoked_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (duplicate) throw Object.assign(new Error('There is already a pending invitation for that email.'), { status: 409, code: 'duplicate_pending_invite' });

  const rawToken = crypto.randomBytes(32).toString('base64url');
  const { data: invite, error } = await supabaseAdmin.from('project_invites').insert({
    project_id: projectId, email: normalizedEmail, role, token_hash: sha256(rawToken), invited_by: userId,
    expires_at: new Date(Date.now() + PROJECT_INVITE_EXPIRY_DAYS * 86400000).toISOString(),
  }).select('id,expires_at').single();
  if (error) throw new Error(`Invite creation failed: ${error.message}`);
  await audit(userId, projectId, 'Project member invited', { invite_id: invite.id, role });
  return { id: invite.id, projectName: owner.name, expiresAt: invite.expires_at, inviteLink: `${appOrigin()}/invite/${encodeURIComponent(rawToken)}`, emailDelivery: 'copy_link' as const };
}

export async function revokeProjectInvite(userId: string, projectId: string, inviteId: string) {
  await assertProjectRole(userId, projectId, 'editor');
  const { error } = await supabaseAdmin.from('project_invites').update({ revoked_at: new Date().toISOString() }).eq('id', inviteId).eq('project_id', projectId).is('accepted_at', null).is('revoked_at', null);
  if (error) throw new Error(`Invite revoke failed: ${error.message}`);
  await audit(userId, projectId, 'Project invitation revoked', { invite_id: inviteId });
}

export async function acceptProjectInvite(userId: string, email: string, token: string) {
  const tokenHash = sha256(token.trim());
  const { data, error } = await supabaseAdmin.rpc('accept_project_invite', { p_token_hash: tokenHash, p_user_id: userId, p_email: email });
  if (error) throw Object.assign(new Error(error.message.replace(/^.*?: /, '')), { status: 403, code: 'invite_invalid' });
  const projectId = data.project_id as string;
  await audit(userId, projectId, 'Project member joined', { role: data.role });
  return data;
}

export async function changeProjectMemberRole(ownerId: string, projectId: string, memberId: string, role: 'editor' | 'viewer') {
  await assertProjectRole(ownerId, projectId, 'owner');
  if (memberId === ownerId) throw Object.assign(new Error('The owner role cannot be changed here.'), { status: 400, code: 'owner_role_locked' });
  const { error } = await supabaseAdmin.from('project_members').update({ role }).eq('project_id', projectId).eq('user_id', memberId);
  if (error) throw new Error(`Role change failed: ${error.message}`);
  await audit(ownerId, projectId, 'Project member role changed', { member_id: memberId, role });
}

export async function removeProjectMember(actorId: string, projectId: string, memberId: string) {
  const actorRole = await assertProjectRole(actorId, projectId, 'viewer');
  if (memberId !== actorId && actorRole !== 'owner') throw new ProjectRoleError('Only the owner can remove another member.');
  const targetRole = await getProjectRole(memberId, projectId);
  if (targetRole === 'owner') throw Object.assign(new Error('The project owner cannot be removed.'), { status: 400, code: 'owner_cannot_remove' });
  const { error } = await supabaseAdmin.from('project_members').delete().eq('project_id', projectId).eq('user_id', memberId);
  if (error) throw new Error(`Member removal failed: ${error.message}`);
  await audit(actorId, projectId, memberId === actorId ? 'Project member left' : 'Project member removed', { member_id: memberId });
}

export async function createTransferRequest(ownerId: string, projectId: string, toUserId: string) {
  await assertProjectRole(ownerId, projectId, 'owner');
  if (toUserId === ownerId || (await getProjectRole(toUserId, projectId)) === null) throw Object.assign(new Error('Ownership can only be offered to an existing project member.'), { status: 400, code: 'invalid_transfer_target' });
  const { data: existing } = await supabaseAdmin.from('project_transfer_requests').select('id').eq('project_id', projectId).eq('status', 'pending').maybeSingle();
  if (existing) throw Object.assign(new Error('A transfer is already pending.'), { status: 409, code: 'transfer_pending' });
  const { data, error } = await supabaseAdmin.from('project_transfer_requests').insert({ project_id: projectId, from_user_id: ownerId, to_user_id: toUserId, expires_at: new Date(Date.now() + PROJECT_TRANSFER_EXPIRY_DAYS * 86400000).toISOString() }).select('id,expires_at').single();
  if (error) throw new Error(`Transfer request failed: ${error.message}`);
  await audit(ownerId, projectId, 'Project ownership transfer offered', { transfer_id: data.id, to_user_id: toUserId });
  return data;
}

export async function listPendingTransfers(userId: string) {
  const { data, error } = await supabaseAdmin.from('project_transfer_requests').select('id,project_id,from_user_id,to_user_id,status,created_at,expires_at,projects(name)').eq('to_user_id', userId).eq('status', 'pending').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false });
  if (error) throw new Error(`Transfer list failed: ${error.message}`);
  return data ?? [];
}

export async function acceptTransfer(userId: string, transferId: string) {
  const { data, error } = await supabaseAdmin.rpc('accept_project_transfer', { p_request_id: transferId, p_actor_user_id: userId });
  if (error) throw Object.assign(new Error(error.message.replace(/^.*?: /, '')), { status: 403, code: 'transfer_invalid' });
  await audit(userId, data.project_id, 'Project ownership transfer accepted', { transfer_id: transferId });
  return data;
}

export async function declineTransfer(userId: string, transferId: string) {
  const { data: request, error: lookupError } = await supabaseAdmin.from('project_transfer_requests').select('id,project_id,to_user_id,status').eq('id', transferId).single();
  if (lookupError || !request || request.to_user_id !== userId || request.status !== 'pending') throw new ProjectRoleError('Transfer request is not available to this account.');
  const { error } = await supabaseAdmin.from('project_transfer_requests').update({ status: 'declined' }).eq('id', transferId);
  if (error) throw new Error(`Transfer decline failed: ${error.message}`);
  await audit(userId, request.project_id, 'Project ownership transfer declined', { transfer_id: transferId });
}

export async function cancelTransfer(ownerId: string, transferId: string) {
  const { data: request, error: lookupError } = await supabaseAdmin.from('project_transfer_requests').select('id,project_id,from_user_id,status').eq('id', transferId).single();
  if (lookupError || !request || request.from_user_id !== ownerId || request.status !== 'pending') throw new ProjectRoleError('Transfer request is not available to this account.');
  await assertProjectRole(ownerId, request.project_id, 'owner');
  const { error } = await supabaseAdmin.from('project_transfer_requests').update({ status: 'cancelled' }).eq('id', transferId);
  if (error) throw new Error(`Transfer cancel failed: ${error.message}`);
  await audit(ownerId, request.project_id, 'Project ownership transfer cancelled', { transfer_id: transferId });
}
