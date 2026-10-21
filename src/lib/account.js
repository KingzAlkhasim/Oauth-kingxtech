import { supabase } from './supabase';
import { apiUrl } from './apiBase';

// Own suspension row (RLS lets a user read only their own).
export async function getMyAccountStatus() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { suspended: false, reason: null, restoredNotice: false };
  const { data, error } = await supabase
    .from('account_status')
    .select('suspended, reason, restored_notice_pending')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) return { suspended: false, reason: null, restoredNotice: false }; // never lock someone out by mistake
  return { suspended: data?.suspended === true, reason: data?.reason || null, restoredNotice: data?.restored_notice_pending === true };
}

// Builds the big zip on the server and returns a short-lived download link.
export async function requestDataExport() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('You must be signed in.');
  const res = await fetch(apiUrl('/api/account/export'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || 'Could not prepare your export.');
  return data;
}

export const adminListAccounts = () => supabase.rpc('admin_list_accounts');

export const adminSetSuspension = (userId, suspended, reason) =>
  supabase.rpc('admin_set_suspension', { p_user: userId, p_suspended: suspended, p_reason: reason || null });

export const acknowledgeRestoration = () => supabase.rpc('acknowledge_restoration');
