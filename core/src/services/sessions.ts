import { supabaseAdmin } from '../lib/supabaseAdmin';

export interface SessionSummary {
  id: string;
  project_id: string | null;
  title: string;
  updated_at: string;
}

/**
 * Registers a session the first time it's used (title derived from the
 * first prompt), and bumps updated_at on every later message so the list
 * sorts by recency. Safe to call on every turn — it's an upsert.
 */
export async function touchSession(
  userId: string,
  sessionId: string,
  projectId: string | undefined,
  firstPrompt: string
): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from('kxpert_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabaseAdmin
      .from('kxpert_sessions')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', sessionId)
      .eq('user_id', userId);
    if (error) console.error('[touchSession] update error:', error.message);
    return;
  }

  const title = firstPrompt.replace(/^:[A-Za-z]+-[^/]+\/\s*/, '').slice(0, 60) || 'New chat';
  const { error } = await supabaseAdmin.from('kxpert_sessions').insert({
    id: sessionId,
    user_id: userId,
    project_id: projectId ?? null,
    title,
  });
  if (error) console.error('[touchSession] insert error:', error.message);
}

export async function listSessions(userId: string, projectId?: string): Promise<SessionSummary[]> {
  let query = supabaseAdmin
    .from('kxpert_sessions')
    .select('id, project_id, title, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(50);

  if (projectId) query = query.eq('project_id', projectId);

  const { data, error } = await query;
  if (error) {
    console.error('[listSessions] Supabase error:', error.message);
    return [];
  }
  return data ?? [];
}

export async function deleteSession(userId: string, sessionId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('kxpert_sessions')
    .delete()
    .eq('id', sessionId)
    .eq('user_id', userId);
  if (error) throw new Error(`deleteSession failed: ${error.message}`);
}
