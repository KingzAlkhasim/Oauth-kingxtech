import { supabaseAdmin } from '../lib/supabaseAdmin';
import { getPublicProjectEnvVars } from './projectEnvVars';

/**
 * Builds the "window.KX_ENV = {...}" script served at /preview|/site/.../kx-env.js.
 * Merges account-wide public vars (Console → KX Cloud) with this specific
 * project's own public vars (Site Settings) — project-level vars win on
 * key collisions, since they're the more specific scope. Only vars
 * explicitly marked public are ever included — that's the safety boundary
 * between "account/project config" (private) and "this published site's
 * client-side code is allowed to read this".
 */
export async function buildPublicEnvScript(ownerUserId: string, projectId?: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('env_vars')
    .select('key, value')
    .eq('user_id', ownerUserId)
    .eq('is_public', true);

  if (error) {
    console.error('[buildPublicEnvScript] Supabase error:', error.message);
  }

  const accountVars = Object.fromEntries((data ?? []).map((row) => [row.key, row.value]));
  const projectVars = projectId ? await getPublicProjectEnvVars(projectId) : {};
  const merged = { ...accountVars, ...projectVars };

  return `window.KX_ENV = ${JSON.stringify(merged)};`;
}
