import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { Card, Button } from '../components/ui';
import Logo from '../components/Logo';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import { getMyAccountStatus, acknowledgeRestoration } from '../lib/account';
import { TERMS_PATH } from '../lib/terms';

export default function Restored() {
  useSeo({ title: 'Account restored — KingxTech', noindex: true });
  const session = useRequireAuth();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session) return;
    getMyAccountStatus().then((s) => {
      if (s.suspended) navigate('/suspended', { replace: true });
      else if (!s.restoredNotice) navigate('/welcome', { replace: true });
      else setReady(true);
    });
  }, [session, navigate]);

  const proceed = async () => {
    setBusy(true); setError('');
    const { error: e } = await acknowledgeRestoration();
    setBusy(false);
    if (e) { setError(e.message); return; }
    navigate('/welcome', { replace: true });
  };

  if (!ready) return null;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <Card className="w-full max-w-lg p-6 sm:p-8 rounded-[20px] flex flex-col gap-5">
        <Logo />
        <div className="flex items-center gap-3">
          <CheckCircle2 size={22} className="text-emerald-300 shrink-0" />
          <h1 className="font-display text-2xl">Your account has been restored</h1>
        </div>
        <p className="text-[14px] text-kxmist leading-relaxed">
          Your projects, AI and published sites are available again. Please read our Terms of Service so you know the rules, especially the acceptable use section, before you continue.
        </p>
        <a href={TERMS_PATH} target="_blank" rel="noreferrer" className="min-h-11 inline-flex items-center text-[14px] text-kxblue underline">
          Read the Terms of Service
        </a>
        <Button variant="glow" className="self-start" onClick={proceed} loading={busy} disabled={busy}>
          I have read the Terms, continue
        </Button>
        {error && <p className="text-[12.5px] text-red-400">{error}</p>}
      </Card>
    </div>
  );
}
