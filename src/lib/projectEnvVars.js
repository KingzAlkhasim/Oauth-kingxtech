import { supabase } from './supabase';

const API_BASE = 'https://kx-neurocore-1066169621814.us-central1.run.app';

async function authHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('You must be signed in.');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
}

export async function listProjectEnvVars(projectId) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/env`, { headers });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to load site settings');
  return data.vars; // [{ id, key, value, is_public, updated_at }]
}

export async function setProjectEnvVar(projectId, key, value, isPublic = false) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/env`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ key, value, isPublic }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to save variable');
}

export async function deleteProjectEnvVar(projectId, id) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/env/${id}`, {
    method: 'DELETE',
    headers,
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to delete variable');
}
