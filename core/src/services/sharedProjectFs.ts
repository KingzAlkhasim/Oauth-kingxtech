import { supabaseAdmin } from '../lib/supabaseAdmin';
import { BINARY_PREFIX, extensionOf } from './binaryFiles';
import { ProjectPermissionError, requireProjectRole } from './projectPermissions';

function normalizePath(rawPath: string): string {
  const input = rawPath.trim();
  if (!input || input.startsWith('/') || input.includes('\\') || /^[a-z]:[\\/]/i.test(input)) throw new ProjectPermissionError('Invalid project path.');
  const path = input.replace(/\/+$/, '');
  if (!path || path.length > 500 || path.split('/').some((part) => !part || part === '.' || part === '..')) throw new ProjectPermissionError('Invalid project path.');
  return path;
}

async function ownerId(projectId: string): Promise<string> {
  const { data, error } = await supabaseAdmin.from('projects').select('user_id').eq('id', projectId).maybeSingle();
  if (error || !data?.user_id) throw new ProjectPermissionError('Project not found.');
  return data.user_id;
}

export async function listSharedProjectFiles(userId: string, projectId: string, includeContent = false) {
  await requireProjectRole(userId, projectId, 'viewer');
  let query = supabaseAdmin.from('project_files').select(includeContent ? 'path,is_folder,content,updated_at' : 'path,is_folder,updated_at').eq('project_id', projectId).order('path', { ascending: true });
  const { data, error } = await query;
  if (error) throw new Error(`shared project file list failed: ${error.message}`);
  return data ?? [];
}

export async function readSharedProjectFile(userId: string, projectId: string, rawPath: string) {
  await requireProjectRole(userId, projectId, 'viewer');
  const path = normalizePath(rawPath);
  const { data, error } = await supabaseAdmin.from('project_files').select('path,is_folder,content,updated_at').eq('project_id', projectId).eq('path', path).maybeSingle();
  if (error) throw new Error(`shared project file read failed: ${error.message}`);
  if (!data) throw new ProjectPermissionError(`File not found: ${path}`);
  return data;
}

export async function writeSharedProjectFile(userId: string, projectId: string, rawPath: string, content: string) {
  await requireProjectRole(userId, projectId, 'editor');
  const path = normalizePath(rawPath);
  if (content.startsWith(BINARY_PREFIX)) throw new ProjectPermissionError('Binary files must be uploaded from the workspace.');
  const owner = await ownerId(projectId);
  const { error } = await supabaseAdmin.from('project_files').upsert({ project_id: projectId, user_id: owner, path, is_folder: false, content }, { onConflict: 'project_id,path' });
  if (error) throw new Error(`shared project file write failed: ${error.message}`);
}

export async function createSharedProjectFolder(userId: string, projectId: string, rawPath: string) {
  await requireProjectRole(userId, projectId, 'editor');
  const path = normalizePath(rawPath);
  const owner = await ownerId(projectId);
  const { error } = await supabaseAdmin.from('project_files').upsert({ project_id: projectId, user_id: owner, path, is_folder: true, content: null }, { onConflict: 'project_id,path' });
  if (error) throw new Error(`shared project folder create failed: ${error.message}`);
}

export async function deleteSharedProjectFile(userId: string, projectId: string, rawPath: string) {
  await requireProjectRole(userId, projectId, 'editor');
  const path = normalizePath(rawPath);
  const { error } = await supabaseAdmin.from('project_files').delete().eq('project_id', projectId).eq('path', path);
  if (error) throw new Error(`shared project file delete failed: ${error.message}`);
  const { error: childError } = await supabaseAdmin.from('project_files').delete().eq('project_id', projectId).like('path', `${path}/%`);
  if (childError) throw new Error(`shared project children delete failed: ${childError.message}`);
}

export function sharedFileMetadata(content: string | null, path: string) {
  if (!content?.startsWith(BINARY_PREFIX)) return null;
  const encoded = content.slice(BINARY_PREFIX.length);
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return { path, type: extensionOf(path), size: Math.max(0, encoded.length * 3 / 4 - padding) };
}
