import { useEffect, useState } from 'react';
import DashboardShell from '../components/DashboardShell';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import { getBillingProfile, initializePaystackCheckout, initializePaystackTopup } from '../lib/billing';
import { getCredits } from '../lib/aiUsage';
import { Card, Button, Badge } from '../components/ui';
import { Wallet, Zap, Server, Database as DatabaseIcon, Lock, ExternalLink } from 'lucide-react';

const TOPUP_PRESETS = [5, 10, 25, 50];

export default function Store() {
  useSeo({ title: 'Store — KingxTech', noindex: true });
  useRequireAuth();

  const [profile, setProfile] = useState(null);
  const [credits, setCredits] = useState(null);
  const [error, setError] = useState('');

  const [proLoading, setProLoading] = useState(false);
  const [proError, setProError] = useState('');

  const [topupAmount, setTopupAmount] = useState(10);
  const [customAmount, setCustomAmount] = useState('');
  const [topupLoading, setTopupLoading] = useState(false);
  const [topupError, setTopupError] = useState('');

  const refresh = async () => {
    const { data, error: profileErr } = await getBillingProfile();
    if (profileErr) { setError(profileErr.message); return; }
    setProfile(data);
    getCredits().then(setCredits).catch((e) => setError(e.message));
  };

  useEffect(() => { refresh(); }, []);

  const goPro = async () => {
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
    const amount = customAmount ? Number(customAmount) : topupAmount;
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
      <h1 className="font-display text-2xl font-semibold mb-1">Store</h1>
      <p className="text-kxmist text-sm mb-8">Buy credits, go Pro, and see what's coming next for KX Cloud.</p>

      {error && <p className="text-[12.5px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-5">{error}</p>}

      {/* Balance overview */}
      <Card className="p-6 rounded-[20px] mb-5">
        <div className="grid sm:grid-cols-2 gap-6">
          <div className="flex items-center gap-4">
            <span className="w-12 h-12 rounded-full bg-kx-gradient flex items-center justify-center shrink-0"><Wallet size={20} /></span>
            <div>
              <p className="text-[12px] font-mono uppercase tracking-wider text-kxmist">Wallet balance</p>
              {profile ? <p className="font-display text-2xl font-semibold">${profile.credit_balance.toFixed(2)}</p> : <p className="text-sm text-kxmist">Loading…</p>}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center shrink-0"><Zap size={20} /></span>
            <div>
              <p className="text-[12px] font-mono uppercase tracking-wider text-kxmist">AI credits this month</p>
              {credits ? <p className="font-display text-2xl font-semibold">{credits.remaining} <span className="text-kxmist text-base font-normal">/ {credits.allowance}</span></p> : <p className="text-sm text-kxmist">Loading…</p>}
            </div>
          </div>
        </div>
        {profile && (
          <div className="mt-4">
            <Badge tone={profile.is_pro_member ? 'live' : 'default'}>{profile.is_pro_member ? 'Pro member' : 'Free plan'}</Badge>
          </div>
        )}
      </Card>

      {/* Pro upsell */}
      {profile && !profile.is_pro_member && (
        <Card className="p-6 rounded-[20px] mb-5">
          <h2 className="font-display text-[16px] font-medium mb-1">Go Pro — $20/month</h2>
          <p className="text-[13px] text-kxmist mb-4">Unlocks premium models (Claude Opus, GPT-5.6, Gemini Pro) and SecureCheck. Credited the moment a real payment confirms via webhook.</p>
          <Button variant="glow" onClick={goPro} loading={proLoading}>Upgrade to Pro <ExternalLink size={13} /></Button>
          {proError && <p className="text-[12.5px] text-red-400 mt-3">{proError}</p>}
        </Card>
      )}

      {/* Buy credits */}
      <Card className="p-6 rounded-[20px] mb-5">
        <h2 className="font-display text-[16px] font-medium mb-1">Buy credits</h2>
        <p className="text-[13px] text-kxmist mb-4">Top up your wallet balance directly — same secure Paystack checkout as Pro, any amount from $5 to $500.</p>

        <div className="flex flex-wrap gap-2 mb-3">
          {TOPUP_PRESETS.map((amt) => (
            <button
              key={amt}
              onClick={() => { setTopupAmount(amt); setCustomAmount(''); }}
              className={`px-4 py-2 rounded-lg text-[13.5px] border ${topupAmount === amt && !customAmount ? 'border-kxblue bg-kxblue/10 text-kxblue' : 'border-white/10 bg-white/[0.02] text-kxmist'}`}
            >
              ${amt}
            </button>
          ))}
          <input
            type="number"
            min={5}
            max={500}
            placeholder="Custom"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            className="w-24 px-3 py-2 rounded-lg text-[13.5px] border border-white/10 bg-white/[0.02] outline-none focus:border-kxblue"
          />
        </div>

        <Button variant="subtle" onClick={buyCredits} loading={topupLoading}>
          Pay ${customAmount || topupAmount} with Paystack <ExternalLink size={13} />
        </Button>
        {topupError && <p className="text-[12.5px] text-red-400 mt-3">{topupError}</p>}
      </Card>

      {/* KX Cloud spend categories */}
      <Card className="p-6 rounded-[20px]">
        <h2 className="font-display text-[16px] font-medium mb-1">Spend your credits on</h2>
        <p className="text-[13px] text-kxmist mb-5">What's real today, and what's coming to KX Cloud.</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <p className="text-[13.5px] font-medium mb-1 flex items-center gap-2"><Zap size={14} /> AI usage</p>
            <p className="text-[12.5px] text-kxmist">Every K-XpertAI chat turn already draws from your monthly credit pool above — this is live today.</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <p className="text-[13.5px] font-medium mb-1 flex items-center gap-2"><DatabaseIcon size={14} /> Database &amp; Env Vars</p>
            <p className="text-[12.5px] text-kxmist">Real, working today in Console → KX Cloud — usage limits tied to your plan are coming soon.</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 opacity-60">
            <p className="text-[13.5px] font-medium mb-1 flex items-center gap-2"><Server size={14} /> Compute instances <Lock size={12} /></p>
            <p className="text-[12.5px] text-kxmist">Coming soon — real backend + cloud-provider wiring isn't built yet.</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 opacity-60">
            <p className="text-[13.5px] font-medium mb-1 flex items-center gap-2"><Server size={14} /> Storage &amp; Traffic <Lock size={12} /></p>
            <p className="text-[12.5px] text-kxmist">Coming soon — same as Compute, no backend behind these yet.</p>
          </div>
        </div>
      </Card>
    </DashboardShell>
  );
}