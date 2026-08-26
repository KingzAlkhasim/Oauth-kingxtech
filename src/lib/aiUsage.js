import { supabase } from './supabase';
import { apiUrl } from './apiBase';

async function authHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('You must be signed in.');
  return { Authorization: `Bearer ${session.access_token}` };
}

export async function getCredits() {
  const headers = await authHeaders();
  const res = await fetch(apiUrl('/api/ai/credits'), { headers });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to fetch credits');
  return { remaining: data.remaining, allowance: data.allowance, purchased: data.purchased };
}

export async function getUsageLog(limit = 30) {
  const headers = await authHeaders();
  const res = await fetch(apiUrl(`/api/ai/usage?limit=${limit}`), { headers });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to fetch usage log');
  return data.log;
}
