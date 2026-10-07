import { env } from '../config/env';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { assertProjectOwnership } from './projectFs';

// Production Vercel project receiving customer custom domains.
const VERCEL_PROJECT = 'neurocore';
const VERCEL_API = 'https://api.vercel.com';
const KINGXTECH_BASE_DOMAIN = 'kingxtech.name.ng';
const RESERVED_KINGXTECH_SUBDOMAINS = new Set([
  'auth', 'site', 'api', 'www', 'docs', 'admin', 'console', 'mail', 'status', 'app', 'cdn', 'static',
]);

type VercelVerification = {
  type?: string;
  domain?: string;
  value?: string;
  reason?: string;
};

type VercelDomainResponse = {
  name?: string;
  apexName?: string;
  projectId?: string;
  verified?: boolean;
  verification?: VercelVerification[];
  [key: string]: unknown;
};

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
}

function isDnsSafeSlug(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value);
}

function requireVercelConfig() {
  if (!env.VERCEL_TOKEN || !env.VERCEL_TEAM_ID) {
    throw new Error('Custom domain management is not configured on the server.');
  }
  return { token: env.VERCEL_TOKEN, teamId: env.VERCEL_TEAM_ID };
}

async function vercelRequest(path: string, init: RequestInit = {}): Promise<VercelDomainResponse> {
  const { token, teamId } = requireVercelConfig();
  const url = new URL(`${VERCEL_API}${path}`);
  url.searchParams.set('teamId', teamId);

  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  let data: VercelDomainResponse & { error?: { message?: string }; message?: string };
  try { data = JSON.parse(text); } catch { data = { message: text }; }

  if (!response.ok) {
    throw new Error(data.error?.message || data.message || `Vercel API failed with HTTP ${response.status}`);
  }
  return data;
}

export async function addCustomDomain(userId: string, projectId: string, rawDomain: string) {
  await assertProjectOwnership(userId, projectId);
  const domain = normalizeDomain(rawDomain);

  if (!domain || !domain.includes('.') || domain.length > 253) throw new Error('Enter a valid domain name.');

  if (domain === KINGXTECH_BASE_DOMAIN) {
    throw new Error('kingxtech.name.ng itself cannot be connected as a project domain.');
  }

  if (domain.endsWith(`.${KINGXTECH_BASE_DOMAIN}`)) {
    const slug = domain.slice(0, -(KINGXTECH_BASE_DOMAIN.length + 1));

    if (!isDnsSafeSlug(slug) || RESERVED_KINGXTECH_SUBDOMAINS.has(slug)) {
      throw new Error('This KingxTech subdomain must use a lowercase DNS-safe project slug.');
    }

    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('slug')
      .eq('id', projectId)
      .eq('user_id', userId)
      .maybeSingle();

    if (projectError) throw new Error(`Project lookup failed: ${projectError.message}`);
    if (!project?.slug || project.slug !== slug) {
      throw new Error("You can only use the KingxTech subdomain matching this project's own slug.");
    }
  }

  const { data: existingDomain, error: existingDomainError } = await supabaseAdmin
    .from('custom_domains')
    .select('user_id, project_id')
    .eq('domain', domain)
    .maybeSingle();

  if (existingDomainError) {
    throw new Error('custom domain lookup failed: ' + existingDomainError.message);
  }

  if (
    existingDomain &&
    (existingDomain.user_id !== userId || existingDomain.project_id !== projectId)
  ) {
    throw new Error('This domain is already connected to another project.');
  }

  const vercel = await vercelRequest(`/v10/projects/${encodeURIComponent(VERCEL_PROJECT)}/domains`, {
    method: 'POST',
    body: JSON.stringify({ name: domain }),
  });

  const domainValues = {
    domain,
    verified: vercel.verified === true,
    target_cname: 'cname.vercel-dns.com',
    verification: vercel.verification ?? [],
    last_checked_at: new Date().toISOString(),
  };

  const { data, error } = existingDomain
    ? await supabaseAdmin
      .from('custom_domains')
      .update(domainValues)
      .eq('domain', domain)
      .eq('user_id', userId)
      .eq('project_id', projectId)
      .select('*, projects(id, name)')
      .single()
    : await supabaseAdmin
      .from('custom_domains')
      .insert({
        user_id: userId,
        project_id: projectId,
        ...domainValues,
      })
      .select('*, projects(id, name)')
      .single();

  if (error) throw new Error(`custom domain save failed: ${error.message}`);
  return { domain: data, vercel };
}

export async function verifyCustomDomain(userId: string, id: string) {
  const { data: record, error: lookupError } = await supabaseAdmin
    .from('custom_domains')
    .select('id, domain, project_id')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (lookupError || !record) throw new Error('Domain not found.');
  await assertProjectOwnership(userId, record.project_id);

  const vercel = await vercelRequest(
    `/v9/projects/${encodeURIComponent(VERCEL_PROJECT)}/domains/${encodeURIComponent(record.domain)}/verify`,
    { method: 'POST' },
  );

  const { data, error } = await supabaseAdmin
    .from('custom_domains')
    .update({
      verified: vercel.verified === true,
      verification: vercel.verification ?? [],
      last_checked_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*, projects(id, name)')
    .single();

  if (error) throw new Error(`custom domain verification save failed: ${error.message}`);
  return { domain: data, vercel };
}

export async function removeCustomDomain(userId: string, id: string) {
  const { data: record, error: lookupError } = await supabaseAdmin
    .from('custom_domains')
    .select('id, domain, project_id')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (lookupError || !record) throw new Error('Domain not found.');
  await assertProjectOwnership(userId, record.project_id);

  try {
    await vercelRequest(
      `/v9/projects/${encodeURIComponent(VERCEL_PROJECT)}/domains/${encodeURIComponent(record.domain)}`,
      { method: 'DELETE' },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/not found|404/i.test(message)) throw error;
  }

  const { error } = await supabaseAdmin
    .from('custom_domains')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) throw new Error(`custom domain delete failed: ${error.message}`);
}

export async function getProjectIdByCustomDomain(hostname: string): Promise<string | null> {
  const host = normalizeDomain(hostname).replace(/^www\./, '');
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
