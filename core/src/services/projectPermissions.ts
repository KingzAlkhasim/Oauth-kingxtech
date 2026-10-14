import { supabaseAdmin } from '../lib/supabaseAdmin';
import { roleAtLeast, type ProjectRole } from '../config/collaboration';

export class ProjectPermissionError extends Error {
  status = 403;
  code = 'project_forbidden';
}

export async function getProjectRole(userId: string, projectId: string): Promise<ProjectRole | null> {
  const { data, error } = await supabaseAdmin
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`project membership lookup failed: ${error.message}`);
  return (data?.role as ProjectRole | undefined) ?? null;
}

export async function requireProjectRole(userId: string, projectId: string, minimum: ProjectRole): Promise<ProjectRole> {
  const role = await getProjectRole(userId, projectId);
  if (!role || !roleAtLeast(role, minimum)) {
    throw new ProjectPermissionError('You do not have permission to perform this action on this project.');
  }
  return role;
}

export async function requireProjectMember(userId: string, projectId: string): Promise<ProjectRole> {
  return requireProjectRole(userId, projectId, 'viewer');
}
