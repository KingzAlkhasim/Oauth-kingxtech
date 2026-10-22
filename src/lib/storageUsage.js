import { supabase } from './supabase';
import { apiUrl } from './apiBase';

export const getStorageUsage = () => supabase.rpc('my_storage_usage');

// Same numbers the K-XpertAI drawer shows. Advisory: returns null when unavailable.
export async function getAiUsageMeter() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const res = await fetch(apiUrl('/api/ai/usage'), { headers: { Authorization: `Bearer ${session.access_token}` } });
    const data = await res.json();
    return data && data.tier ? data : null;
  } catch {
    return null;
  }
}
