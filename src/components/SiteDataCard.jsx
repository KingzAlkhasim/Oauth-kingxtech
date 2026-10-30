import { useCallback, useEffect, useState } from 'react';
import { Database, Copy, Check, Trash2, Plus } from 'lucide-react';
import { Card, Button, SkeletonRows } from './ui';
import { listDataCollections, saveDataRules, listDataRows, deleteDataRow } from '../lib/projectFiles';
import { friendlyError } from '../lib/errors';
import { copyText } from '../lib/copyText';

const NAME_RE = /^[a-z][a-z0-9_-]{0,39}$/;

const snippetFor = (projectId, name) => `// Save a record (needs "Visitors can add records")
await fetch('/api/public/data/${projectId}/${name}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Ada', message: 'Hello!' }),
});

// Show records (needs "Visitors can read records")
const res = await fetch('/api/public/data/${projectId}/${name}?limit=20');
const { rows } = await res.json(); // [{ id, data, created_at }]`;

export default function SiteDataCard({ projectId }) {
  const [collections, setCollections] = useState(null);
  const [selected, setSelected] = useState('');
  const [rows, setRows] = useState(null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try { const d = await listDataCollections(projectId); setCollections(d.collections); setError(''); }
    catch (err) { setError(friendlyError(err)); setCollections([]); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selected) { setRows(null); return; }
    let alive = true;
    setRows(null);
    listDataRows(projectId, selected).then((d) => alive && setRows(d.rows)).catch((e) => alive && (setError(friendlyError(e)), setRows([])));
    return () => { alive = false; };
  }, [projectId, selected]);

  const current = collections?.find((c) => c.name === selected);

  const setRule = async (patch) => {
    setBusy(true); setError('');
    try {
      const next = { publicCreate: current.publicCreate, publicRead: current.publicRead, ...patch };
      await saveDataRules(projectId, selected, next);
      await load();
    } catch (err) { setError(friendlyError(err)); } finally { setBusy(false); }
  };

  const addCollection = async () => {
    const name = newName.trim();
    if (!NAME_RE.test(name)) { setError('Use lowercase letters, numbers, - and _, starting with a letter (like "messages").'); return; }
    setBusy(true); setError('');
    try { await saveDataRules(projectId, name, { publicCreate: false, publicRead: false }); setNewName(''); await load(); setSelected(name); }
    catch (err) { setError(friendlyError(err)); } finally { setBusy(false); }
  };

  const removeRow = async (id) => {
    if (!window.confirm('Delete this record? This cannot be undone.')) return;
    try { await deleteDataRow(projectId, id); setRows((r) => r.filter((x) => x.id !== id)); load(); }
    catch (err) { setError(friendlyError(err)); }
  };

  return (
    <Card className="p-4 rounded-xl">
      <div className="flex items-center gap-2 mb-1">
        <Database size={15} className="text-kxblue" />
        <h3 className="text-[14px] font-semibold">Data for your site</h3>
      </div>
      <p className="text-[11.5px] text-kxmist leading-relaxed">
        Save and show records from your published site (contact forms, guestbooks, orders, scores) without running a server. Everything is closed until you open it.
      </p>
      {error && <p className="mt-3 text-[12px] text-red-300">{error}</p>}
      {collections === null && <SkeletonRows rows={2} className="mt-3" label="Loading data" />}
      {collections && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {collections.map((c) => (
              <button key={c.name} type="button" onClick={() => setSelected(c.name)} aria-pressed={selected === c.name}
                className={`min-h-9 px-3 rounded-lg border text-[12px] ${selected === c.name ? 'border-kxblue/50 text-kxblue bg-kxblue/10' : 'border-white/12 text-kxmist hover:text-white'}`}>
                {c.name} <span className="text-kxmistdim">({c.rows})</span>
              </button>
            ))}
            {collections.length === 0 && <span className="text-[12px] text-kxmist">No collections yet. Add one below, like "messages".</span>}
          </div>
          <div className="flex gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value.toLowerCase())} placeholder="new collection, e.g. messages" maxLength={40}
              className="flex-1 min-w-0 min-h-11 rounded-lg border border-white/12 bg-kxsurface2 px-3 text-[13px] text-white" />
            <Button variant="subtle" onClick={addCollection} loading={busy} disabled={!newName.trim()}><Plus size={14} /> Add</Button>
          </div>

          {current && (
            <>
              <label className="flex items-center gap-2 min-h-11 text-[13px]">
                <input type="checkbox" checked={current.publicCreate} disabled={busy} onChange={(e) => setRule({ publicCreate: e.target.checked })} />
                Visitors can add records
              </label>
              <label className="flex items-center gap-2 min-h-11 text-[13px]">
                <input type="checkbox" checked={current.publicRead} disabled={busy} onChange={(e) => setRule({ publicRead: e.target.checked })} />
                Visitors can read records
              </label>
              {current.publicRead && <p className="text-[11.5px] text-amber-300">Anyone who visits your site can read every record in this collection. Don't turn this on for emails, phone numbers or other private details.</p>}

              <div className="rounded-lg border border-white/10 bg-black/40">
                <div className="flex items-center justify-between pl-3 pr-1 border-b border-white/10">
                  <span className="py-1 text-[10px] font-mono uppercase tracking-wider text-kxmist/60">Paste into your site's JavaScript</span>
                  <button type="button" onClick={async () => { if (await copyText(snippetFor(projectId, current.name))) { setCopied(true); setTimeout(() => setCopied(false), 1600); } }}
                    className="inline-flex items-center gap-1 min-h-8 px-2 rounded-md text-[10.5px] text-kxmist hover:text-white hover:bg-white/10">
                    {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}{copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="px-3 py-2 overflow-x-auto text-[11.5px] leading-relaxed text-green-400 font-mono">{snippetFor(projectId, current.name)}</pre>
              </div>

              <div>
                <p className="text-[12px] text-kxmist mb-2">Records (newest first)</p>
                {rows === null && <SkeletonRows rows={2} label="Loading records" />}
                {rows?.length === 0 && <p className="text-[12px] text-kxmist">No records yet.</p>}
                <div className="flex flex-col gap-2">
                  {rows?.map((r) => (
                    <div key={r.id} className="flex items-start gap-2 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-kxmistdim mb-1">{new Date(r.created_at).toLocaleString()}</p>
                        <pre className="text-[12px] text-white whitespace-pre-wrap break-words font-mono">{JSON.stringify(r.data, null, 1)}</pre>
                      </div>
                      <button type="button" onClick={() => removeRow(r.id)} aria-label="Delete record" className="min-h-9 min-w-9 text-kxmist hover:text-red-400"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          <p className="text-[11.5px] text-kxmist">Or ask K-XpertAI: "add a contact form that saves to my site's data". Works on your published site and custom domains, not in the in-app preview.</p>
        </div>
      )}
    </Card>
  );
}
