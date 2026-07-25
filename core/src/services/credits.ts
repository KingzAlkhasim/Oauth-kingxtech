import { supabaseAdmin } from '../lib/supabaseAdmin';

export async function getUserPlan(userId: string): Promise<'free' | 'paid'> {
  const { data, error } = await supabaseAdmin
    .from('billing_profile')
    .select('is_pro_member')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return 'free';
  return data.is_pro_member ? 'paid' : 'free';
}

export interface CreditResult {
  ok: boolean;
  remaining: number;
}

const MONTHLY_ALLOWANCE = 300;

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function startOfMonthIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/**
 * Checks a per-model request cap (e.g. Gemini Flash: 5/month) independent of
 * the shared credit pool — this exists specifically for models that cost
 * KingxTech real money per call, so they stay bounded even if a user has
 * plenty of credits left.
 */
export async function checkModelRequestCap(
  userId: string,
  modelCode: string,
  cap: number
): Promise<{ ok: boolean; used: number }> {
  const { count, error } = await supabaseAdmin
    .from('kxpert_usage_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('model_code', modelCode)
    .gte('created_at', startOfMonthIso());

  if (error) throw new Error(`checkModelRequestCap failed: ${error.message}`);
  const used = count ?? 0;
  return { ok: used < cap, used };
}

/**
 * Atomically checks and deducts `cost` credits from the user's monthly free
 * pool (auto-resetting to 200 on a new month), via the consume_free_credit
 * Postgres function — this avoids the race condition of a naive
 * read-then-write from Node under concurrent requests.
 */
export async function consumeCredits(userId: string, cost: number): Promise<CreditResult> {
  const { data, error } = await supabaseAdmin.rpc('consume_free_credit', {
    p_user_id: userId,
    p_cost: cost,
    p_monthly_amount: MONTHLY_ALLOWANCE,
  });
  if (error) throw new Error(`consumeCredits failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: row.ok, remaining: row.remaining };
}

export async function getCreditsRemaining(userId: string): Promise<{ remaining: number; allowance: number }> {
  const { data, error } = await supabaseAdmin
    .from('billing_profile')
    .select('free_credits_remaining, free_credits_month')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return { remaining: MONTHLY_ALLOWANCE, allowance: MONTHLY_ALLOWANCE };

  const remaining = data.free_credits_month === currentMonthKey() ? data.free_credits_remaining : MONTHLY_ALLOWANCE;
  return { remaining, allowance: MONTHLY_ALLOWANCE };
}

export interface UsageLogEntry {
  id: string;
  provider: string;
  model_code: string;
  credit_cost: number;
  project_id: string | null;
  created_at: string;
}

export async function logUsage(
  userId: string,
  provider: string,
  modelCode: string,
  creditCost: number,
  projectId?: string
): Promise<void> {
  const { error } = await supabaseAdmin.from('kxpert_usage_log').insert({
    user_id: userId,
    provider,
    model_code: modelCode,
    credit_cost: creditCost,
    project_id: projectId ?? null,
  });
  if (error) console.error('[logUsage] Supabase error:', error.message);
}

export async function getUsageLog(userId: string, limit = 30): Promise<UsageLogEntry[]> {
  const { data, error } = await supabaseAdmin
    .from('kxpert_usage_log')
    .select('id, provider, model_code, credit_cost, project_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[getUsageLog] Supabase error:', error.message);
    return [];
  }
  return data ?? [];
}
