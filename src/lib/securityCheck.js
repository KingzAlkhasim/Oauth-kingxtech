import { supabase } from './supabase';
import { apiUrl } from './apiBase';

async function authHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('You must be signed in.');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
}

export async function runSecurityCheck(projectId) {
  const headers = await authHeaders();
  const res = await fetch(apiUrl(`/api/projects/${projectId}/security-check`), {
    method: 'POST',
    headers,
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error || 'SecureCheck failed to run');
    err.requiresPro = !!data.requiresPro;
    err.requiresCredits = !!data.requiresCredits;
    throw err;
  }
  return data;
}
