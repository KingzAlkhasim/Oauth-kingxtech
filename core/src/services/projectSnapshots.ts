import { supabaseAdmin } from '../lib/supabaseAdmin';
import { assertProjectRole } from './projectCollaboration';
import { getProjectOwnerId } from './projectFs';
import { getUserTier } from './credits';
import { storageFullMessage, storageLimitFor } from './storageQuota';
import { StorageFullError, forgetStorageUsage } from './storageUsage';
import { cleanSnapshotLabel, snapshotsToKeep } from './snapshotPolicy';

export class SnapshotError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export interface SnapshotSummary {
  id: string;
  label: string;
  file_count: number;
  bytes: number;
  created_at: string;
}

async function ownerPlan(projectId: string) {
  const ownerId = await getProjectOwnerId(projectId);
  if (!ownerId) throw new SnapshotError('Project not found.', 404);
  const tier = await getUserTier(ownerId);
  return { ownerId, tier, keep: snapshotsToKeep(tier) };
}

export async function listSnapshots(userId: string, projectId: string): Promise<{ snapshots: SnapshotSummary[]; keep: number }> {
  await assertProjectRole(userId, projectId, 'viewer');
  const { keep } = await ownerPlan(projectId);
  const { data, error } = await supabaseAdmin
    .from('project_snapshots')
    .select('id, label, file_count, bytes, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`listSnapshots failed: ${error.message}`);
  return { snapshots: (data ?? []).map((row) => ({ ...row, bytes: Number(row.bytes) })) as SnapshotSummary[], keep };
}

/** Saves the current files as a restore point. `created` is false when nothing changed since the latest one. */
export async function saveSnapshot(userId: string, projectId: string, label?: string): Promise<{ created: boolean; id: string | null }> {
  await assertProjectRole(userId, projectId, 'editor');
  const { keep } = await ownerPlan(projectId);
  const { data, error } = await supabaseAdmin.rpc('create_project_snapshot', {
    p_project: projectId, p_label: cleanSnapshotLabel(label, 'Manual'), p_keep: keep,
  });
  if (error) throw new Error(`saveSnapshot failed: ${error.message}`);
  return { created: !!data, id: (data as string | null) ?? null };
}

/** Called after a successful publish. Never throws: a failed snapshot must not fail the publish. */
export async function snapshotAfterPublish(projectId: string): Promise<void> {
  try {
    const { keep } = await ownerPlan(projectId);
    const { error } = await supabaseAdmin.rpc('create_project_snapshot', { p_project: projectId, p_label: 'Published', p_keep: keep });
    if (error) console.error('[snapshot] could not save after publish:', error.message);
  } catch (error) {
    console.error('[snapshot] could not save after publish:', error instanceof Error ? error.message : error);
  }
}

export async function restoreSnapshot(userId: string, projectId: string, snapshotId: string): Promise<{ restoredFiles: number }> {
  await assertProjectRole(userId, projectId, 'editor');
  const { ownerId, tier, keep } = await ownerPlan(projectId);
  const limit = storageLimitFor(tier);
  const { data, error } = await supabaseAdmin.rpc('restore_project_snapshot', {
    p_project: projectId, p_snapshot: snapshotId, p_keep: keep, p_limit_bytes: limit,
  });
  forgetStorageUsage(ownerId);
  if (error) {
    if (/STORAGE_FULL/.test(error.message)) throw new StorageFullError(storageFullMessage(tier, limit));
    if (/Snapshot not found/i.test(error.message)) throw new SnapshotError('That restore point no longer exists.', 404);
    throw new Error(`restoreSnapshot failed: ${error.message}`);
  }
  return { restoredFiles: Number(data ?? 0) };
}

export async function deleteSnapshot(userId: string, projectId: string, snapshotId: string): Promise<void> {
  await assertProjectRole(userId, projectId, 'editor');
  const { error } = await supabaseAdmin.from('project_snapshots').delete().eq('id', snapshotId).eq('project_id', projectId);
  if (error) throw new Error(`deleteSnapshot failed: ${error.message}`);
}
