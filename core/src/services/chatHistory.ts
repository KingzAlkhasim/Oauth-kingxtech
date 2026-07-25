import { supabaseAdmin } from '../lib/supabaseAdmin';
import type { AgentTurn } from './agentTools';

interface KxpertMessageRow {
  role: 'user' | 'model';
  content: string;
  created_at: string;
}

// BUG FIX: getHistoryFromDb used to fetch every message ever sent in a
// session with no limit at all, and hand the entire thing to the model as
// history on EVERY turn. In a long-running conversation this grows
// unbounded — more tokens, more latency, more cost, every single message,
// forever. These two caps bound it:
const MAX_HISTORY_MESSAGES = 40; // ~20 user/model turns
const MAX_HISTORY_CHARS = 24_000; // rough token-budget guard, trims oldest first

export async function getHistoryFromDb(userId: string, sessionId: string): Promise<AgentTurn[]> {
  // Fetch the most recent MAX_HISTORY_MESSAGES (descending), then reverse
  // back to chronological order — this is the message-count cap.
  const { data, error } = await supabaseAdmin
    .from('kxpert_messages')
    .select('role, content, created_at')
    .eq('user_id', userId)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(MAX_HISTORY_MESSAGES);

  if (error) {
    console.error('[getHistoryFromDb] Supabase error:', error.message);
    return [];
  }

  const rows = (data as KxpertMessageRow[]).slice().reverse();
  const turns: AgentTurn[] = rows.map((row) => ({ role: row.role, text: row.content }));

  // Character-budget guard: even within the message cap, a handful of very
  // large messages (e.g. the AI pasting a big file back) could still blow
  // the context. Trim from the OLDEST end first until we're under budget.
  let totalChars = turns.reduce((sum, t) => sum + t.text.length, 0);
  while (totalChars > MAX_HISTORY_CHARS && turns.length > 1) {
    const removed = turns.shift()!;
    totalChars -= removed.text.length;
  }

  return turns;
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
