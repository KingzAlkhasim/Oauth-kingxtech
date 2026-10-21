import { supabase } from './supabase';

export const adminListFlags = (view = 'open') => supabase.rpc('admin_list_flags', { p_view: view });

export const adminResolveFlag = (flagId, decision, note) =>
  supabase.rpc('admin_resolve_flag', { p_flag: flagId, p_decision: decision, p_note: note || null });
