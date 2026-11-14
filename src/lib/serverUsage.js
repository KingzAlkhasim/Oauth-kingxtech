import { supabase } from './supabase';
import { apiUrl } from './apiBase';

async function authed(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('You must be signed in.');
  const res = await fetch(apiUrl(path), {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// The Usage page's Server card. { overview } on success, { notAllowed: true } on the Free plan, null when unavailable.
export async function getServerOverview() {
  try {
    const { status, data } = await authed('/api/project-servers/overview');
    if (status === 402) return { notAllowed: true };
    return data && data.success ? { overview: data.overview } : null;
  } catch {
    return null;
  }
}

// Admin only (checked on the server): one account's server allowance and this month's usage.
export async function adminGetServerOwner(ownerId) {
  const { status, data } = await authed(`/api/admin/project-servers/owners/${encodeURIComponent(ownerId)}`);
  if (status !== 200 || !data.success) throw new Error(data.error || 'Could not load the server allowance.');
  return data;
}

export async function adminSetServerAllowance(ownerId, multiplier) {
  const { status, data } = await authed(`/api/admin/project-servers/owners/${encodeURIComponent(ownerId)}`, {
    method: 'POST', body: JSON.stringify({ allowanceMultiplier: multiplier }),
  });
  if (status !== 200 || !data.success) throw new Error(data.error || 'Could not change the allowance.');
}
