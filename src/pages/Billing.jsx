import { useEffect, useState } from 'react';
import DashboardShell from '../components/DashboardShell';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import {
  getBillingProfile,
  initializePaystackCheckout,
  initializePaystackTopup,
} from '../lib/billing';
import { supabase } from '../lib/supabase';
import { Card, Button, Badge, ExpandableList } from '../components/ui';
import { Wallet, ExternalLink } from 'lucide-react';

const TOPUP_PRESETS = [5, 10, 25, 50];
const PRO_PRICE_USD = 20;

export default function Billing() {
  useSeo({ title: 'Billing & Store — KingxTech', noindex: true });
  useRequireAuth();

  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [txns, setTxns] = useState(null);

  const [proLoading, setProLoading] = useState(false);
  const [proError, setProError] = useState('');

  const [topupAmount, setTopupAmount] = useState(10);
  const [customTopup, setCustomTopup] = useState('');
  const [topupLoading, setTopupLoading] = useState(false);
  const [topupError, setTopupError] = useState('');


  const refresh = async () => {
    const { data, error: fetchError } = await getBillingProfile();
    if (fetchError) { setError(/relation .*billing_profile.* does not exist/i.test(fetchError.message) ? 'SETUP' : fetchError.message); return; }
    setProfile(data);
  };

  useEffect(() => {
    refresh();
    supabase.from('billing_events').select('*').order('processed_at', { ascending: false }).limit(50)
      .then(({ data, error: e }) => setTxns(e ? [] : data));
  }, []);

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
      setProError(err.message);
      setProLoading(false);
    }
  };

  const topUpWallet = async () => {
    const amount = customTopup ? Number(customTopup) : topupAmount;
    setTopupLoading(true);
    setTopupError('');
    try {
      window.location.href = await initializePaystackTopup(amount);
    } catch (err) {
      setTopupError(err.message);
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
            <p className="text-[12.5px] text-kxmist mb-1">Wallet balance. For compute and storage.</p>
            {profile ? <p className="font-display text-2xl font-semibold truncate">${Math.max(0, Number(profile.credit_balance) || 0).toFixed(2)}</p> : <p className="text-sm text-kxmist">Loading…</p>}
          </div>
        </div>
        {profile && <div className="mt-4"><Badge tone={profile.is_pro_member ? 'live' : 'default'}>{profile.is_pro_member ? 'Pro member' : 'Free plan'}</Badge></div>}
      </Card>

      {/* Go Pro — styled as a highlighted price pill to match the preset-button
          look used elsewhere on this page, since $20/mo is a fixed price, not
          an arbitrary amount like the wallet top-up below. */}
      {profile && !profile.is_pro_member && (
        <Card className="p-5 sm:p-6 rounded-[20px] mb-5">
          <h2 className="font-display text-[16px] font-medium mb-1">Go Pro</h2>
          <p className="text-[13px] text-kxmist mb-4">Unlocks premium models and SecureCheck. Pro activates after Paystack confirms your payment.</p>

          <div className="flex flex-wrap gap-2 mb-4">
            <span className="px-4 py-2 rounded-lg text-[13.5px] border border-kxblue bg-kxblue/10 text-kxblue font-medium">
              ${PRO_PRICE_USD}/mo — Pro
            </span>
          </div>

          <Button variant="glow" className="w-full sm:w-auto min-h-[44px]" onClick={payWithPaystack} loading={proLoading}>Pay with Paystack <ExternalLink size={13} /></Button>
          {proError && <p className="text-[11.5px] text-red-400 mt-2 break-words">{proError}</p>}
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
        <p className="text-[13px] text-kxmist mb-5">Real, processed webhook events — empty until a real payment confirms.</p>
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