import { supabaseAdmin } from '../lib/supabaseAdmin';

export class ProjectAccessError extends Error {}

export interface ProjectFileEntry {
  path: string;
  is_folder: boolean;
  updated_at: string;
}

export interface ProjectFileContent extends ProjectFileEntry {
  content: string | null;
}

/**
 * Normalizes and validates a virtual path. This isn't guarding a real
 * filesystem (there's nothing to "escape" — it's just a DB column), but we
 * still reject weirdness so paths stay predictable and collision-free:
 * no leading/trailing slashes, no "..", no empty segments, reasonable length.
 */
function normalizePath(rawPath: string): string {
  const trimmed = rawPath.trim().replace(/^\/+/, '').replace(/\/+$/, '');

  if (!trimmed || trimmed.length > 500) {
    throw new ProjectAccessError('Invalid path.');
  }
  const segments = trimmed.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new ProjectAccessError('Path cannot contain empty, ".", or ".." segments.');
  }
  return trimmed;
}

/**
 * Confirms the project exists and belongs to this user before any file
 * operation runs. Required because supabaseAdmin uses the service role key
 * and bypasses RLS — this is the manual equivalent of the RLS check.
 */
export interface ProjectFileWithContent {
  path: string;
  is_folder: boolean;
  content: string | null;
}

/** Full listing with content, for bulk export use cases like pushing to GitHub. */
export async function listProjectFilesWithContent(
  userId: string,
  projectId: string
): Promise<ProjectFileWithContent[]> {
  await assertProjectOwnership(userId, projectId);
  const { data, error } = await supabaseAdmin
    .from('project_files')
    .select('path, is_folder, content')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .eq('is_folder', false) // Git has no concept of empty folders, so skip them
    .order('path', { ascending: true });

  if (error) throw new Error(`listProjectFilesWithContent failed: ${error.message}`);
  return data ?? [];
}

/** Resolves a project's owner, for public routes that need it (e.g. serving that owner's public env vars alongside a preview). */
export async function getProjectOwnerId(projectId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('projects').select('user_id').eq('id', projectId).maybeSingle();
  if (error) throw new Error(`getProjectOwnerId failed: ${error.message}`);
  return data?.user_id ?? null;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'project';
}

/**
 * Assigns a permanent, human-friendly slug to a project (if it doesn't
 * already have one) so it's reachable at /site/:slug/ in addition to the
 * raw /preview/:projectId/ link. Appends a short random suffix on collision.
 */
export async function publishProject(userId: string, projectId: string): Promise<string> {
  await assertProjectOwnership(userId, projectId);

  const { data: project, error: fetchErr } = await supabaseAdmin
    .from('projects')
    .select('name, slug')
    .eq('id', projectId)
    .single();
  if (fetchErr) throw new Error(`publishProject failed to load project: ${fetchErr.message}`);
  if (project.slug) {
    await supabaseAdmin.from('projects').update({ published_at: new Date().toISOString() }).eq('id', projectId);
    return project.slug;
  }

  const base = slugify(project.name || 'project');
  let slug = base;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: existing } = await supabaseAdmin.from('projects').select('id').eq('slug', slug).maybeSingle();
    if (!existing) break;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const { error: updateErr } = await supabaseAdmin
    .from('projects')
    .update({ slug, published_at: new Date().toISOString() })
    .eq('id', projectId);
  if (updateErr) throw new Error(`publishProject failed to save slug: ${updateErr.message}`);

  return slug;
}

export async function getProjectIdBySlug(slug: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('projects').select('id').eq('slug', slug).maybeSingle();
  if (error) throw new Error(`getProjectIdBySlug failed: ${error.message}`);
  return data?.id ?? null;
}

/**
 * Public read, used ONLY by the /preview route. No userId check — anyone
 * who has the project's UUID can view its files as a rendered site. That's
 * an intentional tradeoff (see server.ts preview route comment): project
 * IDs are unguessable UUIDs, so this behaves like any "anyone with the
 * link" share model, not true per-user access control.
 */
export async function readProjectFilePublic(
  projectId: string,
  rawPath: string
): Promise<ProjectFileContent | null> {
  const path = normalizePath(rawPath);
  const { data, error } = await supabaseAdmin
    .from('project_files')
    .select('path, is_folder, content, updated_at')
    .eq('project_id', projectId)
    .eq('path', path)
    .maybeSingle();

  if (error) throw new Error(`readProjectFilePublic failed: ${error.message}`);
  return data ?? null;
}

export async function assertProjectOwnership(userId: string, projectId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(`Ownership check failed: ${error.message}`);
  if (!data) throw new ProjectAccessError('Project not found or not owned by this user.');
}

export async function listProjectFiles(
  userId: string,
  projectId: string
): Promise<ProjectFileEntry[]> {
  await assertProjectOwnership(userId, projectId);

  const { data, error } = await supabaseAdmin
    .from('project_files')
    .select('path, is_folder, updated_at')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .order('path', { ascending: true });

  if (error) throw new Error(`listProjectFiles failed: ${error.message}`);
  return data ?? [];
}

export async function readProjectFile(
  userId: string,
  projectId: string,
  rawPath: string
): Promise<ProjectFileContent> {
  await assertProjectOwnership(userId, projectId);
  const path = normalizePath(rawPath);

  const { data, error } = await supabaseAdmin
    .from('project_files')
    .select('path, is_folder, content, updated_at')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .eq('path', path)
    .maybeSingle();

  if (error) throw new Error(`readProjectFile failed: ${error.message}`);
  if (!data) throw new ProjectAccessError(`File not found: ${path}`);
  return data;
}

/**
 * Creates a file if it doesn't exist, or overwrites its content if it does
 * (upsert). This is what both "create file" and "edit file" map to.
 */
export async function writeProjectFile(
  userId: string,
  projectId: string,
  rawPath: string,
  content: string
): Promise<void> {
  await assertProjectOwnership(userId, projectId);
  const path = normalizePath(rawPath);

  const { error } = await supabaseAdmin.from('project_files').upsert(
    {
      project_id: projectId,
      user_id: userId,
      path,
      is_folder: false,
      content,
    },
    { onConflict: 'project_id,path' }
  );

  if (error) throw new Error(`writeProjectFile failed: ${error.message}`);
}

export async function createProjectFolder(
  userId: string,
  projectId: string,
  rawPath: string
): Promise<void> {
  await assertProjectOwnership(userId, projectId);
  const path = normalizePath(rawPath);

  const { error } = await supabaseAdmin.from('project_files').upsert(
    {
      project_id: projectId,
      user_id: userId,
      path,
      is_folder: true,
      content: null,
    },
    { onConflict: 'project_id,path' }
  );

  if (error) throw new Error(`createProjectFolder failed: ${error.message}`);
}

/**
 * Deletes a single file, OR a folder and everything under it (prefix match
 * on "path/"), scoped to this user + project.
 */
export async function deleteProjectFile(
  userId: string,
  projectId: string,
  rawPath: string
): Promise<void> {
  await assertProjectOwnership(userId, projectId);
  const path = normalizePath(rawPath);

  const { error: exactErr } = await supabaseAdmin
    .from('project_files')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .eq('path', path);

  if (exactErr) throw new Error(`deleteProjectFile failed: ${exactErr.message}`);

  // Also remove any children if this was a folder (prefix match).
  const { error: childErr } = await supabaseAdmin
    .from('project_files')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .like('path', `${path}/%`);

  if (childErr) throw new Error(`deleteProjectFile (children) failed: ${childErr.message}`);
}
