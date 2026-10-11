import { useEffect, useState } from 'react';
import { Mail, LifeBuoy } from 'lucide-react';
import DashboardShell from '../components/DashboardShell';
import { Card, Button, Input, Badge } from '../components/ui';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import { listTickets, createTicket, TICKET_CATEGORIES } from '../lib/tickets';
import { logActivity } from '../lib/activity';

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
      if (createError) { setError(createError.message); return; }
      logActivity('Support ticket submitted', subject);
      setSubject(''); setMessage(''); setNotice('Ticket submitted.');
      await refresh();
    } catch (err) {
      setError(err.message || 'Could not submit your ticket.');
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
          <h2 className="font-display text-[16px] font-medium mb-4">Frequently asked questions</h2>
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
          <div className="flex flex-col gap-2.5">{tickets?.map((ticket) => (
            <div key={ticket.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3.5 min-w-0">
              <div className="min-w-0"><p className="text-sm font-medium break-words">{ticket.subject}</p><p className="text-[12px] text-kxmist">{ticket.category} · {new Date(ticket.created_at).toLocaleDateString()}</p></div>
              <Badge tone={ticket.status === 'open' ? 'beta' : 'default'}>{String(ticket.status || 'open').replace('_', ' ')}</Badge>
            </div>
          ))}</div>
        </Card>
      </div>
    </DashboardShell>
  );
}
