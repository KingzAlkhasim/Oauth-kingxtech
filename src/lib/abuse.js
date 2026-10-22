import { supabase } from './supabase';
import { apiUrl } from './apiBase';

export const adminListFlags = (view = 'open') => supabase.rpc('admin_list_flags', { p_view: view });

export const adminResolveFlag = (flagId, decision, note) =>
  supabase.rpc('admin_resolve_flag', { p_flag: flagId, p_decision: decision, p_note: note || null });

// Emails the flagged user a warning (admin only, checked on the server and audit-logged).
export async function warnFlagByEmail(flagId, note) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('You must be signed in.');
  const res = await fetch(apiUrl(`/api/admin/flags/${encodeURIComponent(flagId)}/warn`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ note: note || undefined }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || 'Could not send the warning.');
}
