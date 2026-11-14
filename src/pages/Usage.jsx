import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HardDrive, FolderKanban, Globe, Sparkles, Server } from 'lucide-react';
import DashboardShell from '../components/DashboardShell';
import { Card, Badge, SkeletonLines, SkeletonRows } from '../components/ui';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import { getStorageUsage, getAiUsageMeter, getStorageQuota } from '../lib/storageUsage';
import { getServerOverview } from '../lib/serverUsage';
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
        <div className={`h-full ${pct >= 90 ? 'bg-red-400' : pct >= 80 ? 'bg-amber-400' : 'bg-kxpurple'}`} style={{ width: `${pct}%` }} />
      </div>
      {resetsAt && <p className="text-[11.5px] text-kxmist mt-1">Resets {new Date(resetsAt).toLocaleString()}</p>}
    </div>
  );
}

const hours = (ms) => {
  const h = (Number(ms) || 0) / 3600000;
  return `${h >= 10 ? Math.round(h) : Math.round(h * 10) / 10} h`;
};
const dateText = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : 'next month');
const STATE_TEXT = { RUNNING: 'running', STARTING: 'starting', STOPPED: 'asleep', FAILED: 'failed', STOPPING: 'stopping' };

function ServerProject({ p }) {
  const botShare = p.hits && p.hits.total > 0 ? Math.round((p.hits.bot / p.hits.total) * 100) : 0;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-start justify-between gap-3">
        <Link to={`/projects/${p.projectId}/workspace`} className="text-[14px] font-medium break-words min-w-0 hover:underline">{p.name}</Link>
        <Badge tone={p.paused ? 'beta' : p.state === 'RUNNING' ? 'live' : 'default'}>{p.paused ? 'paused' : (STATE_TEXT[p.state] || String(p.state).toLowerCase())}</Badge>
      </div>
      <div className="mt-3">
        <Meter label="This project's hours" percent={p.hours.percent} detail={p.hours.limit ? `${hours(p.hours.used)} of ${hours(p.hours.limit)}` : hours(p.hours.used)} />
      </div>
      {p.hits && p.hits.total > 0 ? (
        <div className="mt-3 text-[12px] text-kxmist">
          <p>{p.hits.total.toLocaleString()} request{p.hits.total === 1 ? '' : 's'} this month{p.hits.bot > 0 ? ` · ${botShare}% from bots, monitors or scripts` : ''}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {p.hits.top.map((t) => (
              <li key={t.path} className="flex items-baseline justify-between gap-3">
                <code className="font-mono text-white/90 break-all min-w-0">{t.path}</code>
                <span className="shrink-0">{t.hits.toLocaleString()}{t.errors > 0 ? ` · ${t.errors.toLocaleString()} failed` : ''}</span>
              </li>
            ))}
          </ul>
          {p.hits.total >= 100 && botShare >= 50 && (
            <p className="mt-2 text-amber-300 leading-relaxed">Most requests come from bots, monitors or scripts. Every request wakes the server and keeps it awake, so these use your hours.</p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-kxmist">No requests counted yet this month.</p>
      )}
    </div>
  );
}

function ServerUsageCard({ data }) {
  return (
    <Card className="p-4 sm:p-6 rounded-[20px] mb-5">
      <h2 className="font-display text-[16px] font-medium mb-1 flex items-center gap-2"><Server size={15} /> Server usage</h2>
      {data === undefined && <SkeletonLines lines={3} className="mt-3" label="Loading server usage" />}
      {data === null && <p className="text-[13px] text-kxmist">Server usage is not available right now. Try again in a moment.</p>}
      {data && data.notAllowed && (
        <p className="text-[13px] text-kxmist mt-1">Project servers are part of the Pro plan. <Link to="/billing" className="text-kxblue underline">See plans</Link>.</p>
      )}
      {data && data.overview && (() => {
        const o = data.overview;
        const resets = dateText(o.period.resetsAt);
        return (
          <div className="flex flex-col gap-4 mt-3">
            <p className="text-[12.5px] text-kxmist">Plan: <span className="text-white capitalize">{String(o.tier).replace('_', ' ')}</span> · Resets {resets}</p>
            {o.status === 'paused' && (
              <div className="rounded-xl border border-red-400/30 bg-red-400/5 p-3 text-[13px] text-red-300 leading-relaxed">
                Your servers are paused until {resets}. Visitors see a "paused" page, and they wake up on their own after the reset.
                {' '}<Link to="/help" className="underline text-kxblue">Ask for more allowance</Link>
              </div>
            )}
            {o.status === 'warning' && (
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-[13px] text-amber-300 leading-relaxed">
                {o.projects.some((p) => p.paused)
                  ? `A project has used its hours and is paused until ${resets}.`
                  : `You have used ${Math.floor(o.worstPercent)}% of an allowance. At 100% your servers pause until ${resets}.`}
              </div>
            )}
            <Meter label="Server hours (all projects)" percent={o.meters.hours.percent} detail={o.meters.hours.limit ? `${hours(o.meters.hours.used)} of ${hours(o.meters.hours.limit)}` : hours(o.meters.hours.used)} />
            <Meter label="Processing time" percent={o.meters.cpu.percent} detail={o.meters.cpu.limit ? `${hours(o.meters.cpu.used)} of ${hours(o.meters.cpu.limit)}` : hours(o.meters.cpu.used)} />
            <Meter label="Data sent" percent={o.meters.egress.percent} detail={o.meters.egress.limit ? `${formatBytes(o.meters.egress.used)} of ${formatBytes(o.meters.egress.limit)}` : formatBytes(o.meters.egress.used)} />
            <p className="text-[12px] text-kxmist leading-relaxed">A server counts hours while it is awake. It sleeps after 10 minutes with no requests, so steady traffic keeps it awake all day.</p>
            <div>
              <h3 className="text-[13.5px] font-medium mb-2">By project</h3>
              {o.projects.length === 0
                ? <p className="text-[13px] text-kxmist">No project has a server turned on yet.</p>
                : <div className="flex flex-col gap-3">{o.projects.map((p) => <ServerProject key={p.projectId} p={p} />)}</div>}
            </div>
          </div>
        );
      })()}
    </Card>
  );
}

export default function Usage() {
  useSeo({ title: 'Usage & storage — KingxTech', noindex: true });
  useRequireAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [ai, setAi] = useState(undefined); // undefined = loading, null = unavailable
  const [quota, setQuota] = useState(undefined);
  const [server, setServer] = useState(undefined); // undefined = loading, null = unavailable

  useEffect(() => {
    getStorageUsage().then(({ data, error: e }) => {
      if (e) {
        setError(/function .*my_storage_usage.* does not exist|could not find the function/i.test(e.message || '') ? 'SETUP' : friendlyError(e));
        setRows([]);
      } else setRows(data || []);
    });
    getAiUsageMeter().then(setAi);
    getStorageQuota().then(setQuota);
    getServerOverview().then(setServer);
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
        {quota === undefined && <SkeletonLines lines={3} className="mt-3" label="Loading storage" />}
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
        {ai === undefined && <SkeletonLines lines={3} className="mt-3" label="Loading AI usage" />}
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

      <ServerUsageCard data={server} />

      <Card className="p-4 sm:p-6 rounded-[20px] mb-5">
        <h2 className="font-display text-[16px] font-medium mb-1">Storage by project</h2>
        <p className="text-[13px] text-kxmist mb-4 leading-relaxed">
          Source is your files. A published build is the finished copy that visitors get. Images and fonts count about a third more than their size on your device.
        </p>
        {rows === null && <SkeletonRows rows={3} label="Loading projects" />}
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
