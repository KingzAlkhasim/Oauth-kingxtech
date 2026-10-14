import { apiUrl } from './apiBase';
import { supabase } from './supabase';

async function apiFetch(path, options = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || 'Request failed.'), { status: response.status, code: payload.code });
  return payload;
}

export async function getProjectMembers(projectId) { return apiFetch(`/api/projects/${projectId}/members`); }
export async function inviteProjectMember(projectId, email, role) { return apiFetch(`/api/projects/${projectId}/invites`, { method: 'POST', body: JSON.stringify({ email, role }) }); }
export async function revokeProjectInvite(projectId, inviteId) { return apiFetch(`/api/projects/${projectId}/invites/${inviteId}`, { method: 'DELETE' }); }
export async function updateProjectMember(projectId, userId, role) { return apiFetch(`/api/projects/${projectId}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }); }
export async function removeProjectMember(projectId, userId) { return apiFetch(`/api/projects/${projectId}/members/${userId}`, { method: 'DELETE' }); }
export async function offerProjectTransfer(projectId, toUserId) { return apiFetch(`/api/projects/${projectId}/transfer`, { method: 'POST', body: JSON.stringify({ toUserId }) }); }
export async function acceptProjectTransfer(id) { return apiFetch(`/api/transfers/${id}/accept`, { method: 'POST' }); }
export async function declineProjectTransfer(id) { return apiFetch(`/api/transfers/${id}/decline`, { method: 'POST' }); }
export async function cancelProjectTransfer(id) { return apiFetch(`/api/transfers/${id}/cancel`, { method: 'POST' }); }
export async function getPendingTransfers() { return apiFetch('/api/transfers/pending'); }
export async function acceptProjectInvite(token) { return apiFetch('/api/invites/accept', { method: 'POST', body: JSON.stringify({ token }) }); }
