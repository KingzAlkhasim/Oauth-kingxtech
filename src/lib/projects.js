import { supabase } from './supabase';

export const PRODUCTS = ['K-XpertAI', 'SynthCode IDE', 'KX Cloud', 'Other'];
export const STATUSES = ['active', 'paused', 'archived'];

export async function listProjects() {
  return supabase.from('projects').select('*').order('updated_at', { ascending: false });
}

export async function createProject(payload) {
  const { data: userData } = await supabase.auth.getUser();
  return supabase
    .from('projects')
    .insert({ ...payload, user_id: userData.user.id })
    .select()
    .single();
}

export async function updateProject(id, payload) {
  return supabase.from('projects').update(payload).eq('id', id).select().single();
}

export async function deleteProject(id) {
  return supabase.from('projects').delete().eq('id', id);
}
