import { supabase } from './supabase';

export async function listActivity(limit = 100) {
  return supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(limit);
}

/**
 * Records a real event. Fails silently (logged to console only) so a
 * logging hiccup never blocks the actual action the user asked for.
 */
export async function logActivity(action, detail = null) {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return;
  const { error } = await supabase.from('activity_log').insert({ user_id: userData.user.id, action, detail });
  if (error) console.warn('Activity log write failed:', error.message);
}
