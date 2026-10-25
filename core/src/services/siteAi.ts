import { supabaseAdmin } from '../lib/supabaseAdmin';
import { assertProjectRole } from './projectCollaboration';
import { cleanSiteAiSettings, SITE_AI_DEFAULTS } from './siteAiPolicy';
import type { SiteAiSettings } from './siteAiPolicy';

export class SiteAiError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export async function getSiteAiSettings(projectId: string): Promise<SiteAiSettings> {
  const { data, error } = await supabaseAdmin
    .from('project_ai')
    .select('enabled, model_code, system_prompt, daily_limit')
    .eq('project_id', projectId)
    .maybeSingle();
  if (error) throw new Error(`Site AI settings lookup failed: ${error.message}`);
  if (!data) return { enabled: false, modelCode: SITE_AI_DEFAULTS.modelCode, systemPrompt: '', dailyLimit: SITE_AI_DEFAULTS.dailyLimit };
  return cleanSiteAiSettings({ enabled: data.enabled, modelCode: data.model_code, systemPrompt: data.system_prompt, dailyLimit: data.daily_limit });
}

/** Only the project owner may change this, because the owner's wallet pays for it. */
export async function saveSiteAiSettings(userId: string, projectId: string, input: unknown): Promise<SiteAiSettings> {
  await assertProjectRole(userId, projectId, 'owner');
  const settings = cleanSiteAiSettings(input);
  const { error } = await supabaseAdmin.from('project_ai').upsert({
    project_id: projectId,
    enabled: settings.enabled,
    model_code: settings.modelCode,
    system_prompt: settings.systemPrompt,
    daily_limit: settings.dailyLimit,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Site AI settings save failed: ${error.message}`);
  return settings;
}

export async function getProjectOwnerAndHosts(projectId: string): Promise<{ ownerId: string; customHosts: string[] } | null> {
  const { data: project, error } = await supabaseAdmin.from('projects').select('user_id').eq('id', projectId).maybeSingle();
  if (error) throw new Error(`Project lookup failed: ${error.message}`);
  if (!project?.user_id) return null;
  const { data: domains } = await supabaseAdmin.from('custom_domains').select('domain, verified').eq('project_id', projectId);
  const customHosts = (domains ?? []).filter((d: any) => d.verified).map((d: any) => String(d.domain).toLowerCase());
  return { ownerId: project.user_id, customHosts };
}

/** Takes one request from today's allowance. False means the daily limit is used up. */
export async function takeDailyRequest(projectId: string, limit: number): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('take_project_ai_request', { p_project: projectId, p_limit: limit });
  if (error) throw new Error(`Daily allowance check failed: ${error.message}`);
  return data === true;
}

// Per visitor, per site: 8 messages a minute. In memory, so it is approximate on a multi-instance host;
// the daily limit above is the hard cap.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 8;
const hits = new Map<string, { count: number; start: number }>();
export function visitorWithinRate(key: string, now = Date.now()): boolean {
  const entry = hits.get(key);
  if (!entry || now - entry.start > WINDOW_MS) {
    if (hits.size > 5000) hits.clear();
    hits.set(key, { count: 1, start: now });
    return true;
  }
  if (entry.count >= MAX_PER_WINDOW) return false;
  entry.count += 1;
  return true;
}
