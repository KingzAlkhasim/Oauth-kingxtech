import { waitUntil } from '@vercel/functions';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { buildStats, type SiteViewStats } from './siteViewStats';

// Views are batched per project in memory so a traffic spike cannot turn into a database write
// for every hit. At most one write per project every 2 seconds; the batch carries the count.
const pending = new Map<string, number>();
const lastFlush = new Map<string, number>();
const FLUSH_EVERY_MS = 2000;

async function flush(projectId: string, count: number): Promise<void> {
  const { error } = await supabaseAdmin.rpc('record_site_views', { p_project: projectId, p_count: count });
  if (error) console.error('[site-views] could not record views:', error.message); // never affect the site itself
}

/** Records one page view without delaying the response. Failures are logged and ignored. */
export function recordSiteView(projectId: string): void {
  pending.set(projectId, (pending.get(projectId) ?? 0) + 1);
  const now = Date.now();
  if (now - (lastFlush.get(projectId) ?? 0) < FLUSH_EVERY_MS) return;
  const count = pending.get(projectId) ?? 0;
  pending.delete(projectId);
  lastFlush.set(projectId, now);
  if (count <= 0) return;
  const work = flush(projectId, count).catch(() => undefined);
  try { waitUntil(work); } catch { /* not on Vercel: the promise still runs */ }
}

export async function getSiteViewStats(projectId: string): Promise<SiteViewStats> {
  const { data, error } = await supabaseAdmin.from('site_views').select('day, views').eq('project_id', projectId);
  if (error) throw new Error(`getSiteViewStats failed: ${error.message}`);
  return buildStats((data ?? []) as Array<{ day: string; views: number }>);
}
