import { useEffect, useState } from 'react';
import DashboardShell from '../components/DashboardShell';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import useCurrentUser from '../lib/useCurrentUser';
import {
  getBillingProfile,
  CHECKOUT_LINKS,
  checkoutUrlWithUser,
  initializePaystackCheckout,
  initializePaystackTopup,
  convertToCredits,
} from '../lib/billing';
import { getCredits } from '../lib/aiUsage';
import { supabase } from '../lib/supabase';
import { Card, Button, Badge, ExpandableList } from '../components/ui';
import { Wallet, Zap, Server, Database as DatabaseIcon, Lock, ExternalLink } from 'lucide-react';

const TOPUP_PRESETS = [5, 10, 25, 50];
const CONVERT_PRESETS = [1, 5, 10];
const CREDITS_PER_USD = 100;
const PRO_PRICE_USD = 20;

export default function Billing() {
  useSeo({ title: 'Billing & Store — KingxTech', noindex: true });
  useRequireAuth();
  const { user } = useCurrentUser();

  const [profile, setProfile] = useState(null);
  const [credits, setCredits] = useState(null);
  const [error, setError] = useState('');
  const [txns, setTxns] = useState(null);

  const [proLoading, setProLoading] = useState(false);
  const [proError, setProError] = useState('');

  const [topupAmount, setTopupAmount] = useState(10);
  const [customTopup, setCustomTopup] = useState('');
  const [topupLoading, setTopupLoading] = useState(false);
  const [topupError, setTopupError] = useState('');

  const [convertAmount, setConvertAmount] = useState(1);
  const [customConvert, setCustomConvert] = useState('');
  const [convertLoading, setConvertLoading] = useState(false);
  const [convertError, setConvertError] = useState('');

  const refresh = async () => {
    const { data, error: fetchError } = await getBillingProfile();
    if (fetchError) { setError(/relation .*billing_profile.* does not exist/i.test(fetchError.message) ? 'SETUP' : fetchError.message); return; }
    setProfile(data);
    getCredits().then(setCredits).catch(() => {});
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

  const lemonUrl = checkoutUrlWithUser(CHECKOUT_LINKS.lemonsqueezy, user?.id, user?.email);

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

  const buyCredits = async () => {
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

  const convert = async () => {
    const amount = customConvert ? Number(customConvert) : convertAmount;
    setConvertLoading(true);
    setConvertError('');
    try {
      await convertToCredits(amount);
      await refresh();
    } catch (err) {
      setConvertError(err.message);
    } finally {
      setConvertLoading(false);
    }
  };

  return (
    <DashboardShell>
      <h1 className="font-display text-2xl font-semibold mb-1">Billing &amp; Store</h1>
      <p className="text-kxmist text-sm mb-8">Real balances, real payments, and where to spend both — nothing here is a sample number.</p>

      {error && error !== 'SETUP' && (
        <p className="text-[12.5px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-5 break-words">{error}</p>
      )}

      {/* Balance overview */}
      <Card className="p-5 sm:p-6 rounded-[20px] mb-5">
        <div className="grid sm:grid-cols-2 gap-6">
          <div className="flex items-center gap-4 min-w-0">
            <span className="w-12 h-12 rounded-full bg-kx-gradient flex items-center justify-center shrink-0"><Wallet size={20} /></span>
            <div className="min-w-0">
              <p className="text-[12px] font-mono uppercase tracking-wider text-kxmist">Wallet balance</p>
              {profile ? <p className="font-display text-2xl font-semibold truncate">${profile.credit_balance.toFixed(2)}</p> : <p className="text-sm text-kxmist">Loading…</p>}
            </div>
          </div>
          <div className="flex items-center gap-4 min-w-0">
            <span className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center shrink-0"><Zap size={20} /></span>
            <div className="min-w-0">
              <p className="text-[12px] font-mono uppercase tracking-wider text-kxmist">AI credits</p>
              {credits ? (
                <p className="font-display text-2xl font-semibold truncate">
                  {credits.remaining} <span className="text-kxmist text-base font-normal">/ {credits.allowance} free + {credits.purchased} bought</span>
                </p>
              ) : <p className="text-sm text-kxmist">Loading…</p>}
            </div>
          </div>
        </div>
        {profile && (
          <div className="mt-4">
            <Badge tone={profile.is_pro_member ? 'live' : 'default'}>{profile.is_pro_member ? 'Pro member' : 'Free plan'}</Badge>
          </div>
        )}
      </Card>

      {/* Buy AI credits with wallet balance — the actual "how do I buy credit" answer */}
      <Card className="p-5 sm:p-6 rounded-[20px] mb-5">
        <h2 className="font-display text-[16px] font-medium mb-1">Buy AI credits</h2>
        <p className="text-[13px] text-kxmist mb-4">
          Spend your wallet balance on AI credits — $1 = {CREDITS_PER_USD} credits. These never expire or reset, unlike your monthly free allowance.
        </p>

        <div className="flex flex-wrap gap-2 mb-3">
          {CONVERT_PRESETS.map((amt) => (
            <button
              key={amt}
              onClick={() => { setConvertAmount(amt); setCustomConvert(''); }}
              className={`px-4 py-2 rounded-lg text-[13.5px] border ${convertAmount === amt && !customConvert ? 'border-kxblue bg-kxblue/10 text-kxblue' : 'border-white/10 bg-white/[0.02] text-kxmist'}`}
            >
              ${amt} → {amt * CREDITS_PER_USD}cr
            </button>
          ))}
          <input
            type="number"
            min={1}
            placeholder="Custom $"
            value={customConvert}
            onChange={(e) => setCustomConvert(e.target.value)}
            className="w-28 px-3 py-2 rounded-lg text-[13.5px] border border-white/10 bg-white/[0.02] outline-none focus:border-kxblue"
          />
        </div>

        <Button variant="glow" onClick={convert} loading={convertLoading} disabled={!profile || profile.credit_balance < (customConvert || convertAmount)}>
          Convert ${customConvert || convertAmount} to {(customConvert || convertAmount) * CREDITS_PER_USD} credits
        </Button>
        {profile && profile.credit_balance < (customConvert || convertAmount) && (
          <p className="text-[12px] text-kxmist mt-2">Not enough wallet balance — add funds below first.</p>
        )}
        {convertError && <p className="text-[12.5px] text-red-400 mt-3 break-words">{convertError}</p>}
      </Card>

      {/* Go Pro — styled as a highlighted price pill to match the preset-button
          look used elsewhere on this page, since $20/mo is a fixed price, not
          an arbitrary amount like the top-up/convert sections above. */}
      {profile && !profile.is_pro_member && (
        <Card className="p-5 sm:p-6 rounded-[20px] mb-5">
          <h2 className="font-display text-[16px] font-medium mb-1">Go Pro</h2>
          <p className="text-[13px] text-kxmist mb-4">Unlocks premium models (Claude Opus, GPT-5.6, Gemini Pro) and SecureCheck. Credited the moment a real payment confirms via webhook.</p>

          <div className="flex flex-wrap gap-2 mb-4">
            <span className="px-4 py-2 rounded-lg text-[13.5px] border border-kxblue bg-kxblue/10 text-kxblue font-medium">
              ${PRO_PRICE_USD}/mo — Pro
            </span>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
              <p className="text-[13.5px] font-medium mb-2">Global (card)</p>
              {lemonUrl ? (
                <a href={lemonUrl} target="_blank" rel="noreferrer">
                  <Button variant="glow" className="w-full">Pay with LemonSqueezy <ExternalLink size={13} /></Button>
                </a>
              ) : (
                <p className="text-[12.5px] text-kxmist flex items-start gap-2"><Lock size={13} className="mt-0.5 shrink-0" /> <span className="break-words">Not configured — set <code className="text-white font-mono">VITE_LEMONSQUEEZY_CHECKOUT_URL</code> to enable.</span></p>
              )}
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
              <p className="text-[13.5px] font-medium mb-2">Local (Africa)</p>
              <Button variant="subtle" className="w-full" onClick={payWithPaystack} loading={proLoading}>
                Pay with Paystack <ExternalLink size={13} />
              </Button>
              {proError && <p className="text-[11.5px] text-red-400 mt-2 break-words">{proError}</p>}
            </div>
          </div>
        </Card>
      )}

      {/* Add funds */}
      <Card className="p-5 sm:p-6 rounded-[20px] mb-5">
        <h2 className="font-display text-[16px] font-medium mb-1">Add funds</h2>
        <p className="text-[13px] text-kxmist mb-4">Top up your wallet balance directly via Paystack — any amount from $5 to $500. Spend it above on AI credits, or save it for Pro.</p>

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

        <Button variant="subtle" onClick={buyCredits} loading={topupLoading}>
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
                  <p className="font-mono">${Number(t.amount_usd ?? 0).toFixed(2)}</p>
                  <p className="text-[11px] text-kxmistdim">{new Date(t.processed_at).toLocaleString()}</p>
                </div>
              </div>
            )}
          />
        )}
      </Card>

      {/* Spend categories */}
      <Card className="p-5 sm:p-6 rounded-[20px] mb-5">
        <h2 className="font-display text-[16px] font-medium mb-1">Spend your credits on</h2>
        <p className="text-[13px] text-kxmist mb-5">What's real today, and what's coming to KX Cloud.</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 min-w-0">
            <p className="text-[13.5px] font-medium mb-1 flex items-center gap-2"><Zap size={14} className="shrink-0" /> AI usage</p>
            <p className="text-[12.5px] text-kxmist">Every K-XpertAI chat turn draws from your credits above — live today.</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 min-w-0">
            <p className="text-[13.5px] font-medium mb-1 flex items-center gap-2"><DatabaseIcon size={14} className="shrink-0" /> Database &amp; Env Vars</p>
            <p className="text-[12.5px] text-kxmist">Real, working today in Console → KX Cloud — usage limits tied to your plan are coming soon.</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 opacity-60 min-w-0">
            <p className="text-[13.5px] font-medium mb-1 flex items-center gap-2"><Server size={14} className="shrink-0" /> Compute instances <Lock size={12} className="shrink-0" /></p>
            <p className="text-[12.5px] text-kxmist">Coming soon — real backend + cloud-provider wiring isn't built yet.</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 opacity-60 min-w-0">
            <p className="text-[13.5px] font-medium mb-1 flex items-center gap-2"><Server size={14} className="shrink-0" /> Storage &amp; Traffic <Lock size={12} className="shrink-0" /></p>
            <p className="text-[12.5px] text-kxmist">Coming soon — same as Compute, no backend behind these yet.</p>
          </div>
        </div>
      </Card>

      {/* How crediting works */}
      <Card className="p-5 sm:p-6 rounded-[20px]">
        <h2 className="font-display text-[16px] font-medium mb-4">How crediting works</h2>
        <ul className="flex flex-col gap-2.5 text-[13px] text-kxmist">
          <li>1. You pay through a real gateway checkout — this app never touches your card details.</li>
          <li>2. The gateway calls the <code className="text-white font-mono">billing-webhook</code> Edge Function with a signed payload.</li>
          <li>3. The function verifies the signature, converts local currency to USD if needed, and credits your wallet — once, even if the gateway retries.</li>
          <li>4. Wallet funds convert to AI credits above at a fixed rate, or go toward Pro. Paid actions deduct from credits via a database-level gate — insufficient funds blocks the action outright.</li>
        </ul>
      </Card>
    </DashboardShell>
  );
}