import { supabase } from './supabase';

export async function listDomains() {
  return supabase.from('custom_domains').select('*, projects(id, name)').order('created_at', { ascending: false });
}

export async function listDomainProjects() {
  return supabase.from('projects').select('id, name, status, external_url').order('updated_at', { ascending: false });
}

export async function addDomain(domain, projectId) {
  const { data: userData } = await supabase.auth.getUser();
  return supabase.from('custom_domains').insert({ user_id: userData.user.id, domain, project_id: projectId }).select('*, projects(id, name)').single();
}

export async function removeDomain(id) {
  return supabase.from('custom_domains').delete().eq('id', id);
}

export async function checkDnsRecord(domain, expectedTarget) {
  const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=CNAME`);
  const json = await res.json();
  const answers = json.Answer || [];
  const cnames = answers.map((a) => String(a.data).replace(/\.$/, '').toLowerCase());
  const target = expectedTarget.replace(/\.$/, '').toLowerCase();
  return { verified: cnames.includes(target), records: cnames, raw: json };
}

export async function verifyDomain(id, domain, expectedTarget) {
  const { verified } = await checkDnsRecord(domain, expectedTarget);
  const { error } = await supabase.from('custom_domains').update({ verified, last_checked_at: new Date().toISOString() }).eq('id', id);
  return { verified, error };
}
