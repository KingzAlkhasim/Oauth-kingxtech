import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HardDrive, FolderKanban, Globe, Sparkles } from 'lucide-react';
import DashboardShell from '../components/DashboardShell';
import { Card, Badge } from '../components/ui';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import { getStorageUsage, getAiUsageMeter, getStorageQuota } from '../lib/storageUsage';
import { formatBytes } from '../lib/formatBytes';
import { friendlyError } from '../lib/errors';

function Stat({ icon: Icon, label, value }) {
  return (
    <Card className="p-4 rounded-2xl">
      <p className="flex items-center gap-2 text-[12px] text-kxmist"><Icon size={14} /> {label}</p>
      <p className="font-display text-2xl mt-1 break-words">{value}</p>
    </Card>
  );
}

function Meter({ label, percent, resetsAt, detail }) {
  const pct = Math.max(0, Math.min(100, Math.round(percent || 0)));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span>{label}</span>
        <span className="text-kxmist">{detail || `${pct}% used`}</span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-white/10 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={`h-full ${pct >= 90 ? 'bg-red-400' : 'bg-kxpurple'}`} style={{ width: `${pct}%` }} />
      </div>
      {resetsAt && <p className="text-[11.5px] text-kxmist mt-1">Resets {new Date(resetsAt).toLocaleString()}</p>}
    </div>
  );
}

export default function Usage() {
  useSeo({ title: 'Usage & storage — KingxTech', noindex: true });
  useRequireAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [ai, setAi] = useState(undefined); // undefined = loading, null = unavailable
  const [quota, setQuota] = useState(undefined);

  useEffect(() => {
    getStorageUsage().then(({ data, error: e }) => {
      if (e) {
        setError(/function .*my_storage_usage.* does not exist|could not find the function/i.test(e.message || '') ? 'SETUP' : friendlyError(e));
        setRows([]);
      } else setRows(data || []);
    });
    getAiUsageMeter().then(setAi);
    getStorageQuota().then(setQuota);
  }, []);

  const totals = useMemo(() => {
    const list = rows || [];
    const source = list.reduce((n, r) => n + Number(r.source_bytes), 0);
    const build = list.reduce((n, r) => n + Number(r.build_bytes), 0);
    return {
      source, build, all: source + build,
      projects: list.length,
      published: list.filter((r) => r.published).length,
      largest: list.reduce((n, r) => Math.max(n, Number(r.source_bytes) + Number(r.build_bytes)), 0),
    };
  }, [rows]);

  return (
    <DashboardShell>
      <h1 className="font-display text-2xl font-semibold mb-1">Usage &amp; storage</h1>
      <p className="text-kxmist text-sm mb-6">What your projects and AI use right now.</p>

      {error === 'SETUP' && (
        <Card className="p-4 rounded-xl mb-5 text-[13px] text-kxmist">
          Run <code className="text-white font-mono">supabase/migrations/040_storage_usage.sql</code> in your Supabase SQL Editor to enable storage numbers.
        </Card>
      )}
      {error && error !== 'SETUP' && <p className="text-[12.5px] text-red-400 mb-4">{error}</p>}

      <div className="grid grid-cols-2 gap-3 mb-6">
        <Stat icon={HardDrive} label="Source files" value={rows === null ? '…' : formatBytes(totals.source)} />
        <Stat icon={FolderKanban} label="Projects" value={rows === null ? '…' : totals.projects} />
        <Stat icon={Globe} label="Published sites" value={rows === null ? '…' : totals.published} />
        <Stat icon={HardDrive} label="Published builds" value={rows === null ? '…' : formatBytes(totals.build)} />
      </div>

      <Card className="p-4 sm:p-6 rounded-[20px] mb-5">
        <h2 className="font-display text-[16px] font-medium mb-1 flex items-center gap-2"><HardDrive size={15} /> Your storage</h2>
        {quota === undefined && <p className="text-[13px] text-kxmist">Loading…</p>}
        {quota === null && <p className="text-[13px] text-kxmist">Your storage limit is not available right now. Try again in a moment.</p>}
        {quota && (() => {
          const known = typeof quota.usedBytes === 'number';
          const percent = known && quota.limitBytes > 0 ? (quota.usedBytes / quota.limitBytes) * 100 : 0;
          return (
            <div className="flex flex-col gap-3 mt-3">
              <p className="text-[12.5px] text-kxmist">Plan: <span className="text-white capitalize">{String(quota.tier).replace('_', ' ')}</span></p>
              <Meter
                label="Project files"
                percent={percent}
                detail={known ? `${formatBytes(quota.usedBytes)} of ${formatBytes(quota.limitBytes)}` : `Limit ${formatBytes(quota.limitBytes)}`}
              />
              <p className="text-[12px] text-kxmist leading-relaxed">Only your source files count. Published builds are shown below but do not count toward your limit.</p>
              {known && percent >= 100 && <p className="text-[13px] text-red-300">Storage is full. You can edit and delete files, but not add more until you free up space{quota.tier === 'pro_plus' ? '' : ' or upgrade'}.</p>}
              {known && percent >= 80 && percent < 100 && <p className="text-[13px] text-amber-300">You are close to your limit.</p>}
              {known && percent >= 80 && quota.tier !== 'pro_plus' && <Link to="/billing" className="text-[13px] text-kxblue underline min-h-11 inline-flex items-center">Upgrade for more space</Link>}
            </div>
          );
        })()}
      </Card>

      <Card className="p-4 sm:p-6 rounded-[20px] mb-5">
        <h2 className="font-display text-[16px] font-medium mb-1 flex items-center gap-2"><Sparkles size={15} /> AI usage</h2>
        {ai === undefined && <p className="text-[13px] text-kxmist">Loading…</p>}
        {ai === null && <p className="text-[13px] text-kxmist">AI usage is not available right now. Try again in a moment.</p>}
        {ai && (
          <div className="flex flex-col gap-4 mt-3">
            <p className="text-[12.5px] text-kxmist">Plan: <span className="text-white capitalize">{String(ai.tier).replace('_', ' ')}</span></p>
            {ai.tier === 'free'
              ? <Meter label="This month" percent={ai.weekPercent} resetsAt={ai.weekResetsAt} />
              : (
                <>
                  <Meter label="Current session" percent={ai.sessionPercent} resetsAt={ai.sessionResetsAt} />
                  <Meter label="This week" percent={ai.weekPercent} resetsAt={ai.weekResetsAt} />
                </>
              )}
          </div>
        )}
      </Card>

      <Card className="p-4 sm:p-6 rounded-[20px] mb-5">
        <h2 className="font-display text-[16px] font-medium mb-1">Storage by project</h2>
        <p className="text-[13px] text-kxmist mb-4 leading-relaxed">
          Source is your files. A published build is the finished copy that visitors get. Images and fonts count about a third more than their size on your device.
        </p>
        {rows === null && <p className="text-[13px] text-kxmist">Loading…</p>}
        {rows && rows.length === 0 && !error && (
          <p className="text-[13px] text-kxmist">No projects yet. <Link to="/projects" className="text-kxblue underline">Create your first project</Link>.</p>
        )}
        <div className="flex flex-col gap-3">
          {rows?.map((r) => {
            const total = Number(r.source_bytes) + Number(r.build_bytes);
            const width = totals.largest > 0 ? Math.max(2, Math.round((total / totals.largest) * 100)) : 0;
            return (
              <div key={r.project_id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <div className="flex items-start justify-between gap-3">
                  <Link to={`/projects/${r.project_id}/workspace`} className="text-[14px] font-medium break-words min-w-0 hover:underline">{r.project_name}</Link>
                  <Badge tone={r.published ? 'live' : 'default'}>{r.published ? 'published' : 'draft'}</Badge>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-kxpurple" style={{ width: `${width}%` }} /></div>
                <p className="text-[12px] text-kxmist mt-2">
                  {formatBytes(total)} total · source {formatBytes(r.source_bytes)} · published build {formatBytes(r.build_bytes)} · {r.file_count} file{Number(r.file_count) === 1 ? '' : 's'}
                </p>
              </div>
            );
          })}
        </div>
      </Card>
    </DashboardShell>
  );
}
