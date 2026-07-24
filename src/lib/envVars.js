import { supabase } from './supabase';

export async function listEnvVars() {
  return supabase.from('env_vars').select('*').order('key');
}

export async function upsertEnvVar(key, value, isPublic = false) {
  const { data: userData } = await supabase.auth.getUser();
  return supabase
    .from('env_vars')
    .upsert({ user_id: userData.user.id, key, value, is_public: isPublic }, { onConflict: 'user_id,key' })
    .select()
    .single();
}

export async function deleteEnvVar(id) {
  return supabase.from('env_vars').delete().eq('id', id);
}
