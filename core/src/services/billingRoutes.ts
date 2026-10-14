import type { Request, Response } from 'express';
import { env } from '../config/env';
import { PRO_PLAN_PRICE_USD } from '../config/billing';
import { supabaseAdmin } from '../lib/supabaseAdmin';

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;
const requestCounts = new Map<string, { count: number; resetAt: number }>();

function rateLimitBilling(userId: string, route: string): boolean {
  const key = `${userId}:${route}`;
  const now = Date.now();
  const current = requestCounts.get(key);

  if (!current || current.resetAt <= now) {
    requestCounts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (current.count >= MAX_REQUESTS_PER_WINDOW) return false;
  current.count += 1;
  return true;
}

function getUserId(req: Request): string | null {
  return (req as Request & { user?: { id: string } }).user?.id ?? null;
}

export async function handleBillingRoute(req: Request, res: Response): Promise<boolean> {
  const userId = getUserId(req);
  if (!userId) return false;

  const path = req.path;
  const handled = path === '/api/billing/cancel'
    || path === '/api/billing/resume'
    || path === '/api/billing/pay-pro-with-wallet';
  if (!handled) return false;

  if (!rateLimitBilling(userId, path)) {
    res.status(429).json({ success: false, error: 'Too many billing requests. Please try again shortly.' });
    return true;
  }

  try {
    if (path === '/api/billing/cancel' || path === '/api/billing/resume') {
      const cancelAtPeriodEnd = path.endsWith('/cancel');
      const { data, error } = await supabaseAdmin
        .from('billing_profile')
        .update({
          plan_cancel_at_period_end: cancelAtPeriodEnd,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .select('plan, plan_expires_at, plan_cancel_at_period_end, credit_balance')
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        res.status(404).json({ success: false, error: 'Billing profile not found.' });
        return true;
      }

      res.json({
        success: true,
        plan: data.plan,
        planExpiresAt: data.plan_expires_at,
        cancelAtPeriodEnd: data.plan_cancel_at_period_end,
        walletBalance: Number(data.credit_balance ?? 0),
      });
      return true;
    }

    const idempotencyKey = typeof req.body?.idempotencyKey === 'string'
      ? req.body.idempotencyKey.trim()
      : '';
    if (!idempotencyKey || idempotencyKey.length > 200) {
      res.status(400).json({ success: false, error: 'A valid idempotencyKey is required.' });
      return true;
    }

    const { data, error } = await supabaseAdmin.rpc('pay_pro_from_wallet', {
      p_user_id: userId,
      p_idempotency_key: idempotencyKey,
      p_price: PRO_PLAN_PRICE_USD,
    });

    if (error) {
      if (/insufficient wallet balance/i.test(error.message)) {
        res.status(402).json({ success: false, error: 'Insufficient wallet balance. Add funds to renew Pro.' });
        return true;
      }
      throw error;
    }

    const row = Array.isArray(data) ? data[0] : data;
    res.json({
      success: true,
      planExpiresAt: row?.plan_expires_at ?? null,
      walletBalance: Number(row?.credit_balance ?? 0),
    });
    return true;
  } catch (error) {
    console.error('[billing] route error:', error);
    res.status(500).json({ success: false, error: 'Billing operation failed.' });
    return true;
  }
}

export async function handleBillingMaintenance(req: Request, res: Response): Promise<boolean> {
  if (req.path !== '/api/internal/cron/expire-plans') return false;

  const secret = env.CRON_SECRET;
  const authorization = req.headers.authorization;
  if (!secret || authorization !== `Bearer ${secret}`) {
    res.status(401).json({ success: false, error: 'Unauthorized.' });
    return true;
  }

  try {
    const { error } = await supabaseAdmin.rpc('expire_lapsed_plans');
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('[billing] expiry cron error:', error);
    res.status(500).json({ success: false, error: 'Plan expiry job failed.' });
  }
  return true;
}
