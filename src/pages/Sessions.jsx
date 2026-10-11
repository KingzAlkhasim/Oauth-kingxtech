import { useState } from 'react';
import DashboardShell from '../components/DashboardShell';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import { Card, Badge, Button } from '../components/ui';
import { supabase } from '../lib/supabase';
import { Laptop } from 'lucide-react';

function detectDevice() {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Unknown browser';
  return `${os} · ${browser}`;
}

export default function Sessions() {
  useSeo({ title: 'Sessions & devices — KingxTech', noindex: true });
  useRequireAuth();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const signOutOthers = async () => {
    setError(''); setNotice(''); setBusy(true);
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'others' });
    setBusy(false);
    if (signOutError) { setError(signOutError.message); return; }
    setNotice('Signed out of all other sessions.');
  };

  return (
    <DashboardShell>
      <h1 className="font-display text-2xl font-semibold mb-2">Sessions &amp; devices</h1>
      <p className="text-kxmist mb-8 max-w-lg">
        Supabase's client SDK can end other sessions, but can't list them individually — that needs a backend to track logins per device.
      </p>

      {error && <p className="text-[12.5px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-5">{error}</p>}
      {notice && <p className="text-[12.5px] text-emerald-300 bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-3 py-2 mb-5">{notice}</p>}

      <Card className="p-6 rounded-[20px]">
        <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3.5 mb-5">
          <div className="flex items-center gap-3">
            <Laptop size={18} className="text-kxmist" />
            <div>
              <p className="text-sm font-medium flex items-center gap-2">{detectDevice()} <Badge tone="live">This device</Badge></p>
              <p className="text-[12.5px] text-kxmist">Detected from your browser — location isn't tracked</p>
            </div>
          </div>
        </div>
        <Button variant="subtle" onClick={signOutOthers} loading={busy}>Sign out of all other sessions</Button>
      </Card>
    </DashboardShell>
  );
}
