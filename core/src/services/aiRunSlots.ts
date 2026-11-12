import { supabaseAdmin } from '../lib/supabaseAdmin';

/** Paid AI runs one user may have going at once. */
export const MAX_CONCURRENT_AI_RUNS = 2;
/** Lease length. A run that dies (timeout, crash) frees its slot after this. */
export const AI_RUN_LEASE_SECONDS = 300;

/** Returns a slot id, or null when the user already has the maximum running. */
export async function acquireAiRunSlot(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc('ai_run_acquire', {
    p_user: userId,
    p_max: MAX_CONCURRENT_AI_RUNS,
    p_lease_seconds: AI_RUN_LEASE_SECONDS,
  });
  if (error) throw new Error(`ai_run_acquire failed: ${error.message}`);
  return typeof data === 'string' ? data : null;
}

export async function releaseAiRunSlot(slotId: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc('ai_run_release', { p_id: slotId });
  if (error) console.error('[ai-run-slots] release failed; lease will expire on its own:', error.message);
}
