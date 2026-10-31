import { supabaseAdmin } from '../lib/supabaseAdmin';
import { assertProjectRole } from './projectCollaboration';
import { cleanRules, MAX_ROWS_PER_PROJECT } from './siteDataPolicy';
import type { CollectionRules } from './siteDataPolicy';

export async function getRules(projectId: string, collection: string): Promise<CollectionRules> {
  const { data, error } = await supabaseAdmin
    .from('project_data_rules').select('public_create, public_read')
    .eq('project_id', projectId).eq('collection', collection).maybeSingle();
  if (error) throw new Error(`Data rules lookup failed: ${error.message}`);
  return { publicCreate: data?.public_create === true, publicRead: data?.public_read === true };
}

/** Collections that have records or rules, with counts. Owner/editor view. */
export async function listCollections(userId: string, projectId: string) {
  await assertProjectRole(userId, projectId, 'viewer');
  const [{ data: rules, error: e1 }, { data: rows, error: e2 }] = await Promise.all([
    supabaseAdmin.from('project_data_rules').select('collection, public_create, public_read').eq('project_id', projectId),
    supabaseAdmin.from('project_data_rows').select('collection').eq('project_id', projectId).limit(MAX_ROWS_PER_PROJECT),
  ]);
  if (e1 || e2) throw new Error(`Collections lookup failed: ${(e1 || e2)!.message}`);
  const counts = new Map<string, number>();
  for (const r of rows ?? []) counts.set(r.collection, (counts.get(r.collection) ?? 0) + 1);
  const names = new Set<string>([...counts.keys(), ...(rules ?? []).map((r: any) => r.collection)]);
  return [...names].sort().map((name) => {
    const rule = (rules ?? []).find((r: any) => r.collection === name);
    return { name, rows: counts.get(name) ?? 0, publicCreate: rule?.public_create === true, publicRead: rule?.public_read === true };
  });
}

export async function saveRules(userId: string, projectId: string, collection: string, input: unknown) {
  await assertProjectRole(userId, projectId, 'owner');
  const rules = cleanRules(input);
  const { error } = await supabaseAdmin.from('project_data_rules').upsert({
    project_id: projectId, collection, public_create: rules.publicCreate, public_read: rules.publicRead, updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Data rules save failed: ${error.message}`);
  return rules;
}

export async function listRows(projectId: string, collection: string, limit: number, before?: string) {
  let q = supabaseAdmin.from('project_data_rows').select('id, data, created_at')
    .eq('project_id', projectId).eq('collection', collection).order('created_at', { ascending: false }).limit(limit);
  if (before && !Number.isNaN(Date.parse(before))) q = q.lt('created_at', before);
  const { data, error } = await q;
  if (error) throw new Error(`Records lookup failed: ${error.message}`);
  return data ?? [];
}

export async function ownerListRows(userId: string, projectId: string, collection: string, limit: number, before?: string) {
  await assertProjectRole(userId, projectId, 'viewer');
  return listRows(projectId, collection, limit, before);
}

export async function addRow(projectId: string, collection: string, data: Record<string, unknown>): Promise<string | null> {
  const { data: id, error } = await supabaseAdmin.rpc('add_project_data_row', {
    p_project: projectId, p_collection: collection, p_data: data, p_max_rows: MAX_ROWS_PER_PROJECT,
  });
  if (error) throw new Error(`Record save failed: ${error.message}`);
  return typeof id === 'string' ? id : null;
}

export async function ownerAddRow(userId: string, projectId: string, collection: string, data: Record<string, unknown>) {
  await assertProjectRole(userId, projectId, 'editor');
  return addRow(projectId, collection, data);
}

export async function ownerDeleteRow(userId: string, projectId: string, rowId: string) {
  await assertProjectRole(userId, projectId, 'editor');
  const { error } = await supabaseAdmin.from('project_data_rows').delete().eq('project_id', projectId).eq('id', rowId);
  if (error) throw new Error(`Record delete failed: ${error.message}`);
}

/** Shared per-visitor limiter (Postgres, migration 045). Falls back to allowing only if the counter is down AND memory allows. */
const memory = new Map<string, { count: number; start: number }>();
export async function visitorAllowed(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin.rpc('take_rate_limit', { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
    if (!error && typeof data === 'boolean') return data;
  } catch { /* fall through to memory */ }
  const now = Date.now();
  if (memory.size > 5000) memory.clear();
  const e = memory.get(key);
  if (!e || now - e.start > windowSeconds * 1000) { memory.set(key, { count: 1, start: now }); return true; }
  if (e.count >= limit) return false;
  e.count += 1;
  return true;
}
