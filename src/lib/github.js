import { supabase } from './supabase';
import { apiUrl } from './apiBase';

async function authHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('You must be signed in.');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
}

export async function githubStatus() {
  const headers = await authHeaders();
  const res = await fetch(apiUrl('/api/github/status'), { headers });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to check GitHub status');
  return data.connected;
}

export async function saveGithubToken(token) {
  const headers = await authHeaders();
  const res = await fetch(apiUrl('/api/github/token'), { method: 'POST', headers, body: JSON.stringify({ token }) });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to save token');
}

export async function removeGithubToken() {
  const headers = await authHeaders();
  const res = await fetch(apiUrl('/api/github/token'), { method: 'DELETE', headers });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to remove token');
}

export async function listGithubRepos() {
  const headers = await authHeaders();
  const res = await fetch(apiUrl('/api/github/repos'), { headers });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to list repos');
  return data.repos;
}

export async function linkProjectRepo(projectId, repoFullName, branch) {
  const headers = await authHeaders();
  const res = await fetch(apiUrl(`/api/projects/${projectId}/github/link`), {
    method: 'POST',
    headers,
    body: JSON.stringify({ repoFullName, branch }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to link repo');
}

export async function getProjectRepoLink(projectId) {
  const headers = await authHeaders();
  const res = await fetch(apiUrl(`/api/projects/${projectId}/github/link`), { headers });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to fetch link');
  return data.link;
}

export async function pushProjectToGithub(projectId, commitMessage) {
  const headers = await authHeaders();
  const res = await fetch(apiUrl(`/api/projects/${projectId}/github/push`), {
    method: 'POST',
    headers,
    body: JSON.stringify({ commitMessage }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Push failed');
  return data;
}

export async function importRepoFromGithub(projectId, repoFullName, branch) {
  const headers = await authHeaders();
  const res = await fetch(apiUrl(`/api/projects/${projectId}/github/import`), {
    method: 'POST',
    headers,
    body: JSON.stringify({ repoFullName, branch }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Import failed');
  return data;
}
