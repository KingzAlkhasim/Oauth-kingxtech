import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import DashboardShell from '../components/DashboardShell';
import { Card, Button, Badge } from '../components/ui';
import { adminListAccounts, adminSetSuspension } from '../lib/account';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import useIsAdmin, {
  TICKET_STATUSES, adminListTickets, adminListReplies, adminReply, adminSetStatus, adminAuditLog,
} from '../lib/admin';

const label = (s) => String(s || '').replace('_', ' ');

function TicketThread({ ticket, onChanged }) {
  const [replies, setReplies] = useState(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error: e } = await adminListReplies(ticket.id);
    if (e) setError(e.message); else setReplies(data || []);
  }, [ticket.id]);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (!body.trim()) return;
    setBusy(true); setError('');
    const { error: e } = await adminReply(ticket.id, body.trim());
    setBusy(false);
    if (e) { setError(e.message); return; }
    setBody(''); await load(); onChanged();
  };

  const setStatus = async (status) => {
    setBusy(true); setError('');
    const { error: e } = await adminSetStatus(ticket.id, status);
    setBusy(false);
    if (e) { setError(e.message); return; }
    onChanged();
  };

  return (
    <div className="mt-3 pt-3 border-t border-white/10 flex flex-col gap-3">
      <p className="text-[13px] whitespace-pre-wrap break-words">{ticket.message}</p>
      {replies?.map((r) => (
        <div key={r.id} className={`rounded-lg px-3 py-2 text-[13px] whitespace-pre-wrap break-words ${r.is_admin ? 'bg-kxpurple/10 border border-kxpurple/20' : 'bg-white/[0.03] border border-white/10'}`}>
          <p className="text-[11px] text-kxmist mb-1">{r.is_admin ? 'You (admin)' : 'User'} · {new Date(r.created_at).toLocaleString()}</p>
          {r.body}
        </div>
      ))}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={5000}
        placeholder="Write a reply…"
        className="w-full rounded-lg border border-white/12 bg-white/[0.02] px-3.5 py-2.5 text-sm outline-none focus:border-kxblue resize-none"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="glow" onClick={send} loading={busy} disabled={busy || !body.trim()}>Send reply</Button>
        {TICKET_STATUSES.filter((s) => s !== ticket.status).map((s) => (
          <button key={s} type="button" disabled={busy} onClick={() => setStatus(s)} className="min-h-11 px-3 text-[12.5px] rounded-lg border border-white/10 text-kxmist hover:text-white disabled:opacity-50">
            Mark {label(s)}
          </button>
        ))}
      </div>
      {error && <p className="text-[12.5px] text-red-400">{error}</p>}
    </div>
  );
}

function SupportInbox() {
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('active');
  const [openId, setOpenId] = useState(null);

  const refresh = useCallback(async () => {
    const { data, error: e } = await adminListTickets();
    if (e) setError(e.message); else setTickets(data || []);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const visible = (tickets || []).filter((t) => filter === 'all' || t.status === 'open' || t.status === 'in_progress');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {[['active', 'Needs attention'], ['all', 'All']].map(([key, text]) => (
          <button key={key} type="button" onClick={() => setFilter(key)} className={`min-h-11 px-4 rounded-full text-[12.5px] border ${filter === key ? 'border-kxblue text-white bg-white/5' : 'border-white/10 text-kxmist'}`}>{text}</button>
        ))}
      </div>
      {error && <p className="text-[12.5px] text-red-400">{error}</p>}
      {tickets === null && !error && <p className="text-sm text-kxmist">Loading tickets…</p>}
      {tickets && visible.length === 0 && <p className="text-[13px] text-kxmist">Nothing here.</p>}
      {visible.map((t) => (
        <Card key={t.id} className="p-4 rounded-xl">
          <button type="button" onClick={() => setOpenId(openId === t.id ? null : t.id)} className="w-full text-left flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium break-words">{t.subject}</p>
              <p className="text-[12px] text-kxmist break-words">{t.category} · {t.user_name || t.user_email} · {t.user_email} · {new Date(t.created_at).toLocaleString()}{t.reply_count > 0 ? ` · ${t.reply_count} repl${t.reply_count === 1 ? 'y' : 'ies'}` : ''}</p>
            </div>
            <Badge tone={t.status === 'open' ? 'beta' : 'default'}>{label(t.status)}</Badge>
          </button>
          {openId === t.id && <TicketThread ticket={t} onChanged={refresh} />}
        </Card>
      ))}
    </div>
  );
}

function AccountRow({ account, onChanged }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const change = async (suspend) => {
    if (suspend && reason.trim().length < 3) { setError('Give a reason first.'); return; }
    if (suspend && !window.confirm(`Suspend ${account.email}? They will be blocked and their sites go offline.`)) return;
    setBusy(true); setError('');
    const { error: e } = await adminSetSuspension(account.user_id, suspend, reason.trim());
    setBusy(false);
    if (e) { setError(e.message); return; }
    setReason(''); setOpen(false); onChanged();
  };

  return (
    <Card className="p-4 rounded-xl">
      <button type="button" onClick={() => setOpen(!open)} className="w-full text-left flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium break-words">{account.full_name || account.email}</p>
          <p className="text-[12px] text-kxmist break-words">{account.email} · {account.plan} · {account.project_count} project{Number(account.project_count) === 1 ? '' : 's'} · {account.ai_requests_30d} AI requests (30d)</p>
        </div>
        <Badge tone={account.suspended ? 'beta' : 'default'}>{account.suspended ? 'suspended' : 'active'}</Badge>
      </button>
      {open && (
        <div className="mt-3 pt-3 border-t border-white/10 flex flex-col gap-3 text-[12.5px]">
          <p className="text-kxmist">Joined {new Date(account.created_at).toLocaleDateString()} · Last sign-in {account.last_sign_in_at ? new Date(account.last_sign_in_at).toLocaleString() : 'never'}</p>
          {account.suspended ? (
            <>
              <p className="break-words">Suspended {account.suspended_at ? new Date(account.suspended_at).toLocaleString() : ''}. Reason: {account.suspended_reason}</p>
              <Button variant="subtle" className="self-start" onClick={() => change(false)} loading={busy} disabled={busy}>Reinstate account</Button>
            </>
          ) : (
            <>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} placeholder="Reason for suspension (shown to the user)" className="w-full rounded-lg border border-white/12 bg-white/[0.02] px-3.5 py-2.5 text-sm outline-none focus:border-kxblue resize-none" />
              <Button variant="glow" className="self-start" onClick={() => change(true)} loading={busy} disabled={busy}>Suspend account</Button>
            </>
          )}
          {error && <p className="text-red-400">{error}</p>}
        </div>
      )}
    </Card>
  );
}

function Accounts() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const refresh = useCallback(async () => {
    const { data, error: e } = await adminListAccounts();
    if (e) setError(e.message); else setRows(data || []);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const q = query.trim().toLowerCase();
  const visible = (rows || []).filter((r) => !q || `${r.email} ${r.full_name || ''}`.toLowerCase().includes(q));

  return (
    <div className="flex flex-col gap-3">
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or email" className="w-full rounded-lg border border-white/12 bg-white/[0.02] px-3.5 py-2.5 text-sm outline-none focus:border-kxblue" />
      {error && <p className="text-[12.5px] text-red-400">{error}</p>}
      {rows === null && !error && <p className="text-sm text-kxmist">Loading accounts…</p>}
      {rows && visible.length === 0 && <p className="text-[13px] text-kxmist">No accounts match.</p>}
      {visible.map((a) => <AccountRow key={a.user_id} account={a} onChanged={refresh} />)}
    </div>
  );
}

function AuditLog() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    adminAuditLog().then(({ data, error: e }) => { if (e) setError(e.message); else setRows(data || []); });
  }, []);
  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-[12.5px] text-red-400">{error}</p>}
      {rows === null && !error && <p className="text-sm text-kxmist">Loading…</p>}
      {rows?.length === 0 && <p className="text-[13px] text-kxmist">No admin actions recorded yet.</p>}
      {rows?.map((r) => (
        <div key={r.id} className="rounded-lg border border-white/10 bg-white/[0.02] px-3.5 py-2.5 text-[12.5px] break-words">
          <span className="font-mono text-kxblue">{r.action}</span>{' '}
          <span className="text-kxmist">{r.target_type} {String(r.target_id || '').slice(0, 8)} {r.details && Object.keys(r.details).length ? JSON.stringify(r.details) : ''}</span>
          <p className="text-[11px] text-kxmistdim">{new Date(r.created_at).toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
}

export default function Admin() {
  useSeo({ title: 'Admin — KingxTech', noindex: true });
  useRequireAuth();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const [tab, setTab] = useState('support');

  useEffect(() => { if (isAdmin === false) navigate('/welcome', { replace: true }); }, [isAdmin, navigate]);
  if (!isAdmin) return null;

  return (
    <DashboardShell>
      <div className="flex items-center gap-2 mb-5">
        <ShieldCheck size={20} className="text-kxpurple" />
        <h1 className="font-display text-2xl">Admin</h1>
      </div>
      <div className="flex gap-2 mb-5">
        {[['support', 'Support inbox'], ['accounts', 'Accounts'], ['audit', 'Audit log']].map(([key, text]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={`min-h-11 px-4 rounded-full text-[13px] border ${tab === key ? 'border-kxblue text-white bg-white/5' : 'border-white/10 text-kxmist'}`}>{text}</button>
        ))}
      </div>
      {tab === 'support' ? <SupportInbox /> : tab === 'accounts' ? <Accounts /> : <AuditLog />}
    </DashboardShell>
  );
}
