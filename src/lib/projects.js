import { supabase } from './supabase';

export const PRODUCTS = ['K-XpertAI', 'SynthCode IDE', 'KX Cloud', 'Other'];
export const STATUSES = ['active', 'paused', 'archived'];

export async function listProjects() {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  const [projectsResult, membershipsResult] = await Promise.all([
    supabase.from('projects').select('*').order('updated_at', { ascending: false }),
    userId ? supabase.from('project_members').select('project_id,role').eq('user_id', userId) : Promise.resolve({ data: [], error: null }),
  ]);
  if (projectsResult.error) return projectsResult;
  if (membershipsResult.error) return { data: null, error: membershipsResult.error };
  const roles = new Map((membershipsResult.data || []).map((m) => [m.project_id, m.role]));
  return { data: (projectsResult.data || []).map((project) => ({ ...project, _memberRole: roles.get(project.id) || (project.user_id === userId ? 'owner' : null) })), error: null };
}

export async function createProject(payload) {
  const { data: userData } = await supabase.auth.getUser();
  return supabase.from('projects').insert({ ...payload, user_id: userData.user.id }).select().single();
}

export async function updateProject(id, payload) { return supabase.from('projects').update(payload).eq('id', id).select().single(); }
export async function deleteProject(id) { return supabase.from('projects').delete().eq('id', id); }
