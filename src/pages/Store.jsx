import { useEffect, useState } from 'react';
import DashboardShell from '../components/DashboardShell';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import { getBillingProfile, initializePaystackCheckout, initializePaystackTopup } from '../lib/billing';
import { Card, Button, Badge } from '../components/ui';
import { Wallet, ExternalLink } from 'lucide-react';
import { friendlyError } from '../lib/errors';

const TOPUP_PRESETS = [5, 10, 25, 50];

export default function Store() {
  useSeo({ title: 'Store — KingxTech', noindex: true });
  useRequireAuth();

  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');

  const [proLoading, setProLoading] = useState(false);
  const [proError, setProError] = useState('');

  const [topupAmount, setTopupAmount] = useState(10);
  const [customAmount, setCustomAmount] = useState('');
  const [topupLoading, setTopupLoading] = useState(false);
  const [topupError, setTopupError] = useState('');

  const refresh = async () => {
    const { data, error: profileErr } = await getBillingProfile();
    if (profileErr) { setError(friendlyError(profileErr)); return; }
    setProfile(data);
  };

  useEffect(() => { refresh(); }, []);

  const goPro = async () => {
    setProLoading(true);
    setProError('');
    try {
      window.location.href = await initializePaystackCheckout();
    } catch (err) {
      setProError(friendlyError(err));
      setProLoading(false);
    }
  };

  const topUpWallet = async () => {
    const amount = customAmount ? Number(customAmount) : topupAmount;
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
      <h1 className="font-display text-2xl font-semibold mb-1">Store</h1>
      <p className="text-kxmist text-sm mb-8">Manage your wallet and plan for compute and storage.</p>

      {error && <p className="text-[12.5px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-5">{error}</p>}

      {/* Balance overview */}
      <Card className="p-6 rounded-[20px] mb-5">
        <div className="flex items-center gap-4">
          <span className="w-12 h-12 rounded-full bg-kx-gradient flex items-center justify-center shrink-0"><Wallet size={20} /></span>
          <div className="min-w-0">
            <p className="text-[12px] font-mono uppercase tracking-wider text-kxmist">Wallet balance</p>
            <p className="text-[12.5px] text-kxmist mb-1">Wallet balance. For compute and storage.</p>
            {profile ? <p className="font-display text-2xl font-semibold">${Math.max(0, Number(profile.credit_balance) || 0).toFixed(2)}</p> : <p className="text-sm text-kxmist">Loading…</p>}
          </div>
        </div>
        {profile && <div className="mt-4"><Badge tone={profile.is_pro_member ? 'live' : 'default'}>{profile.is_pro_member ? 'Pro member' : 'Free plan'}</Badge></div>}
      </Card>

      {/* Pro upsell */}
      {profile && !profile.is_pro_member && (
        <Card className="p-6 rounded-[20px] mb-5">
          <h2 className="font-display text-[16px] font-medium mb-1">Go Pro — $20/month</h2>
          <p className="text-[13px] text-kxmist mb-4">Unlock premium models and SecureCheck. Pro activates after Paystack confirms your payment.</p>
          <Button variant="glow" onClick={goPro} loading={proLoading}>Upgrade to Pro <ExternalLink size={13} /></Button>
          {proError && <p className="text-[12.5px] text-red-400 mt-3">{proError}</p>}
        </Card>
      )}

      {/* Add funds */}
      <Card className="p-6 rounded-[20px] mb-5">
        <h2 className="font-display text-[16px] font-medium mb-1">Add funds</h2>
        <p className="text-[13px] text-kxmist mb-4">Top up for compute and storage. Add funds through Paystack — any amount from $5 to $500.</p>

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

        <Button variant="subtle" onClick={topUpWallet} loading={topupLoading}>
          Pay ${customAmount || topupAmount} with Paystack <ExternalLink size={13} />
        </Button>
        {topupError && <p className="text-[12.5px] text-red-400 mt-3">{topupError}</p>}
      </Card>

    </DashboardShell>
  );
}