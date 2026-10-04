import { useEffect, useState } from 'react';
import DashboardShell from '../components/DashboardShell';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import { listDomains, listDomainProjects, addDomain, removeDomain, verifyDomain } from '../lib/domains';
import { Card, Button, Input, Badge } from '../components/ui';
import { Plus, Trash2, CheckCircle2, RefreshCw, Globe } from 'lucide-react';

export default function Domains() {
  useSeo({ title: 'Domains — KingxTech', noindex: true });
  useRequireAuth();
  const [domains, setDomains] = useState(null);
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [projectId, setProjectId] = useState('');
  const [adding, setAdding] = useState(false);
  const [verifying, setVerifying] = useState(null);

  const refresh = async () => {
    const [{ data, error: listError }, { data: projectData, error: projectError }] = await Promise.all([
      listDomains(),
      listDomainProjects(),
    ]);
    if (listError) { setError(/relation .*custom_domains.* does not exist/i.test(listError.message || '') ? 'SETUP' : listError.message); return; }
    if (projectError) { setError(projectError.message); return; }
    setDomains(data);
    setProjects(projectData || []);
    if (!projectId && projectData?.[0]?.id) setProjectId(projectData[0].id);
  };

  useEffect(() => { refresh(); }, []);

  const add = async () => {
    if (!newDomain.trim() || !projectId) return;
    setError(''); setAdding(true);
    const { error: addError } = await addDomain(newDomain.trim().toLowerCase(), projectId);
    setAdding(false);
    if (addError) { setError(addError.message); return; }
    setNewDomain('');
    refresh();
  };

  const remove = async (id) => { if (confirm('Remove this domain?')) { await removeDomain(id); refresh(); } };

  const verify = async (d) => {
    setError(''); setVerifying(d.id);
    const { error: verifyError } = await verifyDomain(d.id);
    setVerifying(null);
    if (verifyError) { setError(verifyError.message); return; }
    refresh();
  };

  if (error === 'SETUP') {
    return (
      <DashboardShell>
        <h1 className="font-display text-2xl font-semibold mb-4">Domains</h1>
        <Card className="p-6 rounded-[20px]"><p className="text-sm text-kxmist">Custom domains are not enabled yet.</p></Card>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <h1 className="font-display text-2xl font-semibold mb-1">Custom Domain Routing</h1>
      <p className="text-kxmist text-sm mb-8">Connect a domain to an existing KingxTech project and publish it there.</p>

      {error && <p className="text-[12.5px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-5">{error}</p>}

      <Card className="p-6 rounded-[20px] mb-5">
        <h2 className="font-display text-[16px] font-medium mb-4">Connect a domain</h2>
        <div className="grid md:grid-cols-[1fr_1fr_auto] items-end gap-3">
          <Input label="Domain" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="app.yourdomain.com" />
          <label className="block">
            <span className="block text-[13px] font-medium text-white/85 mb-1.5">Project</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-full rounded-lg border border-white/12 bg-white/[0.02] px-3.5 py-2.5 text-sm outline-none focus:border-kxblue">
              <option value="">Select project</option>
              {projects.map((p) => <option key={p.id} value={p.id} className="bg-kxsurface">{p.name}</option>)}
            </select>
          </label>
          <Button variant="glow" onClick={add} loading={adding} disabled={!newDomain.trim() || !projectId}><Plus size={14} /> Connect</Button>
        </div>
      </Card>

      {domains === null && <p className="text-sm text-kxmist">Loading…</p>}
      {domains !== null && domains.length === 0 && (
        <Card className="p-10 rounded-[20px] flex flex-col items-center text-center gap-3">
          <Globe size={28} className="text-kxmist" /><p className="text-sm text-kxmist">No domains connected yet.</p>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        {domains?.map((d) => (
          <Card key={d.id} className="p-6 rounded-[20px]">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <div className="flex items-center gap-3 flex-wrap">
                <Globe size={18} className="text-kxmist" />
                <p className="font-mono text-sm">{d.domain}</p>
                <Badge tone={d.verified ? 'live' : 'default'}>{d.verified ? 'Verified' : 'Pending DNS'}</Badge>
                {d.projects?.name && <span className="text-[12px] text-kxmist">→ {d.projects.name}</span>}
              </div>
              <div className="flex items-center gap-3">
                <Button variant="subtle" onClick={() => verify(d)} loading={verifying === d.id}><RefreshCw size={13} /> Verify DNS</Button>
                <button onClick={() => remove(d.id)} className="text-kxmist hover:text-red-400"><Trash2 size={15} /></button>
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 px-4 py-3">
              <p className="text-[12px] font-mono text-kxmist mb-1.5">DNS setup</p>
              {d.verified ? (
                <p className="text-[13px] text-emerald-300">Vercel has verified this domain. HTTPS will be served automatically.</p>
              ) : Array.isArray(d.verification) && d.verification.length ? (
                <div className="space-y-2">
                  {d.verification.map((record, index) => (
                    <div key={index} className="flex items-start gap-5 text-[13px] font-mono flex-wrap">
                      <span><span className="text-kxmist">Type</span> {record.type || 'TXT'}</span>
                      <span><span className="text-kxmist">Name</span> {record.domain || d.domain}</span>
                      <span className="break-all"><span className="text-kxmist">Value</span> {record.value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-kxmist">Vercel is preparing the DNS verification instructions. Try Verify DNS in a moment.</p>
              )}
            </div>
            {d.verified && <p className="flex items-center gap-2 text-[12.5px] text-emerald-300 mt-3"><CheckCircle2 size={14} /> DNS verified</p>}
          </Card>
        ))}
      </div>
    </DashboardShell>
  );
}
