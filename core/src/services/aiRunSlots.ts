import { supabaseAdmin } from '../lib/supabaseAdmin';

/** Paid AI runs one user may have going at once. */
export const MAX_CONCURRENT_AI_RUNS = 2;
/** Lease length. A run that dies (timeout, crash) frees its slot after this. */
export const AI_RUN_LEASE_SECONDS = 330;

/** Returns a slot id, or null when the user already has the maximum running. */
export async function acquireAiRunSlot(
  userId: string,
  billing: { reservedUsd: number; sessionHours: number; weekDays: number; tier: string },
): Promise<string | null> {
  // A run that dies before recording its cost is billed `reservedUsd` on the user's next run.
  const { data, error } = await supabaseAdmin.rpc('ai_run_acquire2', {
    p_user: userId,
    p_max: MAX_CONCURRENT_AI_RUNS,
    p_lease_seconds: AI_RUN_LEASE_SECONDS,
    p_reserved_usd: billing.reservedUsd,
    p_session_hours: billing.sessionHours,
    p_week_days: billing.weekDays,
    p_tier: billing.tier,
  });
  if (error) throw new Error(`ai_run_acquire2 failed: ${error.message}`);
  return typeof data === 'string' ? data : null;
}

export async function releaseAiRunSlot(slotId: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc('ai_run_release', { p_id: slotId });
  if (error) console.error('[ai-run-slots] release failed; lease will expire on its own:', error.message);
}
