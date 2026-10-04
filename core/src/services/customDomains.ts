import { supabaseAdmin } from '../lib/supabaseAdmin';

export async function getProjectIdByCustomDomain(hostname: string): Promise<string | null> {
  const host = hostname.trim().toLowerCase().split(':')[0].replace(/^www\./, '');
  if (!host || host === 'localhost') return null;

  const { data, error } = await supabaseAdmin
    .from('custom_domains')
    .select('project_id, verified')
    .eq('domain', host)
    .eq('verified', true)
    .maybeSingle();

  if (error) throw new Error(`custom domain lookup failed: ${error.message}`);
  return data?.project_id ?? null;
}
