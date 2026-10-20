import { supabase } from './supabase';

export const TICKET_CATEGORIES = ['Auth', 'Billing', 'Bug', 'Feature'];

export async function listTickets() {
  return supabase.from('support_tickets').select('*').order('created_at', { ascending: false });
}

export async function createTicket({ category, subject, message }) {
  const { data: userData } = await supabase.auth.getUser();
  return supabase
    .from('support_tickets')
    .insert({ user_id: userData.user.id, category, subject, message })
    .select()
    .single();
}

export async function listReplies(ticketId) {
  return supabase.from('support_replies').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true });
}

export async function addFollowUp(ticketId, body) {
  const { data: userData } = await supabase.auth.getUser();
  return supabase
    .from('support_replies')
    .insert({ ticket_id: ticketId, author_id: userData.user.id, is_admin: false, body })
    .select()
    .single();
}
