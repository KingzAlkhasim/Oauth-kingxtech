import { supabaseAdmin } from '../lib/supabaseAdmin';
import { getUserTier } from './credits';
import { canWrite, isCountedPath, storageFullMessage, storageLimitFor, type StorageTier } from './storageQuota';

export class StorageFullError extends Error {}

// Short-lived per-instance memo so a 100-file import does not run 100 totals. Adjusted after each write.
const memo = new Map<string, { used: number; at: number }>();
const MEMO_MS = 5000;

async function fetchUsedBytes(ownerId: string): Promise<number | null> {
  const cached = memo.get(ownerId);
  if (cached && Date.now() - cached.at < MEMO_MS) return cached.used;
  const { data, error } = await supabaseAdmin.rpc('user_source_bytes', { p_user: ownerId });
  if (error) {
    // Migration 041 not applied yet (or a database hiccup): never block people from saving.
    console.error('[storage] usage lookup failed, not enforcing:', error.message);
    return null;
  }
  const used = Number(data ?? 0);
  memo.set(ownerId, { used, at: Date.now() });
  return used;
}

/** Drop the short-lived usage memo after a bulk change (restore, delete) so the next check is fresh. */
export function forgetStorageUsage(ownerId: string): void {
  memo.delete(ownerId);
}

export async function getUserStorage(userId: string): Promise<{ tier: StorageTier; limitBytes: number; usedBytes: number | null }> {
  memo.delete(userId);
  const tier = await getUserTier(userId);
  return { tier, limitBytes: storageLimitFor(tier), usedBytes: await fetchUsedBytes(userId) };
}

/** Throws StorageFullError when a write would push the project owner over their plan limit. */
export async function assertStorageAvailable(ownerId: string, projectId: string, path: string, content: string): Promise<void> {
  if (!isCountedPath(path)) return;
  const newBytes = Buffer.byteLength(content, 'utf8');
  const [tier, usedBytes, existing] = await Promise.all([
    getUserTier(ownerId),
    fetchUsedBytes(ownerId),
    supabaseAdmin.from('project_files').select('content').eq('project_id', projectId).eq('path', path).eq('is_folder', false).maybeSingle(),
  ]);
  if (usedBytes === null) return;
  const existingBytes = typeof existing.data?.content === 'string' ? Buffer.byteLength(existing.data.content, 'utf8') : 0;
  const limit = storageLimitFor(tier);
  if (!canWrite({ limit, usedBytes, existingBytes, newBytes })) throw new StorageFullError(storageFullMessage(tier, limit));
  memo.set(ownerId, { used: usedBytes - existingBytes + newBytes, at: Date.now() });
}
