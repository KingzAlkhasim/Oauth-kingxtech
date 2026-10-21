import { supabaseAdmin } from '../lib/supabaseAdmin';
import { assertProjectRole } from './projectCollaboration';
import { inspectSite, type LiveSiteReport } from './liveSiteCheck';

const SITE_ORIGIN = 'https://site.kingxtech.name.ng';

export type LiveSiteOutcome = { ok: true; report: LiveSiteReport } | { ok: false; error: string };

/**
 * Checks the project's own published site. The address is built here from the project's slug,
 * never taken from the AI or the user, so this cannot be pointed at another host.
 */
export async function checkLiveSite(userId: string, projectId: string | undefined): Promise<LiveSiteOutcome> {
  if (!projectId) return { ok: false, error: 'No project is open, so there is no site to check.' };
  await assertProjectRole(userId, projectId, 'viewer');

  const { data: project, error } = await supabaseAdmin.from('projects').select('slug, published_at').eq('id', projectId).maybeSingle();
  if (error) return { ok: false, error: 'Could not look up the project.' };
  if (!project?.slug || !project.published_at) {
    return { ok: false, error: 'This project is not published yet. Ask the user to press Publish first, then check again.' };
  }
  const report = await inspectSite(`${SITE_ORIGIN}/${project.slug}/`, fetch as never);
  return { ok: true, report };
}
