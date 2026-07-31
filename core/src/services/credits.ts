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

export async function getCreditsRemaining(userId: string): Promise<{ remaining: number; allowance: number; purchased: number }> {
  const { data, error } = await supabaseAdmin
    .from('billing_profile')
    .select('free_credits_remaining, free_credits_month, purchased_credits')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return { remaining: MONTHLY_ALLOWANCE, allowance: MONTHLY_ALLOWANCE, purchased: 0 };

  const free = data.free_credits_month === currentMonthKey() ? data.free_credits_remaining : MONTHLY_ALLOWANCE;
  const purchased = data.purchased_credits ?? 0;
  return { remaining: free + purchased, allowance: MONTHLY_ALLOWANCE, purchased };
}

/**
 * Converts wallet USD balance into purchased AI credits (never expire,
 * unlike the monthly free pool — see migration 027 for why they're kept
 * separate). Used by the Store's "buy AI credits with your wallet balance"
 * flow, which is how a user actually gets more usable credits beyond the
 * monthly free allowance without waiting for a subscription-tied top-up.
 */
export async function convertWalletToCredits(
  userId: string,
  usdAmount: number,
  creditsPerUsd = 100
): Promise<{ ok: boolean; walletBalance: number; purchasedCredits: number }> {
  const { data, error } = await supabaseAdmin.rpc('convert_wallet_to_credits', {
    p_user_id: userId,
    p_usd_amount: usdAmount,
    p_credits_per_usd: creditsPerUsd,
  });
  if (error) throw new Error(`convertWalletToCredits failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: row.ok, walletBalance: Number(row.new_wallet_balance), purchasedCredits: row.new_purchased_credits };
}

/**
 * Charges the wallet directly for a request authenticated via a kx_live_/
 * kx_test_ API key — deliberately separate from consumeCredits above, which
 * only ever applies to K-XpertAI's in-app chat credit pool. Direct API key
 * usage is real, metered spend against the wallet, logged in usage_log
 * (shown in Console → AI Lab → "API key usage"), not the free credit pool.
 */
export async function chargeUserByApiKey(userId: string, usdCost: number): Promise<{ allowed: boolean; balance: number }> {
  const { data, error } = await supabaseAdmin.rpc('charge_user_by_id', { p_user_id: userId, p_cost: usdCost });
  if (error) throw new Error(`chargeUserByApiKey failed: ${error.message}`);
  return { allowed: data.allowed, balance: Number(data.balance) };
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