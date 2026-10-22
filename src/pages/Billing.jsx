import { useEffect, useMemo, useState } from 'react';
import DashboardShell from '../components/DashboardShell';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import {
  cancelProPlan,
  getBillingProfile,
  initializePaystackCheckout,
  initializePaystackTopup,
  payProFromWallet,
  resumeProPlan,
} from '../lib/billing';
import { supabase } from '../lib/supabase';
import { Card, Button, Badge, ExpandableList } from '../components/ui';
import { Wallet, ExternalLink } from 'lucide-react';
import { friendlyError } from '../lib/errors';

const TOPUP_PRESETS = [5, 10, 25, 50];
const PRO_PRICE_USD = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

function getDaysLeft(expiry) {
  if (!expiry) return null;
  const remaining = new Date(expiry).getTime() - Date.now();
  return Math.max(0, Math.ceil(remaining / DAY_MS));
}

function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `pro-wallet-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function Billing() {
  useSeo({ title: 'Billing & Store — KingxTech', noindex: true });
  useRequireAuth();

  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [txns, setTxns] = useState(null);

  const [proLoading, setProLoading] = useState(false);
  const [proError, setProError] = useState('');
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState('');
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState('');

  const [topupAmount, setTopupAmount] = useState(10);
  const [customTopup, setCustomTopup] = useState('');
  const [topupLoading, setTopupLoading] = useState(false);
  const [topupError, setTopupError] = useState('');

  const refresh = async () => {
    const { data, error: fetchError } = await getBillingProfile();
    if (fetchError) {
      setError(/relation .*billing_profile.* does not exist/i.test(fetchError.message) ? 'SETUP' : fetchError.message);
      return;
    }
    setProfile(data);
  };

  const refreshTransactions = async () => {
    const { data, error: e } = await supabase
      .from('billing_events')
      .select('*')
      .order('processed_at', { ascending: false })
      .limit(50);
    setTxns(e ? [] : data);
  };

  useEffect(() => {
    refresh();
    refreshTransactions();
  }, []);

  const planInfo = useMemo(() => {
    const expiry = profile?.plan_expires_at ?? null;
    const daysLeft = getDaysLeft(expiry);
    const expired = Boolean(expiry && new Date(expiry).getTime() < Date.now());
    const active = Boolean(profile && (profile.plan === 'pro' || profile.plan === 'pro_plus' || profile.plan === 'paid' || profile.is_pro_member) && !expired);
    const planName = active && profile?.plan === 'pro_plus' ? 'Pro+' : active ? 'Pro' : 'Free';
    return { expiry, daysLeft, expired, active, planName };
  }, [profile]);

  const walletBalance = Math.max(0, Number(profile?.credit_balance) || 0);
  const canRenewFromWallet = walletBalance >= PRO_PRICE_USD;

  if (error === 'SETUP') {
    return (
      <DashboardShell>
        <h1 className="font-display text-2xl font-semibold mb-4">Billing &amp; Store</h1>
        <Card className="p-6 rounded-[20px]">
          <p className="text-sm text-kxmist leading-relaxed">
            Run <code className="text-white font-mono">supabase/migrations/008_billing_profile.sql</code> and{' '}
            <code className="text-white font-mono">009_charge_user.sql</code> in your Supabase SQL Editor to enable this.
          </p>
        </Card>
      </DashboardShell>
    );
  }

  const payWithPaystack = async () => {
    setProLoading(true);
    setProError('');
    try {
      window.location.href = await initializePaystackCheckout();
    } catch (err) {
      setProError(friendlyError(err));
      setProLoading(false);
    }
  };

  const payFromWallet = async () => {
    if (!canRenewFromWallet) return;
    if (!window.confirm('Renew Pro for $20.00 from your wallet? This will debit your wallet immediately.')) return;

    setWalletLoading(true);
    setWalletError('');
    try {
      await payProFromWallet(newIdempotencyKey());
      await refresh();
      await refreshTransactions();
    } catch (err) {
      setWalletError(friendlyError(err));
    } finally {
      setWalletLoading(false);
    }
  };

  const cancelPlan = async () => {
    if (!window.confirm('Cancel Pro at the end of the current paid period? You will keep Pro until the active expiry date.')) return;
    setPlanLoading(true);
    setPlanError('');
    try {
      await cancelProPlan();
      await refresh();
    } catch (err) {
      setPlanError(friendlyError(err));
    } finally {
      setPlanLoading(false);
    }
  };

  const resumePlan = async () => {
    setPlanLoading(true);
    setPlanError('');
    try {
      await resumeProPlan();
      await refresh();
    } catch (err) {
      setPlanError(friendlyError(err));
    } finally {
      setPlanLoading(false);
    }
  };

  const topUpWallet = async () => {
    const amount = customTopup ? Number(customTopup) : topupAmount;
    setTopupLoading(true);
    setTopupError('');
    try {
      window.location.href = await initializePaystackTopup(amount);
    } catch (err) {
      setTopupError(friendlyError(err));
      setTopupLoading(false);
    }
  };

  return (
    <DashboardShell>
      <h1 className="font-display text-2xl font-semibold mb-1">Billing &amp; Store</h1>
      <p className="text-kxmist text-sm mb-8">Manage your wallet, plan, and payment history.</p>

      {error && error !== 'SETUP' && (
        <p className="text-[12.5px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-5 break-words">{error}</p>
      )}

      {/* Balance overview */}
      <Card className="p-5 sm:p-6 rounded-[20px] mb-5">
        <div className="flex items-center gap-4 min-w-0">
          <span className="w-12 h-12 rounded-full bg-kx-gradient flex items-center justify-center shrink-0"><Wallet size={20} /></span>
          <div className="min-w-0">
            <p className="text-[12px] font-mono uppercase tracking-wider text-kxmist">Wallet balance</p>
            <p className="text-[12.5px] text-kxmist mb-1">Wallet balance. For compute and storage. You can also use it to renew Pro.</p>
            {profile ? <p className="font-display text-2xl font-semibold truncate">${walletBalance.toFixed(2)}</p> : <p className="text-sm text-kxmist">Loading…</p>}
          </div>
        </div>
        {profile && <div className="mt-4"><Badge tone={planInfo.active ? 'live' : 'default'}>{planInfo.planName} plan</Badge></div>}
      </Card>

      {/* Pro plan */}
      {profile && (
        <Card className="p-5 sm:p-6 rounded-[20px] mb-5">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h2 className="font-display text-[16px] font-medium mb-1">{planInfo.planName} plan</h2>
              {planInfo.active && planInfo.expiry && (
                <>
                  <p className="text-[13px] text-kxmist">Active until {new Date(planInfo.expiry).toLocaleDateString()}</p>
                  {planInfo.daysLeft !== null && (
                    <p className={`text-[13px] mt-1 ${planInfo.daysLeft <= 5 ? 'text-amber-300' : 'text-kxmist'}`}>
                      {planInfo.daysLeft <= 5 ? `Expires in ${planInfo.daysLeft} days` : `${planInfo.daysLeft} days left`}
                    </p>
                  )}
                </>
              )}
              {planInfo.expired && <p className="text-[13px] text-red-400">Expired. Renew to get Pro back.</p>}
              {!planInfo.active && !planInfo.expired && <p className="text-[13px] text-kxmist">Upgrade to Pro for $20/month.</p>}
              {profile.plan_cancel_at_period_end && planInfo.active && (
                <p className="text-[12px] text-amber-300 mt-1">Cancellation scheduled for the active expiry date.</p>
              )}
            </div>
            <span className="px-4 py-2 rounded-lg text-[13.5px] border border-kxblue bg-kxblue/10 text-kxblue font-medium shrink-0">
              $20/mo — Pro
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 mt-5">
            <Button variant="glow" className="min-h-[44px]" onClick={payWithPaystack} loading={proLoading}>
              {planInfo.active ? 'Renew (card)' : 'Pay $20 with card'} <ExternalLink size={13} />
            </Button>
            <Button
              variant="subtle"
              className="min-h-[44px]"
              onClick={payFromWallet}
              loading={walletLoading}
              disabled={!canRenewFromWallet}
            >
              {canRenewFromWallet ? 'Pay $20 from wallet' : 'Add funds to renew Pro'}
            </Button>
          </div>

          {planInfo.active && (
            <div className="flex gap-2 mt-4">
              {profile.plan_cancel_at_period_end ? (
                <Button variant="subtle" onClick={resumePlan} loading={planLoading}>Resume plan</Button>
              ) : (
                <Button variant="subtle" onClick={cancelPlan} loading={planLoading}>Cancel plan</Button>
              )}
            </div>
          )}

          {proError && <p className="text-[11.5px] text-red-400 mt-2 break-words">{proError}</p>}
          {walletError && <p className="text-[11.5px] text-red-400 mt-2 break-words">{walletError}</p>}
          {planError && <p className="text-[11.5px] text-red-400 mt-2 break-words">{planError}</p>}
        </Card>
      )}

      {/* Add funds */}
      <Card className="p-5 sm:p-6 rounded-[20px] mb-5">
        <h2 className="font-display text-[16px] font-medium mb-1">Add funds</h2>
        <p className="text-[13px] text-kxmist mb-4">Top up for compute and storage. Add funds to your wallet through Paystack — any amount from $5 to $500.</p>

        <div className="flex flex-wrap gap-2 mb-3">
          {TOPUP_PRESETS.map((amt) => (
            <button
              key={amt}
              onClick={() => { setTopupAmount(amt); setCustomTopup(''); }}
              className={`px-4 py-2 rounded-lg text-[13.5px] border ${topupAmount === amt && !customTopup ? 'border-kxblue bg-kxblue/10 text-kxblue' : 'border-white/10 bg-white/[0.02] text-kxmist'}`}
            >
              ${amt}
            </button>
          ))}
          <input
            type="number"
            min={5}
            max={500}
            placeholder="Custom"
            value={customTopup}
            onChange={(e) => setCustomTopup(e.target.value)}
            className="w-24 px-3 py-2 rounded-lg text-[13.5px] border border-white/10 bg-white/[0.02] outline-none focus:border-kxblue"
          />
        </div>

        <Button variant="subtle" onClick={topUpWallet} loading={topupLoading}>
          Pay ${customTopup || topupAmount} with Paystack <ExternalLink size={13} />
        </Button>
        {topupError && <p className="text-[12.5px] text-red-400 mt-3 break-words">{topupError}</p>}
      </Card>

      {/* Transaction history */}
      <Card className="p-5 sm:p-6 rounded-[20px] mb-5">
        <h2 className="font-display text-[16px] font-medium mb-1">Transaction history</h2>
        <p className="text-[13px] text-kxmist mb-5">Processed payment events and wallet activity.</p>
        {txns === null && <p className="text-sm text-kxmist">Loading…</p>}
        {txns !== null && (
          <ExpandableList
            items={txns}
            emptyLabel="No transactions yet."
            title="Transaction history — full list"
            renderItem={(t) => (
              <div key={t.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-[13px] border-b border-white/6 py-2.5 last:border-0">
                <div className="min-w-0">
                  <span className="font-medium capitalize">{t.gateway}</span>
                  <span className="text-kxmist"> · {t.raw_type}</span>
                </div>
                <div className="sm:text-right shrink-0">
                  <p className="font-mono">${Math.max(0, Number(t.amount_usd ?? 0) || 0).toFixed(2)}</p>
                  <p className="text-[11px] text-kxmistdim">{new Date(t.processed_at).toLocaleString()}</p>
                </div>
              </div>
            )}
          />
        )}
      </Card>
    </DashboardShell>
  );
}
