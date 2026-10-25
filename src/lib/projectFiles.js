import { supabase } from './supabase';
import { apiUrl, siteUrl } from './apiBase';

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
  return siteUrl(`/preview/${projectId}/`);
}

export class PublishError extends Error {
  constructor(message, { status = 0, network = false } = {}) {
    super(message);
    this.name = 'PublishError';
    this.status = status;
    this.network = network;
  }
}

export async function publishProject(projectId) {
  const headers = await authHeaders(true);
  let res;
  try {
    res = await fetch(apiUrl(`/api/projects/${projectId}/publish`), { method: 'POST', headers });
  } catch (err) {
    throw new PublishError(err?.message || 'Failed to fetch', { network: true });
  }
  // A gateway timeout returns an HTML page, not JSON, so never assume the body parses.
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.success) {
    throw new PublishError(data?.error || `Publish failed (${res.status})`, { status: res.status });
  }
  // Always use KingxTech's canonical public-site origin for the UI.
  // This prevents an old backend/Vercel hostname from leaking into Publish/Copy link.
  const url = data.slug ? siteUrl(`/${data.slug}/`) : (data.url.startsWith('http') ? data.url : apiUrl(data.url));
  return { slug: data.slug, url };
}

export async function startProjectRuntime(projectId) {
  const headers = await authHeaders(true);
  const res = await fetch(apiUrl(`/api/projects/${projectId}/runtime/start`), {
    method: 'POST',
    headers,
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to start project runtime');
  return data.runtime;
}

export async function syncProjectRuntime(projectId) {
  const headers = await authHeaders(true);
  const res = await fetch(apiUrl(`/api/projects/${projectId}/runtime/sync`), {
    method: 'POST',
    headers,
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to sync project runtime');
  return data;
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

// Page views for a published site: { total, today, last7, last30, daily: [{ day, views }] }.
export async function getSiteViews(projectId) {
  const headers = await authHeaders(false);
  let res;
  try {
    res = await fetch(apiUrl(`/api/projects/${projectId}/views`), { headers });
  } catch (err) {
    throw new Error(err?.message || 'Failed to fetch');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(data?.error || 'Could not load visits.');
  return data;
}

// Restore points (whole-project snapshots).
async function snapshotCall(projectId, path, method = 'GET', body) {
  const headers = await authHeaders(method !== 'GET' && method !== 'DELETE');
  let res;
  try {
    res = await fetch(apiUrl(`/api/projects/${projectId}/snapshots${path}`), { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (err) {
    throw new Error(err?.message || 'Failed to fetch');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(data?.error || 'Something went wrong with restore points.');
  return data;
}
export const listSnapshots = (projectId) => snapshotCall(projectId, '');
export const saveSnapshot = (projectId, label) => snapshotCall(projectId, '', 'POST', { label });
export const restoreSnapshot = (projectId, snapshotId) => snapshotCall(projectId, `/${encodeURIComponent(snapshotId)}/restore`, 'POST');
export const deleteSnapshot = (projectId, snapshotId) => snapshotCall(projectId, `/${encodeURIComponent(snapshotId)}`, 'DELETE');

// AI for your site (public chatbot endpoint settings).
async function siteAiCall(projectId, method = 'GET', body) {
  const headers = await authHeaders(method !== 'GET');
  let res;
  try {
    res = await fetch(apiUrl(`/api/projects/${projectId}/ai`), { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (err) {
    throw new Error(err?.message || 'Failed to fetch');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(data?.error || 'Something went wrong with AI for your site.');
  return data;
}
export const getSiteAi = (projectId) => siteAiCall(projectId);
export const saveSiteAi = (projectId, settings) => siteAiCall(projectId, 'PUT', settings);
