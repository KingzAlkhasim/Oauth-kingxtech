import { supabaseAdmin } from '../lib/supabaseAdmin';
import { assertProjectRole } from './projectCollaboration';

export type VersionAction = 'write' | 'delete' | 'create_folder';

async function projectOwnerId(projectId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('user_id')
    .eq('id', projectId)
    .single();
  if (error || !data?.user_id) throw new Error(`Project owner lookup failed: ${error?.message ?? 'owner missing'}`);
  return data.user_id;
}

/**
 * Captures the state of a file/folder BEFORE a mutating tool call touches it,
 * so the change can be undone later. Called from agentTools.runTool right
 * before writeProjectFile/createProjectFolder/deleteProjectFile actually run.
 */
export async function snapshotBeforeChange(
  userId: string,
  projectId: string,
  path: string,
  turnId: string,
  action: VersionAction
): Promise<void> {
  await assertProjectRole(userId, projectId, 'editor');
  const ownerId = await projectOwnerId(projectId);
  const { data: existing } = await supabaseAdmin
    .from('project_files')
    .select('content, is_folder')
    .eq('project_id', projectId)
    .eq('user_id', ownerId)
    .eq('path', path)
    .maybeSingle();

  const { error } = await supabaseAdmin.from('project_file_versions').insert({
    project_id: projectId,
    user_id: ownerId,
    turn_id: turnId,
    path,
    action,
    existed_before: !!existing,
    prev_content: existing?.content ?? null,
    prev_is_folder: existing?.is_folder ?? false,
  });

  if (error) {
    console.error('[snapshotBeforeChange] Supabase error:', error.message);
    // Don't throw — a failed snapshot shouldn't block the AI's actual work,
    // it just means this one change won't be revertible.
  }
}

export interface TurnChange {
  path: string;
  action: VersionAction;
  existed_before: boolean;
}

/** Lists what a turn changed, for the accept/reject summary shown in chat. */
export async function getTurnChanges(userId: string, projectId: string, turnId: string): Promise<TurnChange[]> {
  await assertProjectRole(userId, projectId, 'editor');
  const ownerId = await projectOwnerId(projectId);
  const { data, error } = await supabaseAdmin
    .from('project_file_versions')
    .select('path, action, existed_before')
    .eq('project_id', projectId)
    .eq('user_id', ownerId)
    .eq('turn_id', turnId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`getTurnChanges failed: ${error.message}`);
  return data ?? [];
}

/**
 * Reverts every change made in one agent turn, restoring each touched file
 * to exactly how it was before that turn started. Processes newest-first so
 * chained edits within the same turn unwind correctly.
 */
export async function revertTurn(userId: string, projectId: string, turnId: string): Promise<void> {
  await assertProjectRole(userId, projectId, 'editor');
  const ownerId = await projectOwnerId(projectId);
  const { data: versions, error } = await supabaseAdmin
    .from('project_file_versions')
    .select('path, action, existed_before, prev_content, prev_is_folder')
    .eq('project_id', projectId)
    .eq('user_id', ownerId)
    .eq('turn_id', turnId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`revertTurn failed to load versions: ${error.message}`);
  if (!versions || versions.length === 0) return;

  for (const v of versions) {
    if (v.existed_before) {
      const { error: upsertErr } = await supabaseAdmin.from('project_files').upsert(
        {
          project_id: projectId,
          user_id: ownerId,
          path: v.path,
          is_folder: v.prev_is_folder,
          content: v.prev_content,
        },
        { onConflict: 'project_id,path' }
      );
      if (upsertErr) throw new Error(`revertTurn restore failed for ${v.path}: ${upsertErr.message}`);
    } else {
      const { error: delErr } = await supabaseAdmin
        .from('project_files')
        .delete()
        .eq('project_id', projectId)
        .eq('user_id', ownerId)
        .eq('path', v.path);
      if (delErr) throw new Error(`revertTurn delete failed for ${v.path}: ${delErr.message}`);
    }
  }
}

/** Reverts one specific file to the most recent snapshot on record, regardless of turn. */
export async function revertFileToPreviousVersion(
  userId: string,
  projectId: string,
  path: string
): Promise<void> {
  await assertProjectRole(userId, projectId, 'editor');
  const ownerId = await projectOwnerId(projectId);
  const { data: version, error } = await supabaseAdmin
    .from('project_file_versions')
    .select('existed_before, prev_content, prev_is_folder')
    .eq('project_id', projectId)
    .eq('user_id', ownerId)
    .eq('path', path)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`revertFileToPreviousVersion failed: ${error.message}`);
  if (!version) throw new Error(`No version history found for ${path}.`);

  if (version.existed_before) {
    const { error: upsertErr } = await supabaseAdmin.from('project_files').upsert(
      {
        project_id: projectId,
        user_id: ownerId,
        path,
        is_folder: version.prev_is_folder,
        content: version.prev_content,
      },
      { onConflict: 'project_id,path' }
    );
    if (upsertErr) throw new Error(`revertFileToPreviousVersion restore failed: ${upsertErr.message}`);
  } else {
    const { error: delErr } = await supabaseAdmin
      .from('project_files')
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', ownerId)
      .eq('path', path);
    if (delErr) throw new Error(`revertFileToPreviousVersion delete failed: ${delErr.message}`);
  }
}
