import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plug, Check, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import useSeo from '../lib/useSeo';
import { Card, Button, SkeletonLines } from '../components/ui';
import { friendlyError } from '../lib/errors';
import {
  getAuthorizationDetails, approveAuthorization, denyAuthorization, CONNECTOR_CAN, CONNECTOR_CANNOT,
} from '../lib/connectedApps';

// Where Supabase's OAuth server sends people to approve an AI app (Authentication > OAuth Server > Authorization Path).
export default function OAuthConsent() {
  useSeo({ title: 'Connect an AI app — KingxTech', noindex: true });
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const authorizationId = params.get('authorization_id');
  const [details, setDetails] = useState(undefined); // undefined = loading
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!authorizationId) { setError('This approval link is missing its request id. Start the connection again from the AI app.'); setDetails(null); return; }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate(`/login?redirect=${encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`)}`, { replace: true });
        return;
      }
      const { data, error: e } = await getAuthorizationDetails(authorizationId);
      if (cancelled) return;
      if (e || !data) { setError(friendlyError(e) || 'This request has expired. Start the connection again from the AI app.'); setDetails(null); return; }
      // Already approved earlier: Supabase hands back the final address straight away.
      if (data.redirect_url) { window.location.assign(data.redirect_url); return; }
      setDetails(data);
    })();
    return () => { cancelled = true; };
  }, [authorizationId, navigate]);

  const decide = async (approve) => {
    setBusy(approve ? 'approve' : 'deny'); setError('');
    const { data, error: e } = await (approve ? approveAuthorization(authorizationId) : denyAuthorization(authorizationId));
    if (e || !data?.redirect_url) { setBusy(''); setError(friendlyError(e) || 'Could not finish. Start the connection again from the AI app.'); return; }
    window.location.assign(data.redirect_url);
  };

  let host = '';
  try { host = details?.redirect_uri ? new URL(details.redirect_uri).host : ''; } catch { host = details?.redirect_uri || ''; }

  return (
    <main className="min-h-screen grid place-items-center px-4 py-10 bg-kxink text-white">
      <Card className="w-full max-w-md p-5 sm:p-7 rounded-[22px]">
        <div className="flex items-center gap-2.5 mb-4">
          <Plug size={18} className="text-kxpurple" />
          <h1 className="font-display text-xl">Connect an AI app</h1>
        </div>
        {details === undefined && !error && <SkeletonLines lines={4} label="Loading request" />}
        {error && <p role="alert" className="text-[13px] text-red-400 mb-3 leading-relaxed">{error}</p>}
        {details && (
          <div className="flex flex-col gap-4">
            <p className="text-[14px] leading-relaxed">
              <strong>{details.client?.name || 'An app'}</strong> wants to use your KingxTech account{details.user?.email ? <> (<span className="text-kxmist">{details.user.email}</span>)</> : null}.
            </p>
            <p className="text-[12.5px] text-kxmist leading-relaxed">
              It will return to <code className="text-white break-all">{host}</code>. Only approve if you just started this connection from Claude, ChatGPT or another app you trust.
            </p>
            <div>
              <p className="text-[13px] font-medium mb-1.5">It will be able to</p>
              <ul className="flex flex-col gap-1.5">{CONNECTOR_CAN.map((t) => <li key={t} className="flex gap-2 text-[13px] text-kxmist"><Check size={14} className="mt-0.5 shrink-0 text-emerald-400" />{t}</li>)}</ul>
            </div>
            <div>
              <p className="text-[13px] font-medium mb-1.5">It will not be able to</p>
              <ul className="flex flex-col gap-1.5">{CONNECTOR_CANNOT.map((t) => <li key={t} className="flex gap-2 text-[13px] text-kxmist"><X size={14} className="mt-0.5 shrink-0 text-red-400" />{t}</li>)}</ul>
            </div>
            <p className="text-[12px] text-kxmist leading-relaxed">You can remove access any time in Account &gt; Connected apps. File changes can be undone from restore points.</p>
            <div className="flex gap-2.5">
              <Button variant="glow" className="flex-1" onClick={() => decide(true)} loading={busy === 'approve'} disabled={!!busy}>Approve</Button>
              <Button variant="subtle" className="flex-1" onClick={() => decide(false)} loading={busy === 'deny'} disabled={!!busy}>Cancel</Button>
            </div>
          </div>
        )}
      </Card>
    </main>
  );
}
