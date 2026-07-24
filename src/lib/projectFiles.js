import { supabase } from './supabase';

const API_BASE = 'https://kx-neurocore-1066169621814.us-central1.run.app';

async function authHeaders(json = true) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('You must be signed in.');
  return json
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }
    : { Authorization: `Bearer ${session.access_token}` };
}

export async function listFiles(projectId) {
  const headers = await authHeaders(false);
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/files`, { headers });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to list files');
  return data.files; // [{ path, is_folder, updated_at }]
}

export async function readFile(projectId, path) {
  const headers = await authHeaders(false);
  const res = await fetch(
    `${API_BASE}/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`,
    { headers }
  );
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to read file');
  return data.file; // { path, is_folder, content, updated_at }
}

export async function writeFile(projectId, path, content) {
  const headers = await authHeaders(true);
  const res = await fetch(
    `${API_BASE}/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`,
    { method: 'PUT', headers, body: JSON.stringify({ content }) }
  );
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to save file');
}

export async function createFolder(projectId, path) {
  const headers = await authHeaders(true);
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/folder`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to create folder');
}

export async function deleteFile(projectId, path) {
  const headers = await authHeaders(false);
  const res = await fetch(
    `${API_BASE}/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`,
    { method: 'DELETE', headers }
  );
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to delete file');
}

export async function revertFile(projectId, path) {
  const headers = await authHeaders(false);
  const res = await fetch(
    `${API_BASE}/api/projects/${projectId}/file/revert?path=${encodeURIComponent(path)}`,
    { method: 'POST', headers }
  );
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to undo changes to this file');
}

export function previewUrl(projectId) {
  return `${API_BASE}/preview/${projectId}/`;
}

export async function publishProject(projectId) {
  const headers = await authHeaders(true);
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/publish`, {
    method: 'POST',
    headers,
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to publish project');
  const url = data.url.startsWith('http') ? data.url : `${API_BASE}${data.url}`;
  return { slug: data.slug, url };
}

export async function runTerminalCommand(projectId, command, args = []) {
  const headers = await authHeaders(true);
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/terminal`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ command, args }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Command failed');
  return { ok: data.ok, output: data.output };
}
