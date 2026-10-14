import { supabase } from './supabase';
import { apiUrl } from './apiBase';

async function headers() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('You must be signed in.');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` };
}

async function request(path, options = {}) {
  const response = await fetch(apiUrl(path), { ...options, headers: { ...(await headers()), ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || 'Collaboration request failed.'), { status: response.status, code: body.code });
  return body;
}

export const getProjectMembers = (projectId) => request(`/api/projects/${encodeURIComponent(projectId)}/members`);
export const inviteProjectMember = (projectId, email, role) => request(`/api/projects/${encodeURIComponent(projectId)}/invites`, { method: 'POST', body: JSON.stringify({ email, role }) });
export const revokeProjectInvite = (projectId, inviteId) => request(`/api/projects/${encodeURIComponent(projectId)}/invites/${encodeURIComponent(inviteId)}`, { method: 'DELETE' });
export const changeProjectMemberRole = (projectId, userId, role) => request(`/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify({ role }) });
export const removeProjectMember = (projectId, userId) => request(`/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });
export const offerProjectTransfer = (projectId, toUserId) => request(`/api/projects/${encodeURIComponent(projectId)}/transfer`, { method: 'POST', body: JSON.stringify({ toUserId }) });
export const acceptTransfer = (transferId) => request(`/api/transfers/${encodeURIComponent(transferId)}/accept`, { method: 'POST' });
export const declineTransfer = (transferId) => request(`/api/transfers/${encodeURIComponent(transferId)}/decline`, { method: 'POST' });
export const cancelTransfer = (transferId) => request(`/api/transfers/${encodeURIComponent(transferId)}/cancel`, { method: 'POST' });
export const getPendingTransfers = () => request('/api/transfers/pending');
export const acceptProjectInvite = (token) => request('/api/invites/accept', { method: 'POST', body: JSON.stringify({ token }) });
