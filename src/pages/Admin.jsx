import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import DashboardShell from '../components/DashboardShell';
import { Card, Button, Badge } from '../components/ui';
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
        {[['support', 'Support inbox'], ['audit', 'Audit log']].map(([key, text]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={`min-h-11 px-4 rounded-full text-[13px] border ${tab === key ? 'border-kxblue text-white bg-white/5' : 'border-white/10 text-kxmist'}`}>{text}</button>
        ))}
      </div>
      {tab === 'support' ? <SupportInbox /> : <AuditLog />}
    </DashboardShell>
  );
}
