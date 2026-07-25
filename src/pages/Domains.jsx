import { useEffect, useState } from 'react';
import DashboardShell from '../components/DashboardShell';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import { listDomains, addDomain, removeDomain, verifyDomain } from '../lib/domains';
import { Card, Button, Input, Badge } from '../components/ui';
import { Plus, Trash2, CheckCircle2, RefreshCw, Globe } from 'lucide-react';

export default function Domains() {
  useSeo({ title: 'Domains — KingxTech', noindex: true });
  useRequireAuth();
  const [domains, setDomains] = useState(null);
  const [error, setError] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [adding, setAdding] = useState(false);
  const [verifying, setVerifying] = useState(null);

  const needsSetup = (e) => /relation .*custom_domains.* does not exist/i.test(e.message || '');

  const refresh = async () => {
    const { data, error: listError } = await listDomains();
    if (listError) { setError(needsSetup(listError) ? 'SETUP' : listError.message); return; }
    setDomains(data);
  };
  useEffect(() => { refresh(); }, []);

  const add = async () => {
    if (!newDomain.trim()) return;
    setError(''); setAdding(true);
    const { error: addError } = await addDomain(newDomain.trim().toLowerCase());
    setAdding(false);
    if (addError) { setError(addError.message); return; }
    setNewDomain('');
    refresh();
  };

  const remove = async (id) => { if (confirm('Remove this domain?')) { await removeDomain(id); refresh(); } };

  const verify = async (d) => {
    setError(''); setVerifying(d.id);
    const { error: verifyError } = await verifyDomain(d.id, d.domain, d.target_cname);
    setVerifying(null);
    if (verifyError) { setError(verifyError.message); return; }
    refresh();
  };

  if (error === 'SETUP') {
    return (
      <DashboardShell>
        <h1 className="font-display text-2xl font-semibold mb-4">Domains</h1>
        <Card className="p-6 rounded-[20px]">
          <p className="text-sm text-kxmist leading-relaxed">
            Run <code className="text-white font-mono">supabase/migrations/011_custom_domains.sql</code> in your Supabase SQL Editor to enable this.
          </p>
        </Card>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <h1 className="font-display text-2xl font-semibold mb-1">Custom Domain Routing</h1>
      <p className="text-kxmist text-sm mb-8">Point your own domain at a KingxTech project. Verification checks your real, live DNS.</p>

      {error && error !== 'SETUP' && (
        <p className="text-[12.5px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-5">{error}</p>
      )}

      <Card className="p-6 rounded-[20px] mb-5">
        <h2 className="font-display text-[16px] font-medium mb-4">Add a domain</h2>
        <div className="flex items-end gap-3">
          <Input label="Domain" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="app.yourdomain.com" containerClassName="flex-1" />
          <Button variant="glow" onClick={add} loading={adding} disabled={!newDomain.trim()}><Plus size={14} /> Add</Button>
        </div>
      </Card>

      {domains === null && <p className="text-sm text-kxmist">Loading…</p>}

      {domains !== null && domains.length === 0 && (
        <Card className="p-10 rounded-[20px] flex flex-col items-center text-center gap-3">
          <Globe size={28} className="text-kxmist" />
          <p className="text-sm text-kxmist">No domains added yet.</p>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        {domains?.map((d) => (
          <Card key={d.id} className="p-6 rounded-[20px]">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <div className="flex items-center gap-3">
                <Globe size={18} className="text-kxmist" />
                <p className="font-mono text-sm">{d.domain}</p>
                <Badge tone={d.verified ? 'live' : 'default'}>{d.verified ? 'Verified' : 'Pending'}</Badge>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="subtle" onClick={() => verify(d)} loading={verifying === d.id}>
                  <RefreshCw size={13} /> Verify Live DNS
                </Button>
                <button onClick={() => remove(d.id)} className="text-kxmist hover:text-red-400"><Trash2 size={15} /></button>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 px-4 py-3">
              <p className="text-[12px] font-mono text-kxmist mb-1.5">Add this DNS record at your registrar:</p>
              <div className="flex items-center gap-6 text-[13px] font-mono flex-wrap">
                <span><span className="text-kxmist">Type</span> CNAME</span>
                <span><span className="text-kxmist">Host</span> {d.domain.split('.')[0]}</span>
                <span><span className="text-kxmist">Value</span> {d.target_cname}</span>
              </div>
            </div>

            {d.verified && (
              <p className="flex items-center gap-2 text-[12.5px] text-emerald-300 mt-3">
                <CheckCircle2 size={14} /> Live-checked {d.last_checked_at ? new Date(d.last_checked_at).toLocaleString() : ''}
              </p>
            )}
          </Card>
        ))}
      </div>
    </DashboardShell>
  );
}
