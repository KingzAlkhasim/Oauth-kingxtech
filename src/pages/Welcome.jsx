import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import DashboardShell from '../components/DashboardShell';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import { listProjects } from '../lib/projects';
import { supabase } from '../lib/supabase';
import { Card, Badge, Button } from '../components/ui';
import { ArrowUpRight, User, Settings as SettingsIcon, FolderKanban, Plus, ShieldAlert, X } from 'lucide-react';
import { redirectWithSession } from '../lib/ssoHandoff';

export default function Welcome() {
  useSeo({ title: 'Welcome — KingxTech', noindex: true });
  useRequireAuth();
  const [projects, setProjects] = useState(null);
  const [mfaEnabled, setMfaEnabled] = useState(null); // null = still checking
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    listProjects().then(({ data, error }) => setProjects(error ? [] : data.slice(0, 3)));
    supabase.auth.mfa.listFactors().then(({ data }) => {
      setMfaEnabled(!!data?.totp?.find((f) => f.status === 'verified'));
    });
  }, []);

  return (
    <DashboardShell>
      {mfaEnabled === false && !dismissed && (
        <div className="flex items-start gap-3 rounded-[20px] border border-amber-400/25 bg-amber-400/8 px-5 py-4 mb-8">
          <ShieldAlert size={18} className="text-amber-300 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-[13.5px] font-medium">Add two-factor authentication</p>
            <p className="text-[12.5px] text-kxmist mt-0.5">Your account doesn't have 2FA enabled yet — it takes under a minute in Settings → Security.</p>
          </div>
          <Link to="/settings" className="text-[13px] text-amber-300 hover:text-amber-200 shrink-0 mt-0.5">Enable now</Link>
          <button onClick={() => setDismissed(true)} className="text-kxmist hover:text-white shrink-0"><X size={15} /></button>
        </div>
      )}
      <div className="animate-fade-up">
        <span className="font-mono text-[11px] uppercase tracking-widest text-kxmist">Account created</span>
        <h1 className="font-display text-3xl font-semibold mt-2 mb-2">Welcome to KingxTech.</h1>
        <p className="text-kxmist max-w-lg">Your account is ready. Jump into a product, or finish setting up your developer profile.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-5 mt-10">
        <Card className="p-6 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg">K-XpertAI</h3>
            <Badge tone="live">Live</Badge>
          </div>
          <p className="text-[13.5px] text-kxmist leading-relaxed">Chat-first AI assistant with code generation and live artifacts.</p>
          <button
            onClick={() => redirectWithSession('kxpertai.kingxtech.name.ng')}
            className="inline-flex items-center gap-1.5 text-[13px] text-kxblue mt-1"
          >
            Open K-XpertAI <ArrowUpRight size={13} />
          </button>
        </Card>
        <Card className="p-6 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg">SynthCode IDE</h3>
            <Badge tone="beta">Early access</Badge>
          </div>
          <p className="text-[13.5px] text-kxmist leading-relaxed">AI-native code editor with live preview and inline assistance.</p>
          <button
            onClick={() => redirectWithSession('synthcode.kingxtech.name.ng')}
            className="inline-flex items-center gap-1.5 text-[13px] text-kxblue mt-1"
          >
            Open SynthCode <ArrowUpRight size={13} />
          </button>
        </Card>
      </div>

      <div className="grid sm:grid-cols-2 gap-5 mt-5">
        <Link to="/settings">
          <Card className="p-5 flex items-center gap-3 hover:border-white/25 transition-colors">
            <User size={18} className="text-kxpurple" />
            <div>
              <p className="text-sm font-medium">Developer profile</p>
              <p className="text-[12.5px] text-kxmist">Role, tech stack, experience level</p>
            </div>
          </Card>
        </Link>
        <Link to="/settings">
          <Card className="p-5 flex items-center gap-3 hover:border-white/25 transition-colors">
            <SettingsIcon size={18} className="text-kxblue" />
            <div>
              <p className="text-sm font-medium">Account settings</p>
              <p className="text-[12.5px] text-kxmist">Security, sessions, API keys</p>
            </div>
          </Card>
        </Link>
      </div>

      <div className="flex items-center justify-between mt-12 mb-4">
        <h2 className="font-display text-lg font-medium">Your projects</h2>
        <Link to="/projects" className="text-[13px] text-kxblue">View all</Link>
      </div>

      {projects === null && <p className="text-sm text-kxmist">Loading…</p>}

      {projects !== null && projects.length === 0 && (
        <Card className="p-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <FolderKanban size={18} className="text-kxmist" />
            <p className="text-[13.5px] text-kxmist">Nothing tracked yet across the ecosystem.</p>
          </div>
          <Link to="/projects"><Button variant="subtle"><Plus size={14} /> Add project</Button></Link>
        </Card>
      )}

      {projects !== null && projects.length > 0 && (
        <div className="grid sm:grid-cols-3 gap-4">
          {projects.map((p) => (
            <Link to="/projects" key={p.id}>
              <Card className="p-5 flex flex-col gap-2 hover:border-white/25 transition-colors">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-mono text-kxmist">{p.product}</span>
                  <Badge tone={p.status === 'active' ? 'live' : p.status === 'paused' ? 'beta' : 'default'}>{p.status}</Badge>
                </div>
                <p className="text-sm font-medium">{p.name}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </DashboardShell>
  );
}
