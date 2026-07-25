import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import DashboardShell from '../components/DashboardShell';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import { Card, Button, Input, Badge } from '../components/ui';
import { listProjects, createProject, updateProject, deleteProject, PRODUCTS, STATUSES } from '../lib/projects';
import { logActivity } from '../lib/activity';
import { Plus, ExternalLink, Pencil, Trash2, X, FolderKanban, Code2 } from 'lucide-react';

const EMPTY_FORM = { name: '', product: 'K-XpertAI', status: 'active', description: '', external_url: '' };

export default function Projects() {
  useSeo({ title: 'Projects — KingxTech', noindex: true });
  useRequireAuth();

  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('All');

  const refresh = async () => {
    const { data, error: listError } = await listProjects();
    if (listError) { setError(needsSetup(listError) ? 'SETUP' : listError.message); return; }
    setProjects(data);
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    if (params.get('new') === '1') {
      setEditing(null);
      setShowForm(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const needsSetup = (e) => /relation .*projects.* does not exist/i.test(e.message || '');

  const openCreate = () => { setEditing(null); setShowForm(true); };
  const openEdit = (p) => { setEditing(p); setShowForm(true); };

  const remove = async (id) => {
    if (!confirm('Delete this project?')) return;
    const target = projects?.find((p) => p.id === id);
    const { error: delError } = await deleteProject(id);
    if (delError) { setError(delError.message); return; }
    logActivity('Project deleted', target?.name);
    refresh();
  };

  const visible = (projects || []).filter((p) => filter === 'All' || p.product === filter);

  if (error === 'SETUP') {
    return (
      <DashboardShell>
        <h1 className="font-display text-2xl font-semibold mb-4">Your projects</h1>
        <Card className="p-6 rounded-[20px]">
          <p className="text-sm text-kxmist leading-relaxed">
            The <code className="text-white font-mono">projects</code> table doesn't exist in your Supabase project yet.
            Run <code className="text-white font-mono">supabase/migrations/001_projects.sql</code> once in the Supabase SQL Editor to enable this page.
          </p>
        </Card>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold mb-1">Your projects</h1>
          <p className="text-kxmist text-sm">Everything you're building across the KingxTech ecosystem.</p>
        </div>
        <Button variant="glow" onClick={openCreate}><Plus size={15} /> New project</Button>
      </div>

      {error && error !== 'SETUP' && (
        <p className="text-[12.5px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-5">{error}</p>
      )}

      <div className="flex items-center gap-2 mb-6 overflow-x-auto">
        {['All', ...PRODUCTS].map((p) => (
          <button
            key={p}
            onClick={() => setFilter(p)}
            className={`text-[12.5px] font-mono px-3 py-1.5 rounded-full border whitespace-nowrap transition-colors ${
              filter === p ? 'border-kxblue bg-kxblue/10 text-white' : 'border-white/12 text-kxmist hover:border-white/25'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {projects === null && <p className="text-sm text-kxmist">Loading projects…</p>}

      {projects !== null && visible.length === 0 && (
        <Card className="p-10 rounded-[20px] flex flex-col items-center text-center gap-3">
          <FolderKanban size={28} className="text-kxmist" />
          <p className="text-sm text-kxmist">No projects yet. Add the first thing you're building.</p>
          <Button variant="subtle" onClick={openCreate}><Plus size={14} /> New project</Button>
        </Card>
      )}

      <div className="grid sm:grid-cols-2 gap-5">
        {visible.map((p) => (
          <Card key={p.id} className="p-6 rounded-[20px] flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg leading-tight">{p.name}</h3>
                <span className="text-[12px] font-mono text-kxmist">{p.product}</span>
              </div>
              <Badge tone={p.status === 'active' ? 'live' : p.status === 'paused' ? 'beta' : 'default'}>{p.status}</Badge>
            </div>
            {p.description && <p className="text-[13.5px] text-kxmist leading-relaxed">{p.description}</p>}
            <Link
              to={`/projects/${p.id}/workspace`}
              className="inline-flex items-center gap-1.5 text-[13px] text-kxpurple hover:text-white w-fit"
            >
              <Code2 size={13} /> Open workspace
            </Link>
            <div className="flex items-center justify-between mt-auto pt-2">
              {p.external_url ? (
                <a href={p.external_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] text-kxblue">
                  Open <ExternalLink size={13} />
                </a>
              ) : <span />}
              <div className="flex items-center gap-3 text-kxmist">
                <button onClick={() => openEdit(p)} className="hover:text-white"><Pencil size={15} /></button>
                <button onClick={() => remove(p.id)} className="hover:text-red-400"><Trash2 size={15} /></button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {showForm && (
        <ProjectFormModal
          initial={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); refresh(); }}
        />
      )}
    </DashboardShell>
  );
}

function ProjectFormModal({ initial, onClose, onSaved }) {
  const [form, setForm] = useState(initial ? { ...initial } : EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setSaving(true);
    const payload = {
      name: form.name,
      product: form.product,
      status: form.status,
      description: form.description || null,
      external_url: form.external_url || null,
    };
    const { error: saveError } = initial
      ? await updateProject(initial.id, payload)
      : await createProject(payload);
    setSaving(false);
    if (saveError) { setError(saveError.message); return; }
    logActivity(initial ? 'Project updated' : 'Project created', form.name);
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md">
        <Card className="p-6 rounded-[20px]">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display text-lg font-medium">{initial ? 'Edit project' : 'New project'}</h2>
            <button onClick={onClose} className="text-kxmist hover:text-white"><X size={18} /></button>
          </div>

          {error && (
            <p className="text-[12.5px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-4">{error}</p>
          )}

          <form onSubmit={submit} className="flex flex-col gap-4">
            <Input label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} required />

            <label className="block">
              <span className="block text-[13px] font-medium text-white/85 mb-1.5">Product</span>
              <select
                value={form.product}
                onChange={(e) => set('product', e.target.value)}
                className="w-full rounded-lg border border-white/12 bg-white/[0.02] px-3.5 py-2.5 text-sm outline-none focus:border-kxblue"
              >
                {PRODUCTS.map((p) => <option key={p} value={p} className="bg-kxsurface">{p}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="block text-[13px] font-medium text-white/85 mb-1.5">Status</span>
              <select
                value={form.status}
                onChange={(e) => set('status', e.target.value)}
                className="w-full rounded-lg border border-white/12 bg-white/[0.02] px-3.5 py-2.5 text-sm outline-none focus:border-kxblue"
              >
                {STATUSES.map((s) => <option key={s} value={s} className="bg-kxsurface">{s}</option>)}
              </select>
            </label>

            <Input label="Link (optional)" value={form.external_url || ''} onChange={(e) => set('external_url', e.target.value)} placeholder="https://…" />

            <label className="block">
              <span className="block text-[13px] font-medium text-white/85 mb-1.5">Description</span>
              <textarea
                value={form.description || ''}
                onChange={(e) => set('description', e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-white/12 bg-white/[0.02] px-3.5 py-2.5 text-sm outline-none focus:border-kxblue resize-none"
              />
            </label>

            <Button type="submit" variant="glow" className="w-full mt-1" loading={saving}>
              {initial ? 'Save changes' : 'Create project'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
