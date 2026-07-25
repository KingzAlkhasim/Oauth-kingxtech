import { supabase } from './supabase';

export const WEBHOOK_EVENTS = ['project.created', 'project.updated', 'account.updated', 'auth.signed_in'];

export async function listWebhooks() {
  return supabase.from('webhooks').select('*').order('created_at', { ascending: false });
}

export async function createWebhook({ url, events }) {
  const { data: userData } = await supabase.auth.getUser();
  return supabase.from('webhooks').insert({ user_id: userData.user.id, url, events }).select().single();
}

export async function toggleWebhook(id, active) {
  return supabase.from('webhooks').update({ active }).eq('id', id);
}

export async function deleteWebhook(id) {
  return supabase.from('webhooks').delete().eq('id', id);
}
