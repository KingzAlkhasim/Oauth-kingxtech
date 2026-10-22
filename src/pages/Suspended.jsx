import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, Download, LifeBuoy, LogOut } from 'lucide-react';
import { Card, Button } from '../components/ui';
import Logo from '../components/Logo';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import { supabase } from '../lib/supabase';
import { getMyAccountStatus, requestDataExport } from '../lib/account';
import { friendlyError } from '../lib/errors';

export default function Suspended() {
  useSeo({ title: 'Account suspended — KingxTech', noindex: true });
  const session = useRequireAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState('');

  useEffect(() => {
    if (!session) return;
    getMyAccountStatus().then((s) => {
      if (!s.suspended) navigate('/welcome', { replace: true });
      else setStatus(s);
    });
  }, [session, navigate]);

  const prepare = async () => {
    setBusy(true); setError(''); setLink('');
    try {
      const result = await requestDataExport();
      setLink(result.url);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => { await supabase.auth.signOut(); navigate('/login'); };

  if (!status) return null;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <Card className="w-full max-w-lg p-6 sm:p-8 rounded-[20px] flex flex-col gap-5">
        <Logo />
        <div className="flex items-center gap-3">
          <Ban size={22} className="text-red-400 shrink-0" />
          <h1 className="font-display text-2xl">Account suspended</h1>
        </div>
        <p className="text-[14px] text-kxmist leading-relaxed">
          Your account has been suspended, so projects, AI and published sites are turned off.
          {status.reason ? ' Reason given:' : ''}
        </p>
        {status.reason && (
          <p className="rounded-lg border border-red-500/20 bg-red-500/5 px-3.5 py-2.5 text-[13.5px] break-words">{status.reason}</p>
        )}

        <div className="flex flex-col gap-2">
          <h2 className="text-[14px] font-semibold flex items-center gap-2"><LifeBuoy size={15} /> Contact support</h2>
          <p className="text-[13px] text-kxmist leading-relaxed">
            Email <a className="text-kxblue underline" href="mailto:hello@kingxtech.name.ng">hello@kingxtech.name.ng</a>, or open a ticket from the <a className="text-kxblue underline" href="/help">Help page</a>.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-[14px] font-semibold flex items-center gap-2"><Download size={15} /> Download your information</h2>
          <p className="text-[13px] text-kxmist leading-relaxed">
            We'll prepare one zip with all your projects. Each project's code is its own zip inside it. Environment variables and secrets are not included.
          </p>
          <Button variant="glow" className="self-start" onClick={prepare} loading={busy} disabled={busy}>
            {busy ? 'Preparing…' : 'Prepare my download'}
          </Button>
          {link && (
            <a href={link} className="inline-flex items-center gap-2 min-h-11 text-[13.5px] text-emerald-300 underline">
              <Download size={14} /> Your zip is ready. Tap to download (link works for 1 hour)
            </a>
          )}
          {error && <p className="text-[12.5px] text-red-400">{error}</p>}
        </div>

        <button type="button" onClick={signOut} className="min-h-11 self-start inline-flex items-center gap-2 text-[13px] text-kxmist hover:text-white">
          <LogOut size={14} /> Sign out
        </button>
      </Card>
    </div>
  );
}
