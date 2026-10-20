import { supabaseAdmin } from '../lib/supabaseAdmin';

const CACHE_MS = 30_000;
const cache = new Map<string, { suspended: boolean; reason: string | null; at: number }>();

import { isAllowedWhenSuspended } from './suspensionPaths';
export { isAllowedWhenSuspended };

export async function getAccountSuspension(userId: string): Promise<{ suspended: boolean; reason: string | null }> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return { suspended: hit.suspended, reason: hit.reason };

  const { data, error } = await supabaseAdmin
    .from('account_status')
    .select('suspended, reason')
    .eq('user_id', userId)
    .maybeSingle();

  // Before migration 035 exists the table is missing: treat everyone as active, never lock people out by mistake.
  if (error) return { suspended: false, reason: null };

  const value = { suspended: data?.suspended === true, reason: data?.reason ?? null };
  cache.set(userId, { ...value, at: Date.now() });
  return value;
}

export function forgetSuspensionCache(userId?: string) {
  if (userId) cache.delete(userId); else cache.clear();
}

const ownerCache = new Map<string, { owner: string | null; at: number }>();

// Published sites of suspended accounts go offline.
export async function isProjectOwnerSuspended(projectId: string): Promise<boolean> {
  let entry = ownerCache.get(projectId);
  if (!entry || Date.now() - entry.at > CACHE_MS) {
    const { data } = await supabaseAdmin.from('projects').select('user_id').eq('id', projectId).maybeSingle();
    entry = { owner: data?.user_id ?? null, at: Date.now() };
    ownerCache.set(projectId, entry);
  }
  if (!entry.owner) return false;
  return (await getAccountSuspension(entry.owner)).suspended;
}
