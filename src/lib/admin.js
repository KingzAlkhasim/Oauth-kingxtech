import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Admin rights are decided by the database (RLS + is_admin()). This only tells the UI
// whether to show admin screens; every admin query is checked again on the server side.
export default function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(null); // null = still checking
  useEffect(() => {
    let alive = true;
    supabase.rpc('is_admin').then(({ data, error }) => {
      if (alive) setIsAdmin(!error && data === true);
    });
    return () => { alive = false; };
  }, []);
  return isAdmin;
}

export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

export const adminListTickets = () => supabase.rpc('admin_list_tickets');

export const adminListReplies = (ticketId) =>
  supabase.from('support_replies').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true });

export async function adminReply(ticketId, body) {
  const { data: userData } = await supabase.auth.getUser();
  return supabase.from('support_replies').insert({
    ticket_id: ticketId, author_id: userData.user.id, is_admin: true, body,
  }).select().single();
}

export const adminSetStatus = (ticketId, status) =>
  supabase.from('support_tickets').update({ status }).eq('id', ticketId).select().single();

export const adminAuditLog = () =>
  supabase.from('admin_audit_log').select('*').order('created_at', { ascending: false }).limit(100);
