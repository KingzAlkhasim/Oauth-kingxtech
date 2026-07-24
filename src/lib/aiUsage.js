import { supabase } from './supabase';

const API_BASE = 'https://kx-neurocore-1066169621814.us-central1.run.app';

async function authHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('You must be signed in.');
  return { Authorization: `Bearer ${session.access_token}` };
}

export async function getCredits() {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/ai/credits`, { headers });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to fetch credits');
  return { remaining: data.remaining, allowance: data.allowance };
}

export async function getUsageLog(limit = 30) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/ai/usage?limit=${limit}`, { headers });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to fetch usage log');
  return data.log; // [{ id, provider, model_code, credit_cost, project_id, created_at }]
}
