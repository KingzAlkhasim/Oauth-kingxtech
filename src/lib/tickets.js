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
