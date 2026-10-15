import { Router, type Request, type Response } from 'express';
import { env } from '../config/env';
import { PRO_PLAN_PRICE_USD } from '../config/billing';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';

const billingRouter = Router();

billingRouter.post('/api/billing/cancel', requireAuth, rateLimit, async (req: AuthedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('billing_profile')
      .update({
        plan_cancel_at_period_end: true,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', req.user!.id)
      .select('plan, plan_expires_at, plan_cancel_at_period_end, credit_balance')
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      res.status(404).json({ success: false, error: 'Billing profile not found.' });
      return;
    }

    res.json({
      success: true,
      plan: data.plan,
      planExpiresAt: data.plan_expires_at,
      cancelAtPeriodEnd: data.plan_cancel_at_period_end,
      walletBalance: Number(data.credit_balance ?? 0),
    });
  } catch (error) {
    console.error('[billing] cancel error:', error);
    res.status(500).json({ success: false, error: 'Failed to cancel Pro plan.' });
  }
});

billingRouter.post('/api/billing/resume', requireAuth, rateLimit, async (req: AuthedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('billing_profile')
      .update({
        plan_cancel_at_period_end: false,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', req.user!.id)
      .select('plan, plan_expires_at, plan_cancel_at_period_end, credit_balance')
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      res.status(404).json({ success: false, error: 'Billing profile not found.' });
      return;
    }

    res.json({
      success: true,
      plan: data.plan,
      planExpiresAt: data.plan_expires_at,
      cancelAtPeriodEnd: data.plan_cancel_at_period_end,
      walletBalance: Number(data.credit_balance ?? 0),
    });
  } catch (error) {
    console.error('[billing] resume error:', error);
    res.status(500).json({ success: false, error: 'Failed to resume Pro plan.' });
  }
});

billingRouter.post('/api/billing/pay-pro-with-wallet', requireAuth, rateLimit, async (req: AuthedRequest, res: Response) => {
  const idempotencyKey = typeof req.body?.idempotencyKey === 'string'
    ? req.body.idempotencyKey.trim()
    : '';

  if (!idempotencyKey || idempotencyKey.length > 200) {
    res.status(400).json({ success: false, error: 'A valid idempotencyKey is required.' });
    return;
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('pay_pro_from_wallet', {
      p_user_id: req.user!.id,
      p_idempotency_key: idempotencyKey,
      p_price: PRO_PLAN_PRICE_USD,
    });

    if (error) {
      if (/insufficient wallet balance/i.test(error.message)) {
        res.status(402).json({ success: false, error: 'Insufficient wallet balance. Add funds to renew Pro.' });
        return;
      }
      throw error;
    }

    const row = Array.isArray(data) ? data[0] : data;
    res.json({
      success: true,
      planExpiresAt: row?.plan_expires_at ?? null,
      walletBalance: Number(row?.credit_balance ?? 0),
    });
  } catch (error) {
    console.error('[billing] wallet renewal error:', error);
    res.status(500).json({ success: false, error: 'Wallet renewal failed.' });
  }
});

billingRouter.get('/api/internal/cron/expire-plans', async (req: Request, res: Response) => {
  const secret = env.CRON_SECRET;
  const authorization = req.headers.authorization;
  if (!secret || authorization !== `Bearer ${secret}`) {
    res.status(401).json({ success: false, error: 'Unauthorized.' });
    return;
  }

  try {
    const { error } = await supabaseAdmin.rpc('expire_lapsed_plans');
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('[billing] expiry cron error:', error);
    res.status(500).json({ success: false, error: 'Plan expiry job failed.' });
  }
});

export default billingRouter;
