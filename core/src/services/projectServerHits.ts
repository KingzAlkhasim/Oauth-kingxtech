import { supabaseAdmin } from '../lib/supabaseAdmin';

/** Turns a request path into a countable shape: ids and numbers collapse so /users/42 and /users/43 are one row. */
export function normalizeHitPath(path: unknown): string {
  const text = typeof path === 'string' ? path.split('?')[0] : '/';
  const segments = text.split('/').filter((s) => s !== '').slice(0, 8).map((s) => {
    let seg = s;
    try { seg = decodeURIComponent(s); } catch { /* keep as is */ }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':id';
    if (/^\d+$/.test(seg)) return ':n';
    if (/^[0-9a-f]{16,}$/i.test(seg)) return ':id';
    return seg.replace(/[^\w.\-~@]/g, '_').slice(0, 40);
  });
  return ('/' + segments.join('/')).slice(0, 120);
}

const BOT = /bot|crawl|spider|slurp|monitor|uptime|ping|probe|scan|fetch|curl|wget|python|go-http|java\/|axios|node-fetch|headless|lighthouse|preview|facebookexternalhit|whatsapp|telegram|discord|slack/i;

/** "browser" for a normal browser, "bot" for crawlers, monitors and scripts, "other" when there is no user agent. */
export function classifyAgent(userAgent: unknown): 'browser' | 'bot' | 'other' {
  const ua = typeof userAgent === 'string' ? userAgent : '';
  if (!ua) return 'other';
  if (BOT.test(ua)) return 'bot';
  return /^Mozilla\//.test(ua) ? 'browser' : 'other';
}

/** Counts one request. Never throws and never delays the response: a failed count is only logged. */
export function recordHit(projectId: string, path: string, userAgent: unknown, status: number): void {
  void (async () => {
    try {
      const { error } = await supabaseAdmin.rpc('ps_record_hit', { p_project: projectId, p_path: normalizeHitPath(path), p_agent: classifyAgent(userAgent), p_status: status });
      if (error) console.error('[project-server] hit count failed:', error.message);
    } catch (e) { console.error('[project-server] hit count failed:', e); }
  })();
}

export interface HitSummary { total: number; browser: number; bot: number; other: number; top: { path: string; hits: number; errors: number; bot: number }[] }

export async function hitsSummary(ownerId: string, projectId: string): Promise<HitSummary> {
  const { data, error } = await supabaseAdmin.rpc('ps_hits_summary', { p_owner: ownerId, p_project: projectId, p_month: null, p_limit: 5 });
  if (error) throw new Error(`ps_hits_summary failed: ${error.message}`);
  const d = (data ?? {}) as Partial<HitSummary>;
  return { total: Number(d.total ?? 0), browser: Number(d.browser ?? 0), bot: Number(d.bot ?? 0), other: Number(d.other ?? 0), top: Array.isArray(d.top) ? d.top : [] };
}
