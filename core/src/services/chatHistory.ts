import { supabaseAdmin } from '../lib/supabaseAdmin';
import type { AgentTurn } from './agentTools';

interface KxpertMessageRow {
  role: 'user' | 'model';
  content: string;
  created_at: string;
}

export async function getHistoryFromDb(userId: string, sessionId: string): Promise<AgentTurn[]> {
  const { data, error } = await supabaseAdmin
    .from('kxpert_messages')
    .select('role, content, created_at')
    .eq('user_id', userId)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[getHistoryFromDb] Supabase error:', error.message);
    return [];
  }
  return (data as KxpertMessageRow[]).map((row) => ({ role: row.role, text: row.content }));
}

export async function saveMessageToDb(
  userId: string,
  sessionId: string,
  message: { role: 'user' | 'model'; text: string }
): Promise<void> {
  const { error } = await supabaseAdmin.from('kxpert_messages').insert({
    user_id: userId,
    session_id: sessionId,
    role: message.role,
    content: message.text,
  });
  if (error) console.error('[saveMessageToDb] Supabase error:', error.message);
}

export async function deleteSessionHistory(userId: string, sessionId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('kxpert_messages')
    .delete()
    .eq('user_id', userId)
    .eq('session_id', sessionId);

  if (error) {
    console.error('[deleteSessionHistory] Supabase error:', error.message);
    throw new Error('Failed to clear session history.');
  }
}
