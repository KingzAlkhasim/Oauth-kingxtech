import { supabase } from './supabase';

export async function listUsage(limit = 50) {
  return supabase.from('usage_log').select('*').order('created_at', { ascending: false }).limit(limit);
}

export async function totalUsage() {
  const { data, error } = await supabase.from('usage_log').select('cost');
  if (error) return { total: 0, count: 0, error };
  return { total: data.reduce((sum, r) => sum + Number(r.cost), 0), count: data.length, error: null };
}
