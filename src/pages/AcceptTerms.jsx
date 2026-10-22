import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScrollText } from 'lucide-react';
import { Card, Button } from '../components/ui';
import Logo from '../components/Logo';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import { hasAcceptedCurrentTerms, acceptCurrentTerms } from '../lib/account';
import { TERMS_PATH } from '../lib/terms';
import { supabase } from '../lib/supabase';
import { friendlyError } from '../lib/errors';

export default function AcceptTerms() {
  useSeo({ title: 'Terms of Service — KingxTech', noindex: true });
  const session = useRequireAuth();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session) return;
    hasAcceptedCurrentTerms().then((ok) => {
      if (ok) navigate('/welcome', { replace: true });
      else setReady(true);
    });
  }, [session, navigate]);

  const proceed = async () => {
    setBusy(true); setError('');
    const { error: e } = await acceptCurrentTerms();
    setBusy(false);
    if (e) { setError(friendlyError(e)); return; }
    navigate('/welcome', { replace: true });
  };

  if (!ready) return null;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <Card className="w-full max-w-lg p-6 sm:p-8 rounded-[20px] flex flex-col gap-5">
        <Logo />
        <div className="flex items-center gap-3">
          <ScrollText size={22} className="text-kxpurple shrink-0" />
          <h1 className="font-display text-2xl">Our Terms of Service</h1>
        </div>
        <p className="text-[14px] text-kxmist leading-relaxed">
          We have written down the rules for using KingxTech, including what you can and cannot build with the AI tools and published sites. Please read them and accept to keep using your account. Your projects are safe and nothing changes until you continue.
        </p>
        <a href={TERMS_PATH} target="_blank" rel="noreferrer" className="min-h-11 inline-flex items-center text-[14px] text-kxblue underline">
          Read the Terms of Service
        </a>
        <label className="flex items-start gap-3 text-[13.5px] cursor-pointer select-none min-h-11">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-1 h-4 w-4 shrink-0" />
          <span>I have read and agree to the Terms of Service.</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="glow" onClick={proceed} loading={busy} disabled={busy || !checked}>Accept and continue</Button>
          <button type="button" onClick={() => supabase.auth.signOut().then(() => navigate('/login', { replace: true }))} className="min-h-11 px-2 text-[13px] text-kxmist hover:text-white">Sign out</button>
        </div>
        {error && <p className="text-[12.5px] text-red-400">{error}</p>}
      </Card>
    </div>
  );
}
