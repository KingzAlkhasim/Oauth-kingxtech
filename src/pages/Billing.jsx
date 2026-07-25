import { useEffect, useState } from 'react';
import DashboardShell from '../components/DashboardShell';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import useCurrentUser from '../lib/useCurrentUser';
import { getBillingProfile, CHECKOUT_LINKS, checkoutUrlWithUser, initializePaystackCheckout } from '../lib/billing';
import { supabase } from '../lib/supabase';
import { Card, Button, Badge } from '../components/ui';
import { Wallet, Lock, ExternalLink } from 'lucide-react';

export default function Billing() {
  useSeo({ title: 'Billing & Wallet — KingxTech', noindex: true });
  useRequireAuth();
  const { user } = useCurrentUser();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [txns, setTxns] = useState(null);
  const [paystackLoading, setPaystackLoading] = useState(false);
  const [paystackError, setPaystackError] = useState('');

  const payWithPaystack = async () => {
    setPaystackLoading(true);
    setPaystackError('');
    try {
      const url = await initializePaystackCheckout();
      window.location.href = url;
    } catch (err) {
      setPaystackError(err.message);
    } finally {
      setPaystackLoading(false);
    }
  };

  const refresh = async () => {
    const { data, error: fetchError } = await getBillingProfile();
    if (fetchError) { setError(/relation .*billing_profile.* does not exist/i.test(fetchError.message) ? 'SETUP' : fetchError.message); return; }
    setProfile(data);
  };

  useEffect(() => {
    refresh();
    supabase.from('billing_events').select('*').order('processed_at', { ascending: false }).limit(20)
      .then(({ data, error: e }) => setTxns(e ? [] : data));
  }, []);

  if (error === 'SETUP') {
    return (
      <DashboardShell>
        <h1 className="font-display text-2xl font-semibold mb-4">Billing &amp; Wallet</h1>
        <Card className="p-6 rounded-[20px]">
          <p className="text-sm text-kxmist leading-relaxed">
            Run <code className="text-white font-mono">supabase/migrations/008_billing_profile.sql</code> and{' '}
            <code className="text-white font-mono">009_charge_user.sql</code> in your Supabase SQL Editor to enable this.
          </p>
        </Card>
      </DashboardShell>
    );
  }

  const lemonUrl = checkoutUrlWithUser(CHECKOUT_LINKS.lemonsqueezy, user?.id, user?.email);

  return (
    <DashboardShell>
      <h1 className="font-display text-2xl font-semibold mb-1">Billing &amp; Wallet</h1>
      <p className="text-kxmist text-sm mb-8">Real balance from your account — nothing here is a sample number.</p>

      {error && error !== 'SETUP' && (
        <p className="text-[12.5px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-5">{error}</p>
      )}

      <Card className="p-6 rounded-[20px] mb-5">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <span className="w-12 h-12 rounded-full bg-kx-gradient flex items-center justify-center shrink-0">
              <Wallet size={20} />
            </span>
            <div>
              <p className="text-[12px] font-mono uppercase tracking-wider text-kxmist">Credit balance</p>
              {profile ? (
                <p className="font-display text-2xl font-semibold">${profile.credit_balance.toFixed(2)}</p>
              ) : (
                <p className="text-sm text-kxmist">Loading…</p>
              )}
            </div>
          </div>
          {profile && <Badge tone={profile.is_pro_member ? 'live' : 'default'}>{profile.is_pro_member ? 'Pro member' : 'Free plan'}</Badge>}
        </div>
      </Card>

      <Card className="p-6 rounded-[20px] mb-5">
        <h2 className="font-display text-[16px] font-medium mb-1">Top up</h2>
        <p className="text-[13px] text-kxmist mb-5">Pro Plan — $20/month, credited to your wallet the moment a real payment confirms via webhook.</p>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <p className="text-[13.5px] font-medium mb-2">Global (card)</p>
            {lemonUrl ? (
              <a href={lemonUrl} target="_blank" rel="noreferrer">
                <Button variant="glow" className="w-full">Pay with LemonSqueezy <ExternalLink size={13} /></Button>
              </a>
            ) : (
              <p className="text-[12.5px] text-kxmist flex items-start gap-2"><Lock size={13} className="mt-0.5 shrink-0" /> Not configured — set <code className="text-white font-mono">VITE_LEMONSQUEEZY_CHECKOUT_URL</code> to enable.</p>
            )}
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <p className="text-[13.5px] font-medium mb-2">Local (Africa)</p>
            <Button variant="subtle" className="w-full" onClick={payWithPaystack} loading={paystackLoading}>
              Pay with Paystack <ExternalLink size={13} />
            </Button>
            {paystackError && <p className="text-[11.5px] text-red-400 mt-2">{paystackError}</p>}
          </div>
        </div>
      </Card>

      <Card className="p-6 rounded-[20px] mb-5">
        <h2 className="font-display text-[16px] font-medium mb-1">Transaction history</h2>
        <p className="text-[13px] text-kxmist mb-5">Real, processed webhook events — empty until a real payment confirms.</p>
        {txns === null && <p className="text-sm text-kxmist">Loading…</p>}
        {txns !== null && txns.length === 0 && <p className="text-[13px] text-kxmist">No transactions yet.</p>}
        {txns !== null && txns.length > 0 && (
          <div className="flex flex-col gap-2">
            {txns.map((t) => (
              <div key={t.id} className="flex items-center justify-between text-[13px] border-b border-white/6 py-2.5 last:border-0">
                <div>
                  <span className="font-medium capitalize">{t.gateway}</span>
                  <span className="text-kxmist"> · {t.raw_type}</span>
                </div>
                <div className="text-right">
                  <p className="font-mono">${Number(t.amount_usd ?? 0).toFixed(2)}</p>
                  <p className="text-[11px] text-kxmistdim">{new Date(t.processed_at).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-6 rounded-[20px]">
        <h2 className="font-display text-[16px] font-medium mb-4">How crediting works</h2>
        <ul className="flex flex-col gap-2.5 text-[13px] text-kxmist">
          <li>1. You pay through a real gateway checkout — this app never touches your card details.</li>
          <li>2. The gateway calls the <code className="text-white font-mono">billing-webhook</code> Edge Function with a signed payload.</li>
          <li>3. The function verifies the signature, converts local currency to USD if needed, and credits your wallet — once, even if the gateway retries.</li>
          <li>4. Paid actions (K-XpertAI, SynthCode) deduct from this balance via a database-level credit gate — insufficient funds blocks the action outright.</li>
        </ul>
      </Card>
    </DashboardShell>
  );
}
