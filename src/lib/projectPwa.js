import { apiUrl } from './apiBase';
import { supabase } from './supabase';

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('You must be signed in.');
  return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token };
}

export async function getProjectPwa(projectId) {
  const res = await fetch(apiUrl('/api/projects/' + projectId + '/pwa'), { headers: await authHeaders() });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to load PWA settings');
  return data.pwa;
}

export async function setProjectPwa(projectId, enabled) {
  const res = await fetch(apiUrl('/api/projects/' + projectId + '/pwa'), {
    method: 'PUT', headers: await authHeaders(), body: JSON.stringify({ enabled }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to update PWA settings');
  return data;
}
export async function uploadProjectPwaIcon(projectId, file) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('You must be signed in.');
  const res = await fetch(apiUrl('/api/projects/' + projectId + '/pwa/icon'), {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + session.access_token,
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to upload PWA icon');
  return data;
}

export async function removeProjectPwaIcon(projectId) {
  const res = await fetch(apiUrl('/api/projects/' + projectId + '/pwa/icon'), {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to remove PWA icon');
  return data;
}
