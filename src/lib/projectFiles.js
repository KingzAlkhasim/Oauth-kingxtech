import { supabase } from './supabase';
import { apiUrl } from './apiBase';

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
  const res = await fetch(apiUrl(`/api/projects/${projectId}/files`), { headers });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to list files');
  return data.files;
}

export async function readFile(projectId, path) {
  const headers = await authHeaders(false);
  const res = await fetch(
    apiUrl(`/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`),
    { headers }
  );
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to read file');
  return data.file;
}

export async function writeFile(projectId, path, content) {
  const headers = await authHeaders(true);
  const res = await fetch(
    apiUrl(`/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`),
    { method: 'PUT', headers, body: JSON.stringify({ content }) }
  );
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to save file');
}

export async function createFolder(projectId, path) {
  const headers = await authHeaders(true);
  const res = await fetch(apiUrl(`/api/projects/${projectId}/folder`), {
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
    apiUrl(`/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`),
    { method: 'DELETE', headers }
  );
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to delete file');
}

export async function revertFile(projectId, path) {
  const headers = await authHeaders(false);
  const res = await fetch(
    apiUrl(`/api/projects/${projectId}/file/revert?path=${encodeURIComponent(path)}`),
    { method: 'POST', headers }
  );
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to undo changes to this file');
}

export function previewUrl(projectId) {
  return apiUrl(`/preview/${projectId}/`);
}

export async function publishProject(projectId) {
  const headers = await authHeaders(true);
  const res = await fetch(apiUrl(`/api/projects/${projectId}/publish`), {
    method: 'POST',
    headers,
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to publish project');
  const url = data.url.startsWith('http') ? data.url : apiUrl(data.url);
  return { slug: data.slug, url };
}

export async function runTerminalCommand(projectId, command, args = []) {
  const headers = await authHeaders(true);
  const res = await fetch(apiUrl(`/api/projects/${projectId}/terminal`), {
    method: 'POST',
    headers,
    body: JSON.stringify({ command, args }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Command failed');
  return { ok: data.ok, output: data.output };
}
