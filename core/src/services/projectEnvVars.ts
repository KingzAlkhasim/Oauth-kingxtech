import { supabaseAdmin } from '../lib/supabaseAdmin';
import { assertProjectOwnership } from './projectFs';

export interface ProjectEnvVar {
  id: string;
  key: string;
  value: string;
  is_public: boolean;
  updated_at: string;
}

export async function listProjectEnvVars(userId: string, projectId: string): Promise<ProjectEnvVar[]> {
  await assertProjectOwnership(userId, projectId);
  const { data, error } = await supabaseAdmin
    .from('project_env_vars')
    .select('id, key, value, is_public, updated_at')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .order('key', { ascending: true });

  if (error) throw new Error(`listProjectEnvVars failed: ${error.message}`);
  return data ?? [];
}

export async function upsertProjectEnvVar(
  userId: string,
  projectId: string,
  key: string,
  value: string,
  isPublic: boolean
): Promise<void> {
  await assertProjectOwnership(userId, projectId);
  const { error } = await supabaseAdmin.from('project_env_vars').upsert(
    { project_id: projectId, user_id: userId, key, value, is_public: isPublic, updated_at: new Date().toISOString() },
    { onConflict: 'project_id,key' }
  );
  if (error) throw new Error(`upsertProjectEnvVar failed: ${error.message}`);
}

export async function deleteProjectEnvVar(userId: string, projectId: string, id: string): Promise<void> {
  await assertProjectOwnership(userId, projectId);
  const { error } = await supabaseAdmin
    .from('project_env_vars')
    .delete()
    .eq('id', id)
    .eq('project_id', projectId)
    .eq('user_id', userId);
  if (error) throw new Error(`deleteProjectEnvVar failed: ${error.message}`);
}

/** Only the public ones — used by the /kx-env.js injection into published sites. */
export async function getPublicProjectEnvVars(projectId: string): Promise<Record<string, string>> {
  const { data, error } = await supabaseAdmin
    .from('project_env_vars')
    .select('key, value')
    .eq('project_id', projectId)
    .eq('is_public', true);

  if (error) {
    console.error('[getPublicProjectEnvVars] Supabase error:', error.message);
    return {};
  }
  return Object.fromEntries((data ?? []).map((row) => [row.key, row.value]));
}
