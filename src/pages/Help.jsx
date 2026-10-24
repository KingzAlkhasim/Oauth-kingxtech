import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, LifeBuoy } from 'lucide-react';
import DashboardShell from '../components/DashboardShell';
import { Card, Button, Input, Badge } from '../components/ui';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import { listTickets, createTicket, listReplies, addFollowUp, TICKET_CATEGORIES } from '../lib/tickets';
import { logActivity } from '../lib/activity';
import { friendlyError } from '../lib/errors';

function TicketRow({ ticket }) {
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    const { data, error: e } = await listReplies(ticket.id);
    if (e) setErr(friendlyError(e)); else setReplies(data || []);
  };
  const toggle = () => { const next = !open; setOpen(next); if (next && replies === null) load(); };
  const send = async () => {
    if (!body.trim()) return;
    setBusy(true); setErr('');
    const { error: e } = await addFollowUp(ticket.id, body.trim());
    setBusy(false);
    if (e) { setErr(friendlyError(e)); return; }
    setBody(''); load();
  };

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3.5 min-w-0">
      <button type="button" onClick={toggle} className="w-full text-left flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 min-w-0">
        <div className="min-w-0"><p className="text-sm font-medium break-words">{ticket.subject}</p><p className="text-[12px] text-kxmist">{ticket.category} · {new Date(ticket.created_at).toLocaleDateString()}</p></div>
        <Badge tone={ticket.status === 'open' ? 'beta' : 'default'}>{String(ticket.status || 'open').replace('_', ' ')}</Badge>
      </button>
      {open && (
        <div className="mt-3 pt-3 border-t border-white/10 flex flex-col gap-2.5">
          <p className="text-[13px] text-kxmist whitespace-pre-wrap break-words">{ticket.message}</p>
          {replies?.map((r) => (
            <div key={r.id} className={`rounded-lg px-3 py-2 text-[13px] whitespace-pre-wrap break-words ${r.is_admin ? 'bg-kxpurple/10 border border-kxpurple/20' : 'bg-white/[0.03] border border-white/10'}`}>
              <p className="text-[11px] text-kxmist mb-1">{r.is_admin ? 'KingxTech support' : 'You'} · {new Date(r.created_at).toLocaleString()}</p>
              {r.body}
            </div>
          ))}
          {ticket.status !== 'closed' && (
            <>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={5000} placeholder="Add a follow-up…" className="w-full rounded-lg border border-white/12 bg-white/[0.02] px-3.5 py-2.5 text-sm outline-none focus:border-kxblue resize-none" />
              <Button variant="subtle" className="self-start" onClick={send} loading={busy} disabled={busy || !body.trim()}>Send follow-up</Button>
            </>
          )}
          {err && <p className="text-[12.5px] text-red-400">{err}</p>}
        </div>
      )}
    </div>
  );
}

export default function Help() {
  useSeo({ title: 'Help — KingxTech', noindex: true });
  useRequireAuth();
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('Bug');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const refresh = async () => {
    const { data, error: listError } = await listTickets();
    if (listError) {
      setError(/relation .*support_tickets.* does not exist/i.test(listError.message || '')
        ? 'Tickets are not configured yet. Contact hello@kingxtech.name.ng for help.'
        : listError.message);
      return;
    }
    setTickets(data || []);
  };
  useEffect(() => { refresh(); }, []);

  const submit = async (event) => {
    event.preventDefault();
    setError(''); setNotice(''); setSaving(true);
    try {
      const { error: createError } = await createTicket({ category, subject, message });
      if (createError) { setError(friendlyError(createError)); return; }
      logActivity('Support ticket submitted', subject);
      setSubject(''); setMessage(''); setNotice('Ticket submitted.');
      await refresh();
    } catch (err) {
      setError(friendlyError(err, 'Could not submit your ticket.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardShell>
      <div className="max-w-3xl min-w-0">
        <div className="flex items-start gap-3 mb-2">
          <span className="w-10 h-10 rounded-xl bg-kxblue/10 text-kxblue flex items-center justify-center shrink-0"><LifeBuoy size={19} /></span>
          <div className="min-w-0"><h1 className="font-display text-2xl font-semibold">Help &amp; Support</h1><p className="text-kxmist text-sm mt-1">Find an answer or send a message to the KingxTech team.</p></div>
        </div>
        <Card className="p-5 sm:p-6 rounded-[20px] mb-5">
          <h2 className="font-display text-[16px] font-medium mb-1">Frequently asked questions</h2>
          <p className="text-kxmist text-[13px] mb-4">Looking for step-by-step guides? Read the <Link to="/docs" className="text-kxblue underline">documentation</Link>.</p>
          <div className="flex flex-col gap-4 text-[13px]">
            <div><p className="font-medium mb-1">How do I reset my password?</p><p className="text-kxmist leading-relaxed">Use “Forgot password” on the sign-in page and follow the secure link sent to your email.</p></div>
            <div><p className="font-medium mb-1">How do I protect my account?</p><p className="text-kxmist leading-relaxed">Open Account → Security to change your password or manage two-factor authentication.</p></div>
            <div><p className="font-medium mb-1">Where can I get help with a project or payment?</p><p className="text-kxmist leading-relaxed">Submit a ticket below with the relevant category and details. Avoid including passwords or API secrets.</p></div>
          </div>
          <div className="mt-5 pt-4 border-t border-white/8 flex flex-wrap items-center gap-2 text-[13px]"><Mail size={15} className="text-kxmist" /><span className="text-kxmist">Contact:</span><a className="text-kxblue hover:underline break-all" href="mailto:hello@kingxtech.name.ng">hello@kingxtech.name.ng</a></div>
        </Card>
        <Card className="p-5 sm:p-6 rounded-[20px] mb-5">
          <h2 className="font-display text-[16px] font-medium mb-4">Submit a support ticket</h2>
          {error && <p role="alert" className="text-[12.5px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-4 break-words">{error}</p>}
          {notice && <p role="status" className="text-[12.5px] text-emerald-300 bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-3 py-2 mb-4">{notice}</p>}
          <form onSubmit={submit} className="flex flex-col gap-4">
            <label className="block"><span className="block text-[13px] font-medium text-white/85 mb-1.5">Category</span><select value={category} onChange={(event) => setCategory(event.target.value)} className="w-full min-w-0 rounded-lg border border-white/12 bg-white/[0.02] px-3.5 py-2.5 text-sm outline-none focus:border-kxblue">{TICKET_CATEGORIES.map((item) => <option key={item} value={item} className="bg-kxsurface">{item}</option>)}</select></label>
            <Input label="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} required />
            <label className="block"><span className="block text-[13px] font-medium text-white/85 mb-1.5">Message</span><textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={4} required className="w-full min-w-0 rounded-lg border border-white/12 bg-white/[0.02] px-3.5 py-2.5 text-sm outline-none focus:border-kxblue resize-y" /></label>
            <Button type="submit" variant="glow" className="self-start" loading={saving} disabled={saving}>Submit ticket</Button>
          </form>
        </Card>
        <Card className="p-5 sm:p-6 rounded-[20px]">
          <h2 className="font-display text-[16px] font-medium mb-4">Your tickets</h2>
          {tickets === null && !error && <p className="text-sm text-kxmist">Loading tickets…</p>}
          {tickets?.length === 0 && <p className="text-[13px] text-kxmist">No tickets yet.</p>}
          <div className="flex flex-col gap-2.5">{tickets?.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} />)}</div>
        </Card>
      </div>
    </DashboardShell>
  );
}
