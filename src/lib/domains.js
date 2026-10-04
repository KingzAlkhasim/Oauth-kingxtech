import { supabase } from './supabase';
import { apiUrl } from './apiBase';

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('You must be signed in.');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
}

async function api(path, options = {}) {
  const headers = await authHeaders();
  const res = await fetch(apiUrl(path), { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Domain request failed');
  return data;
}

export async function listDomains() {
  try {
    const data = await api('/api/domains');
    return { data: data.domains || [], error: null };
  } catch (error) {
    return { data: null, error };
  }
}

export async function listDomainProjects() {
  return supabase.from('projects').select('id, name, status, external_url').order('updated_at', { ascending: false });
}

export async function addDomain(domain, projectId) {
  try {
    const data = await api('/api/domains', { method: 'POST', body: JSON.stringify({ domain, projectId }) });
    return { data: data.domain, vercel: data.vercel, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

export async function removeDomain(id) {
  try {
    await api(`/api/domains/${id}`, { method: 'DELETE' });
    return { error: null };
  } catch (error) {
    return { error };
  }
}

export async function verifyDomain(id) {
  try {
    const data = await api(`/api/domains/${id}/verify`, { method: 'POST' });
    return { data: data.domain, vercel: data.vercel, error: null };
  } catch (error) {
    return { data: null, error };
  }
}
