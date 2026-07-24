import { useEffect, useState } from 'react';
import DashboardShell from '../components/DashboardShell';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import useCurrentUser from '../lib/useCurrentUser';
import { supabase } from '../lib/supabase';
import { Card, Button, Input, Badge } from '../components/ui';
import { listApiKeys, createApiKey, revokeApiKey, deleteApiKey } from '../lib/apiKeys';
import { listWebhooks, createWebhook, toggleWebhook, deleteWebhook, WEBHOOK_EVENTS } from '../lib/webhooks';
import { listTickets, createTicket, TICKET_CATEGORIES } from '../lib/tickets';
import { getLinkedIdentities, findIdentity, linkProvider, unlinkProvider } from '../lib/identities';
import { getCommunityStats } from '../lib/community';
import { runReadonlyQuery, KNOWN_TABLES } from '../lib/database';
import { listUsage, totalUsage } from '../lib/usage';
import { getCredits, getUsageLog } from '../lib/aiUsage';
import { listProjects } from '../lib/projects';
import {
  githubStatus, saveGithubToken, removeGithubToken, listGithubRepos,
  linkProjectRepo, getProjectRepoLink,
} from '../lib/github';
import { listEnvVars, upsertEnvVar, deleteEnvVar } from '../lib/envVars';
import { logActivity } from '../lib/activity';
import {
  FlaskConical, Plug, LifeBuoy, Trophy, Cloud,
  Plus, Copy, Trash2, Check, X, Lock, Server, Database, Activity,
  TerminalSquare, Table2, Play, KeyRound,
} from 'lucide-react';

function GithubIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2.1c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.4-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2A11 11 0 0112 5.8c1 0 2 .1 3 .4 2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.9 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A11.5 11.5 0 0023.5 12C23.5 5.7 18.3.5 12 .5z" /></svg>
  );
}

const TABS = [
  { id: 'ailab', label: 'AI Lab', icon: FlaskConical },
  { id: 'integrations', label: 'Credentials', icon: Plug },
  { id: 'support', label: 'Support', icon: LifeBuoy },
  { id: 'community', label: 'Community', icon: Trophy },
  { id: 'cloud', label: 'KX Cloud', icon: Cloud },
];

export default function Console() {
  useSeo({ title: 'Console — KingxTech', noindex: true });
  useRequireAuth();
  const [tab, setTab] = useState('ailab');

  return (
    <DashboardShell>
      <h1 className="font-display text-2xl font-semibold mb-1">Console</h1>
      <p className="text-kxmist text-sm mb-8">AI configuration, integrations, support, and cloud resources.</p>

      <div className="flex gap-2 mb-8 overflow-x-auto rounded-[20px] border border-white/8 bg-white/[0.015] p-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-2xl text-[13px] whitespace-nowrap transition-colors ${
              tab === id ? 'bg-white/8 text-white' : 'text-kxmist hover:text-white hover:bg-white/[0.03]'
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      <div className="animate-fade-up">
        {tab === 'ailab' && <AiLabTab />}
        {tab === 'integrations' && <IntegrationsTab />}
        {tab === 'support' && <SupportTab />}
        {tab === 'community' && <CommunityTab />}
        {tab === 'cloud' && <CloudConsoleTab />}
      </div>
    </DashboardShell>
  );
}

function Section({ title, desc, children, unavailable }) {
  return (
    <Card className="p-6 mb-5 rounded-[20px]">
      <div className="flex items-center gap-2.5 mb-1">
        <h2 className="font-display text-[16px] font-medium">{title}</h2>
        {unavailable && <Badge>Not available yet</Badge>}
      </div>
      {desc && <p className="text-[13px] text-kxmist mb-5">{desc}</p>}
      {children}
    </Card>
  );
}

function Notice({ error, notice }) {
  if (!error && !notice) return null;
  return (
    <p className={`text-[12.5px] rounded-lg px-3 py-2 mb-4 border ${
      error ? 'text-red-400 bg-red-400/10 border-red-400/20' : 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20'
    }`}>
      {error || notice}
    </p>
  );
}

function Fact({ label, value, good }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
      <span className="text-[13px] text-kxmist">{label}</span>
      <span className={`text-[13px] font-medium ${good === true ? 'text-emerald-300' : good === false ? 'text-kxmist' : ''}`}>{value}</span>
    </div>
  );
}

/* ================= Tab 1: AI Lab ================= */

function AiLabTab() {
  return (
    <>
      <ApiKeyVault />
      <KxpertCreditsTab />
      <UsageTab />
      <ModelRouter />
    </>
  );
}

function GithubPushTab() {
  const [connected, setConnected] = useState(null);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [repos, setRepos] = useState(null);
  const [projects, setProjects] = useState(null);
  const [links, setLinks] = useState({}); // { [projectId]: {repo_full_name, branch} | null }
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      const isConnected = await githubStatus();
      setConnected(isConnected);
      if (isConnected) {
        const [repoList, { data: projectRows }] = await Promise.all([listGithubRepos(), listProjects()]);
        setRepos(repoList);
        setProjects(projectRows || []);
        const linkEntries = await Promise.all(
          (projectRows || []).map(async (p) => [p.id, await getProjectRepoLink(p.id).catch(() => null)])
        );
        setLinks(Object.fromEntries(linkEntries));
      }
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { refresh(); }, []);

  const connect = async () => {
    if (!token.trim()) return;
    setSaving(true); setError('');
    try {
      await saveGithubToken(token.trim());
      setToken('');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    if (!confirm('Remove your GitHub token? Linked projects will keep their repo mapping but pushes will fail until you reconnect.')) return;
    try {
      await removeGithubToken();
      setConnected(false);
      setRepos(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const setLink = async (projectId, repoFullName, branch) => {
    try {
      await linkProjectRepo(projectId, repoFullName, branch);
      setLinks((l) => ({ ...l, [projectId]: { repo_full_name: repoFullName, branch } }));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Section
      title="GitHub"
      desc="Push a project's files to a GitHub repo you control. Uses a Personal Access Token you provide — create one at github.com/settings/tokens with 'repo' scope. Treat it like a .env value, not a secrets vault, same as the rest of KX Cloud."
    >
      <Notice error={error} />

      {connected === null && <p className="text-[13px] text-kxmist">Loading…</p>}

      {connected === false && (
        <div className="flex items-end gap-3 flex-wrap">
          <Input
            label="Personal Access Token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_…"
            containerClassName="flex-1"
          />
          <Button variant="glow" onClick={connect} loading={saving} disabled={!token.trim()}>Connect</Button>
        </div>
      )}

      {connected === true && (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-[13px] text-emerald-300">Connected</p>
            <button onClick={disconnect} className="text-[13px] text-red-400 hover:text-red-300">Disconnect</button>
          </div>

          {projects !== null && projects.length === 0 && (
            <p className="text-[13px] text-kxmist">No projects yet — create one first, then come back here to link it to a repo.</p>
          )}

          <div className="flex flex-col gap-2.5">
            {projects?.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 flex-wrap">
                <span className="text-[13px] font-medium">{p.name}</span>
                <select
                  className="bg-black/30 border border-white/12 rounded-lg px-2.5 py-1.5 text-[12.5px] text-kxmist"
                  value={links[p.id]?.repo_full_name || ''}
                  onChange={(e) => e.target.value && setLink(p.id, e.target.value, repos.find((r) => r.full_name === e.target.value)?.default_branch || 'main')}
                >
                  <option value="">Not linked</option>
                  {repos?.map((r) => (
                    <option key={r.full_name} value={r.full_name}>{r.full_name}{r.private ? ' (private)' : ''}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <p className="text-[11.5px] text-kxmist mt-3">
            Push each project from its Workspace page (Terminal tab → "Push to GitHub"), once linked here.
          </p>
        </>
      )}
    </Section>
  );
}

function KxpertCreditsTab() {
  const [credits, setCredits] = useState(null);
  const [log, setLog] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getCredits().then(setCredits).catch((e) => setError(e.message));
    getUsageLog(20).then(setLog).catch(() => {});
  }, []);

  const used = credits ? credits.allowance - credits.remaining : 0;
  const pct = credits ? Math.min(100, Math.round((used / credits.allowance) * 100)) : 0;

  return (
    <Section
      title="K-XpertAI credits"
      desc="Free monthly allowance for chatting with K-XpertAI across every model. Resets automatically at the start of each month; premium models (Claude, GPT, Gemini Pro) cost more credits per message than the free Gemini Flash tier."
    >
      <Notice error={error} />
      {credits && (
        <>
          <div className="flex items-center justify-between mb-2 text-[13px]">
            <span className="text-kxmist">{used} / {credits.allowance} credits used this month</span>
            <span className="font-mono text-white">{credits.remaining} left</span>
          </div>
          <div className="w-full h-2 rounded-full bg-white/8 overflow-hidden mb-5">
            <div
              className="h-full bg-kx-gradient transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </>
      )}

      {log !== null && log.length === 0 && <p className="text-[13px] text-kxmist">No K-XpertAI usage recorded yet.</p>}
      {log !== null && log.length > 0 && (
        <div className="flex flex-col gap-2">
          {log.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between text-[13px] text-kxmist border-b border-white/6 py-2 last:border-0">
              <span>{new Date(entry.created_at).toLocaleString()}</span>
              <span className="capitalize">{entry.provider} · {entry.model_code}</span>
              <span className="font-mono">{entry.credit_cost} credit{entry.credit_cost !== 1 ? 's' : ''}</span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function UsageTab() {
  const [total, setTotal] = useState(null);
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    totalUsage().then(({ total, count, error: e }) => {
      if (e) { setError(/relation .*usage_log.* does not exist/i.test(e.message) ? 'SETUP' : e.message); return; }
      setTotal({ total, count });
    });
    listUsage(10).then(({ data, error: e }) => { if (!e) setEntries(data); });
  }, []);

  if (error === 'SETUP') {
    return (
      <Section title="Usage" unavailable>
        <p className="text-[13px] text-kxmist">
          Run <code className="text-white font-mono">supabase/migrations/012_usage_log.sql</code> in your Supabase SQL Editor to enable this.
        </p>
      </Section>
    );
  }

  return (
    <Section title="Usage" desc="Real spend from actual charge_user() calls. A fresh account shows zero — there's nothing to fabricate until something real happens.">
      <Notice error={error && error !== 'SETUP' ? error : ''} />
      <div className="flex items-center gap-8 mb-5">
        <div>
          <p className="text-[12px] font-mono uppercase tracking-wider text-kxmist mb-1">Total spent</p>
          <p className="font-display text-xl font-semibold">${(total?.total ?? 0).toFixed(2)}</p>
        </div>
        <div>
          <p className="text-[12px] font-mono uppercase tracking-wider text-kxmist mb-1">Charged actions</p>
          <p className="font-display text-xl font-semibold">{total?.count ?? 0}</p>
        </div>
      </div>
      {entries !== null && entries.length === 0 && <p className="text-[13px] text-kxmist">No usage recorded yet.</p>}
      {entries !== null && entries.length > 0 && (
        <div className="flex flex-col gap-2">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between text-[13px] text-kxmist border-b border-white/6 py-2 last:border-0">
              <span>{new Date(e.created_at).toLocaleString()}</span>
              <span className="font-mono">${Number(e.cost).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function ApiKeyVault() {
  const [keys, setKeys] = useState(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState(null);

  const needsSetup = (e) => /relation .*api_keys.* does not exist/i.test(e.message || '');

  const refresh = async () => {
    const { data, error: listError } = await listApiKeys();
    if (listError) { setError(needsSetup(listError) ? 'SETUP' : listError.message); return; }
    setKeys(data);
  };
  useEffect(() => { refresh(); }, []);

  const create = async () => {
    setError(''); setCreating(true);
    const { data, error: createError } = await createApiKey({ name: newName || 'Untitled key' });
    setCreating(false);
    if (createError) { setError(createError.message); return; }
    setRevealed({ name: data.name, fullKey: data.fullKey });
    setNewName(''); setShowForm(false);
    logActivity('API key created', data.name);
    refresh();
  };

  const revoke = async (id, name) => { await revokeApiKey(id); logActivity('API key revoked', name); refresh(); };
  const remove = async (id) => { if (confirm('Delete this key permanently?')) { await deleteApiKey(id); refresh(); } };

  if (error === 'SETUP') {
    return (
      <Section title="API Key Vault" unavailable>
        <p className="text-[13px] text-kxmist">
          Run <code className="text-white font-mono">supabase/migrations/003_api_keys.sql</code> in your Supabase SQL Editor to enable this.
        </p>
      </Section>
    );
  }

  return (
    <Section
      title="API Key Vault"
      desc="Generate, reveal once, and revoke scoped API keys. Note: no live KingxTech API validates these yet — this is the vault, ready for when it does."
    >
      <Notice error={error && error !== 'SETUP' ? error : ''} />

      {revealed && (
        <div className="mb-5 rounded-lg border border-kxblue/30 bg-kxblue/10 p-4">
          <p className="text-[13px] font-medium mb-2">Copy your key now — it won't be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[12.5px] font-mono bg-black/30 rounded px-2.5 py-2 break-all">{revealed.fullKey}</code>
            <button
              onClick={() => navigator.clipboard.writeText(revealed.fullKey)}
              className="shrink-0 w-9 h-9 rounded-lg border border-white/15 flex items-center justify-center hover:bg-white/5"
            >
              <Copy size={14} />
            </button>
          </div>
          <button onClick={() => setRevealed(null)} className="text-[12.5px] text-kxmist hover:text-white mt-3">Done, hide this</button>
        </div>
      )}

      {keys === null && <p className="text-sm text-kxmist">Loading…</p>}

      {keys !== null && (
        <div className="flex flex-col gap-2.5 mb-5">
          {keys.length === 0 && <p className="text-[13px] text-kxmist">No keys yet — generate one below.</p>}
          {keys.map((k) => (
            <div key={k.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3.5">
              <div>
                <p className="text-sm font-medium flex items-center gap-2">
                  {k.name}
                  {k.revoked_at ? <Badge>Revoked</Badge> : <Badge tone="live">{k.environment}</Badge>}
                </p>
                <p className="text-[12.5px] font-mono text-kxmist">{k.key_prefix}•••• · Created {new Date(k.created_at).toLocaleDateString()}</p>
              </div>
              <div className="flex items-center gap-3 text-kxmist">
                {!k.revoked_at && <button onClick={() => revoke(k.id, k.name)} className="text-[12.5px] hover:text-white">Revoke</button>}
                <button onClick={() => remove(k.id)} className="hover:text-red-400"><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm ? (
        <div className="flex items-end gap-3">
          <Input label="Key name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Production" containerClassName="flex-1" />
          <Button variant="glow" onClick={create} loading={creating}>Generate</Button>
          <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
        </div>
      ) : (
        <Button variant="subtle" onClick={() => setShowForm(true)}><Plus size={14} /> Generate new key</Button>
      )}
    </Section>
  );
}

function ModelRouter() {
  const { user } = useCurrentUser();
  const [pref, setPref] = useState('auto');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (user) setPref(user.user_metadata?.model_router_preference || 'auto');
  }, [user]);

  const options = [
    { id: 'auto', label: 'Auto-Route', desc: 'Best model per request' },
    { id: 'neurocore', label: 'NeuroCore Pro', desc: "KingxTech's fine-tuned model" },
    { id: 'opensource', label: 'Open-Source Pool', desc: 'Free-tier community models' },
  ];

  const save = async (id) => {
    setPref(id); setSaving(true); setNotice('');
    const { error } = await supabase.auth.updateUser({ data: { model_router_preference: id } });
    setSaving(false);
    if (!error) setNotice('Preference saved.');
  };

  return (
    <Section title="Model Router" desc="Default backend routing preference for K-XpertAI, once it's live. This choice is saved to your account for real.">
      <Notice notice={notice} />
      <div className="grid sm:grid-cols-3 gap-3">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => save(o.id)}
            disabled={saving}
            className={`text-left rounded-lg border px-4 py-3 transition-colors ${
              pref === o.id ? 'border-kxblue bg-kxblue/10' : 'border-white/10 bg-white/[0.02] hover:border-white/25'
            }`}
          >
            <p className="text-[13.5px] font-medium flex items-center gap-2">{o.label} {pref === o.id && <Check size={13} className="text-kxblue" />}</p>
            <p className="text-[12px] text-kxmist mt-0.5">{o.desc}</p>
          </button>
        ))}
      </div>
    </Section>
  );
}

/* ================= Tab 2: Credentials & Integrations ================= */

function IntegrationsTab() {
  return (
    <>
      <OAuthLinkers />
      <GithubPushTab />
      <WebhookManager />
      <Section title="IDE Sync" unavailable desc="Plugin authentication status for SynthCode IDE.">
        <div className="flex items-center gap-3 rounded-lg border border-white/8 bg-white/[0.015] px-4 py-4 text-kxmist">
          <Lock size={16} />
          <p className="text-[13px]">SynthCode IDE isn't available yet, so there's no plugin to sync with.</p>
        </div>
      </Section>
    </>
  );
}

function OAuthLinkers() {
  const [identities, setIdentities] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const refresh = async () => {
    const { data, error: idError } = await getLinkedIdentities();
    if (idError) { setError(idError.message); return; }
    setIdentities(data.identities);
  };
  useEffect(() => { refresh(); }, []);

  const connect = async (provider) => {
    setError(''); setBusy(provider);
    const { error: linkError } = await linkProvider(provider, 'https://auth.kingxtech.name.ng/console');
    setBusy('');
    if (linkError) setError(`${linkError.message} (enable "manual linking" + the ${provider} provider in Supabase → Authentication)`);
  };

  const disconnect = async (identity) => {
    setError(''); setBusy(identity.provider);
    const { error: unlinkError } = await unlinkProvider(identity);
    setBusy('');
    if (unlinkError) { setError(unlinkError.message); return; }
    refresh();
  };

  const github = identities ? findIdentity(identities, 'github') : null;

  return (
    <Section title="Connected Accounts" desc="Single sign-on identities linked to your KingxTech account.">
      <Notice error={error} />
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3.5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-kx-gradient flex items-center justify-center">
              <Check size={15} />
            </div>
            <div>
              <p className="text-sm font-medium">KingxTech Auth</p>
              <p className="text-[12.5px] text-emerald-300">Connected — this is your identity provider</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3.5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full border border-white/15 flex items-center justify-center">
              <GithubIcon size={16} />
            </div>
            <div>
              <p className="text-sm font-medium">GitHub</p>
              <p className="text-[12.5px] text-kxmist">{github ? `Connected as ${github.identity_data?.user_name || github.identity_data?.email || 'linked account'}` : 'Not connected'}</p>
            </div>
          </div>
          {github ? (
            <button onClick={() => disconnect(github)} disabled={busy === 'github'} className="text-[13px] text-red-400 hover:text-red-300 disabled:opacity-50">Disconnect</button>
          ) : (
            <Button variant="subtle" onClick={() => connect('github')} loading={busy === 'github'}>Connect</Button>
          )}
        </div>
      </div>
    </Section>
  );
}

function WebhookManager() {
  const [hooks, setHooks] = useState(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState([]);
  const [saving, setSaving] = useState(false);

  const needsSetup = (e) => /relation .*webhooks.* does not exist/i.test(e.message || '');

  const refresh = async () => {
    const { data, error: listError } = await listWebhooks();
    if (listError) { setError(needsSetup(listError) ? 'SETUP' : listError.message); return; }
    setHooks(data);
  };
  useEffect(() => { refresh(); }, []);

  const toggleEvent = (e) => setEvents((cur) => cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]);

  const create = async () => {
    setError(''); setSaving(true);
    const { error: createError } = await createWebhook({ url, events });
    setSaving(false);
    if (createError) { setError(createError.message); return; }
    logActivity('Webhook added', url);
    setUrl(''); setEvents([]); setShowForm(false);
    refresh();
  };

  const toggle = async (hook) => { await toggleWebhook(hook.id, !hook.active); refresh(); };
  const remove = async (id, url) => { if (confirm('Delete this webhook?')) { await deleteWebhook(id); logActivity('Webhook removed', url); refresh(); } };

  if (error === 'SETUP') {
    return (
      <Section title="Webhook Manager" unavailable>
        <p className="text-[13px] text-kxmist">
          Run <code className="text-white font-mono">supabase/migrations/004_webhooks.sql</code> in your Supabase SQL Editor to enable this.
        </p>
      </Section>
    );
  }

  return (
    <Section title="Webhook Manager" desc="Outbound event triggers. Configuration is real and saved — delivery history isn't available yet since nothing dispatches these events yet.">
      <Notice error={error && error !== 'SETUP' ? error : ''} />

      <div className="flex flex-col gap-2.5 mb-5">
        {hooks === null && <p className="text-sm text-kxmist">Loading…</p>}
        {hooks !== null && hooks.length === 0 && <p className="text-[13px] text-kxmist">No webhooks configured.</p>}
        {hooks?.map((h) => (
          <div key={h.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-sm font-mono truncate max-w-xs">{h.url}</p>
              <p className="text-[12px] text-kxmist">{h.events.join(', ') || 'No events selected'}</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button onClick={() => toggle(h)} className={`text-[12.5px] ${h.active ? 'text-emerald-300' : 'text-kxmist'}`}>{h.active ? 'Active' : 'Paused'}</button>
              <button onClick={() => remove(h.id, h.url)} className="text-kxmist hover:text-red-400"><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
      </div>

      {showForm ? (
        <div className="flex flex-col gap-4">
          <Input label="Payload URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourapp.com/webhooks/kingxtech" />
          <div>
            <span className="block text-[13px] font-medium text-white/85 mb-2">Events</span>
            <div className="flex flex-wrap gap-2">
              {WEBHOOK_EVENTS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => toggleEvent(e)}
                  className={`text-[12.5px] font-mono px-3 py-1.5 rounded-full border ${
                    events.includes(e) ? 'border-kxpurple bg-kxpurple/15 text-white' : 'border-white/12 text-kxmist'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="glow" onClick={create} loading={saving} disabled={!url}>Save webhook</Button>
            <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button variant="subtle" onClick={() => setShowForm(true)}><Plus size={14} /> Add webhook</Button>
      )}
    </Section>
  );
}

/* ================= Tab 3: Support & Tickets ================= */

function SupportTab() {
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('Bug');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const needsSetup = (e) => /relation .*support_tickets.* does not exist/i.test(e.message || '');

  const refresh = async () => {
    const { data, error: listError } = await listTickets();
    if (listError) { setError(needsSetup(listError) ? 'SETUP' : listError.message); return; }
    setTickets(data);
  };
  useEffect(() => { refresh(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setNotice(''); setSaving(true);
    const { error: createError } = await createTicket({ category, subject, message });
    setSaving(false);
    if (createError) { setError(createError.message); return; }
    logActivity('Support ticket submitted', subject);
    setSubject(''); setMessage('');
    setNotice('Ticket submitted.');
    refresh();
  };

  if (error === 'SETUP') {
    return (
      <Section title="Support & Tickets" unavailable>
        <p className="text-[13px] text-kxmist">
          Run <code className="text-white font-mono">supabase/migrations/005_support_tickets.sql</code> in your Supabase SQL Editor to enable this.
        </p>
      </Section>
    );
  }

  return (
    <>
      <Section title="New ticket">
        <Notice error={error && error !== 'SETUP' ? error : ''} notice={notice} />
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="block">
            <span className="block text-[13px] font-medium text-white/85 mb-1.5">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-lg border border-white/12 bg-white/[0.02] px-3.5 py-2.5 text-sm outline-none focus:border-kxblue">
              {TICKET_CATEGORIES.map((c) => <option key={c} value={c} className="bg-kxsurface">{c}</option>)}
            </select>
          </label>
          <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} required />
          <label className="block">
            <span className="block text-[13px] font-medium text-white/85 mb-1.5">Message</span>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} required className="w-full rounded-lg border border-white/12 bg-white/[0.02] px-3.5 py-2.5 text-sm outline-none focus:border-kxblue resize-none" />
          </label>
          <Button type="submit" variant="glow" className="self-start" loading={saving}>Submit ticket</Button>
        </form>
      </Section>

      <Section title="Your tickets">
        {tickets === null && <p className="text-sm text-kxmist">Loading…</p>}
        {tickets !== null && tickets.length === 0 && <p className="text-[13px] text-kxmist">No tickets yet.</p>}
        <div className="flex flex-col gap-2.5">
          {tickets?.map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3.5">
              <div>
                <p className="text-sm font-medium">{t.subject}</p>
                <p className="text-[12px] text-kxmist">{t.category} · {new Date(t.created_at).toLocaleDateString()}</p>
              </div>
              <Badge tone={t.status === 'open' ? 'beta' : 'default'}>{t.status.replace('_', ' ')}</Badge>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Live transcript viewer" unavailable desc="Rendered history of resolved support chats.">
        <div className="flex items-center gap-3 rounded-lg border border-white/8 bg-white/[0.015] px-4 py-4 text-kxmist">
          <Lock size={16} />
          <p className="text-[13px]">There's no live chat support system yet, so there's nothing to transcribe.</p>
        </div>
      </Section>
    </>
  );
}

/* ================= Tab 4: Community Profile ================= */

function CommunityTab() {
  const [stats, setStats] = useState(null);
  const [identities, setIdentities] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const s = await getCommunityStats();
    setStats(s);
    const { data } = await getLinkedIdentities();
    setIdentities(data?.identities || []);
  };
  useEffect(() => { refresh(); }, []);

  const discord = identities ? findIdentity(identities, 'discord') : null;

  const connectDiscord = async () => {
    setError(''); setBusy(true);
    const { error: linkError } = await linkProvider('discord', 'https://auth.kingxtech.name.ng/console');
    setBusy(false);
    if (linkError) setError(`${linkError.message} (enable "manual linking" + Discord provider in Supabase → Authentication)`);
  };

  const disconnectDiscord = async () => {
    setBusy(true);
    await unlinkProvider(discord);
    setBusy(false);
    refresh();
  };

  if (!stats) return <Section title="Community"><p className="text-sm text-kxmist">Loading…</p></Section>;

  return (
    <>
      <Section title="Your ecosystem profile" desc="Plain facts from your account — no invented scoring.">
        <div className="grid sm:grid-cols-2 gap-3">
          <Fact label="Account created" value={stats.accountCreated.toLocaleDateString()} />
          <Fact label="Email confirmed" value={stats.emailConfirmed ? 'Yes' : 'No'} good={stats.emailConfirmed} />
          <Fact label="Two-factor authentication" value={stats.mfaEnabled ? 'Enabled' : 'Disabled'} good={stats.mfaEnabled} />
          <Fact label="Developer profile" value={stats.profileComplete ? 'Complete' : 'Incomplete'} good={stats.profileComplete} />
          <Fact label="Projects tracked" value={String(stats.projectCount)} good={stats.projectCount > 0} />
        </div>
      </Section>

      <Section title="Badges">
        <div className="grid sm:grid-cols-3 gap-3">
          {stats.badges.map((b) => (
            <div key={b.id} className={`rounded-lg border px-4 py-3.5 ${b.earned ? 'border-kxblue/40 bg-kxblue/8' : 'border-white/8 bg-white/[0.015] opacity-50'}`}>
              <p className="text-[13.5px] font-medium flex items-center gap-2">
                {b.earned ? <Check size={14} className="text-kxblue" /> : <Lock size={13} className="text-kxmistdim" />}
                {b.label}
              </p>
              <p className="text-[12px] text-kxmist mt-1">{b.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Discord" desc="Link your Discord identity to show it on your profile.">
        <Notice error={error} />
        <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3.5">
          <div>
            <p className="text-sm font-medium">{discord ? `Connected as ${discord.identity_data?.full_name || discord.identity_data?.name || 'linked account'}` : 'Not connected'}</p>
            <p className="text-[12.5px] text-kxmist">Requires the Discord provider enabled in your Supabase project</p>
          </div>
          {discord ? (
            <button onClick={disconnectDiscord} disabled={busy} className="text-[13px] text-red-400 hover:text-red-300">Disconnect</button>
          ) : (
            <Button variant="subtle" onClick={connectDiscord} loading={busy}>Connect</Button>
          )}
        </div>
      </Section>
    </>
  );
}

/* ================= Tab 5: KX Cloud ================= */

function CloudConsoleTab() {
  const [sub, setSub] = useState('compute');
  const SUBS = [
    { id: 'compute', label: 'Compute', icon: Server },
    { id: 'storage', label: 'Storage', icon: Database },
    { id: 'traffic', label: 'Traffic', icon: Activity },
    { id: 'database', label: 'Database', icon: TerminalSquare },
    { id: 'env', label: 'Env Vars', icon: KeyRound },
  ];

  return (
    <>
      <div className="flex gap-2 mb-5 overflow-x-auto">
        {SUBS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSub(id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-full text-[12.5px] whitespace-nowrap border transition-colors ${
              sub === id ? 'border-kxblue bg-kxblue/10 text-white' : 'border-white/12 text-kxmist hover:border-white/25'
            }`}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {sub === 'compute' && (
        <Section title="Compute instances" unavailable desc="Developer nodes with start/stop/reboot controls and live telemetry.">
          <div className="flex items-center gap-3 rounded-lg border border-white/8 bg-white/[0.015] px-4 py-6 text-kxmist justify-center flex-col text-center">
            <Server size={22} />
            <p className="text-[13px] max-w-sm">KX Cloud infrastructure isn't provisioned yet — this needs real backend + cloud-provider wiring before it can show anything live.</p>
          </div>
        </Section>
      )}
      {sub === 'storage' && (
        <Section title="Storage & dataset buckets" unavailable desc="File manager for datasets and generated artifacts.">
          <div className="flex items-center gap-3 rounded-lg border border-white/8 bg-white/[0.015] px-4 py-6 text-kxmist justify-center flex-col text-center">
            <Database size={22} />
            <p className="text-[13px] max-w-sm">No storage backend is provisioned yet.</p>
          </div>
        </Section>
      )}
      {sub === 'traffic' && (
        <Section title="Traffic & API gateway analytics" unavailable desc="Request volume, success rate, and failures over time.">
          <div className="flex items-center gap-3 rounded-lg border border-white/8 bg-white/[0.015] px-4 py-6 text-kxmist justify-center flex-col text-center">
            <Activity size={22} />
            <p className="text-[13px] max-w-sm">There's no API gateway in front of anything yet, so there's no traffic to measure.</p>
          </div>
        </Section>
      )}
      {sub === 'database' && <DatabaseSubTab />}
      {sub === 'env' && <EnvVarsSubTab />}
    </>
  );
}

function EnvVarsSubTab() {
  const [vars, setVars] = useState(null);
  const [error, setError] = useState('');
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState({});

  const needsSetup = (e) => /relation .*env_vars.* does not exist/i.test(e.message || '');

  const refresh = async () => {
    const { data, error: listError } = await listEnvVars();
    if (listError) { setError(needsSetup(listError) ? 'SETUP' : listError.message); return; }
    setVars(data);
  };
  useEffect(() => { refresh(); }, []);

  const save = async () => {
    if (!key.trim()) return;
    setError(''); setSaving(true);
    const { error: saveError } = await upsertEnvVar(key.trim(), value, isPublic);
    setSaving(false);
    if (saveError) { setError(saveError.message); return; }
    setKey(''); setValue(''); setIsPublic(false);
    refresh();
  };

  const remove = async (id) => { if (confirm('Delete this variable?')) { await deleteEnvVar(id); refresh(); } };
  const toggleReveal = (id) => setRevealed((r) => ({ ...r, [id]: !r[id] }));

  if (error === 'SETUP') {
    return (
      <Section title="Environment variables" unavailable>
        <p className="text-[13px] text-kxmist">
          Run <code className="text-white font-mono">supabase/migrations/014_env_vars.sql</code> (and <code className="text-white font-mono">022_env_vars_public_flag.sql</code>) in your Supabase SQL Editor to enable this.
        </p>
      </Section>
    );
  }

  return (
    <Section title="Environment variables" desc="Real key/value config, scoped to your account. Stored as-is in Postgres — not column-encrypted, so treat this like a .env file, not a secrets vault. Vars marked 'Public' are exposed to anyone viewing a published project's pages (via window.KX_ENV) — never mark a real secret public.">
      <Notice error={error && error !== 'SETUP' ? error : ''} />

      <div className="flex flex-col gap-2.5 mb-5">
        {vars === null && <p className="text-sm text-kxmist">Loading…</p>}
        {vars !== null && vars.length === 0 && <p className="text-[13px] text-kxmist">No variables set yet.</p>}
        {vars?.map((v) => (
          <div key={v.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
            <div className="font-mono text-[13px] flex items-center gap-2">
              <span className="text-kxblue">{v.key}</span>
              <span className="text-kxmist"> = </span>
              <span>{revealed[v.id] ? v.value : '••••••••'}</span>
              {v.is_public && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-sans">Public</span>}
            </div>
            <div className="flex items-center gap-3 text-kxmist">
              <button onClick={() => toggleReveal(v.id)} className="text-[12px] hover:text-white">{revealed[v.id] ? 'Hide' : 'Reveal'}</button>
              <button onClick={() => remove(v.id)} className="hover:text-red-400"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <Input label="Key" value={key} onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))} placeholder="MY_API_KEY" containerClassName="flex-1" />
        <Input label="Value" value={value} onChange={(e) => setValue(e.target.value)} containerClassName="flex-1" />
        <label className="flex items-center gap-1.5 text-[12.5px] text-kxmist pb-2.5 cursor-pointer select-none">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
          Public
        </label>
        <Button variant="glow" onClick={save} loading={saving} disabled={!key.trim()}><Plus size={14} /> Set</Button>
      </div>
    </Section>
  );
}

function DatabaseSubTab() {
  const [query, setQuery] = useState('select * from projects limit 10');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);

  const needsSetup = (e) => /function .*run_readonly_query.* does not exist/i.test(e.message || '');

  const run = async () => {
    setError(''); setRunning(true); setRows(null);
    const { data, error: queryError } = await runReadonlyQuery(query);
    setRunning(false);
    if (queryError) {
      setError(needsSetup(queryError) ? 'SETUP' : queryError.message);
      return;
    }
    setRows(data || []);
  };

  const browse = (table) => setQuery(`select * from ${table} limit 50`);
  const columns = rows && rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <>
      <Section
        title="SQL editor"
        desc="Runs a real, read-only query against your own Supabase data — Row Level Security still applies, so this only ever sees what your account can already see."
      >
        {error === 'SETUP' ? (
          <p className="text-[13px] text-kxmist">
            Run <code className="text-white font-mono">supabase/migrations/006_readonly_sql.sql</code> in your Supabase SQL Editor to enable this.
          </p>
        ) : (
          <>
            <Notice error={error} />
            <div className="flex flex-wrap gap-2 mb-3">
              {KNOWN_TABLES.map((t) => (
                <button
                  key={t}
                  onClick={() => browse(t)}
                  className="flex items-center gap-1.5 text-[12px] font-mono px-2.5 py-1.5 rounded-full border border-white/12 text-kxmist hover:border-white/25 hover:text-white"
                >
                  <Table2 size={12} /> {t}
                </button>
              ))}
            </div>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={4}
              spellCheck={false}
              className="w-full rounded-lg border border-white/12 bg-black/30 px-3.5 py-2.5 text-[13px] font-mono outline-none focus:border-kxblue resize-y mb-3"
            />
            <Button variant="glow" onClick={run} loading={running} disabled={!query.trim()}>
              <Play size={13} /> Run query
            </Button>

            {rows !== null && (
              <div className="mt-5 overflow-x-auto">
                {rows.length === 0 ? (
                  <p className="text-[13px] text-kxmist">Query ran fine — no rows returned.</p>
                ) : (
                  <table className="w-full text-[12.5px] border-collapse">
                    <thead>
                      <tr className="border-b border-white/10">
                        {columns.map((c) => (
                          <th key={c} className="text-left font-mono font-medium text-kxmist px-3 py-2 whitespace-nowrap">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={i} className="border-b border-white/6">
                          {columns.map((c) => (
                            <td key={c} className="px-3 py-2 font-mono whitespace-nowrap max-w-xs truncate">
                              {typeof row[c] === 'object' ? JSON.stringify(row[c]) : String(row[c] ?? '—')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}
      </Section>

      <Section title="Security model" desc="What this can and can't do.">
        <ul className="flex flex-col gap-2 text-[13px] text-kxmist">
          <li className="flex gap-2"><Check size={14} className="text-emerald-300 shrink-0 mt-0.5" /> Runs as you — Row Level Security still filters every result</li>
          <li className="flex gap-2"><Check size={14} className="text-emerald-300 shrink-0 mt-0.5" /> Only a single SELECT statement is allowed</li>
          <li className="flex gap-2"><X size={14} className="text-red-400 shrink-0 mt-0.5" /> No INSERT / UPDATE / DELETE / DROP / ALTER — rejected outright</li>
          <li className="flex gap-2"><X size={14} className="text-red-400 shrink-0 mt-0.5" /> No access to other users' rows, or tables your account can't already read</li>
        </ul>
      </Section>
    </>
  );
}
