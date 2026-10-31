import { useCallback, useEffect, useState } from 'react';
import { Server, Copy, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, Button, SkeletonLines } from './ui';
import { getProjectServer, saveProjectServer, startProjectServer } from '../lib/projectFiles';
import { friendlyError } from '../lib/errors';
import { copyText } from '../lib/copyText';

const snippetFor = (projectId) => `// server.js (in your project)
import express from 'express';
const app = express();
app.use(express.json());
app.get('/hello', (req, res) => res.json({ message: 'Hello from my server!' }));
app.listen(process.env.PORT || 3000, '0.0.0.0');

// package.json needs:  "scripts": { "start": "node server.js" }

// In your site's JavaScript:
const res = await fetch('/api/public/server/${projectId}/hello');
const data = await res.json();`;

export default function SiteServerCard({ projectId }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try { setInfo(await getProjectServer(projectId)); setError(''); }
    catch (err) { setError(friendlyError(err)); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const toggle = async (enabled) => {
    setBusy(true); setError(''); setNotice(''); setLogs('');
    try { const d = await saveProjectServer(projectId, { enabled }); setInfo((i) => ({ ...i, settings: d.settings })); setNotice(enabled ? 'Server turned on. It wakes up the first time someone calls it.' : 'Server turned off.'); }
    catch (err) { setError(friendlyError(err)); } finally { setBusy(false); }
  };

  const start = async () => {
    setStarting(true); setError(''); setNotice(''); setLogs('');
    try { await startProjectServer(projectId); setNotice('Your server is running.'); }
    catch (err) { setError(friendlyError(err)); setLogs(err.logs || ''); } finally { setStarting(false); }
  };

  return (
    <Card className="p-4 rounded-xl">
      <div className="flex items-center gap-2 mb-1">
        <Server size={15} className="text-kxpink" />
        <h3 className="text-[14px] font-semibold">Server for your site <span className="ml-1 text-[10px] font-mono uppercase text-kxmist border border-white/15 rounded px-1.5 py-0.5">Pro</span></h3>
      </div>
      <p className="text-[11.5px] text-kxmist leading-relaxed">
        Run your own Node server (an API) for things the browser can't do, like private keys, payments and custom logic. It goes to sleep when nobody is using it and wakes up in a few seconds on the next request.
      </p>
      {error && <p className="mt-3 text-[12px] text-red-300">{error}</p>}
      {notice && <p className="mt-3 text-[12px] text-green-300">{notice}</p>}
      {logs && <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[11px] text-red-200 whitespace-pre-wrap">{logs}</pre>}
      {!info && !error && <SkeletonLines lines={2} className="mt-3" label="Loading server settings" />}
      {info && (
        <div className="mt-3 flex flex-col gap-3">
          {!info.planAllowed && (
            <p className="text-[12px] text-amber-300">Project servers are part of the Pro plan. <Link to="/billing" className="underline">Upgrade in Billing</Link> to turn this on.</p>
          )}
          <label className="flex items-center gap-2 min-h-11 text-[13px]">
            <input type="checkbox" checked={info.settings.enabled} disabled={busy || (!info.planAllowed && !info.settings.enabled)} onChange={(e) => toggle(e.target.checked)} />
            Turn on the server for this project
          </label>
          {info.settings.enabled && (
            <Button variant="subtle" className="self-start" onClick={start} loading={starting}>Wake it up now and test</Button>
          )}
          <div className="rounded-lg border border-white/10 bg-black/40">
            <div className="flex items-center justify-between pl-3 pr-1 border-b border-white/10">
              <span className="py-1 text-[10px] font-mono uppercase tracking-wider text-kxmist/60">Example</span>
              <button type="button" onClick={async () => { if (await copyText(snippetFor(projectId))) { setCopied(true); setTimeout(() => setCopied(false), 1600); } }}
                className="inline-flex items-center gap-1 min-h-8 px-2 rounded-md text-[10.5px] text-kxmist hover:text-white hover:bg-white/10">
                {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}{copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="px-3 py-2 overflow-x-auto text-[11.5px] leading-relaxed text-green-400 font-mono">{snippetFor(projectId)}</pre>
          </div>
          <ul className="text-[11.5px] text-kxmist leading-relaxed list-disc pl-4 space-y-1">
            <li>Your server must listen on <span className="font-mono">process.env.PORT</span> and have a <span className="font-mono">start</span> script.</li>
            <li>Anyone can call your server's address, like any website API. Protect private actions with your own login token.</li>
            <li>Cookies are not passed through and redirects are not followed. Replies are limited to 5 MB and 25 seconds.</li>
            <li>No live connections (websockets) yet. The first call after a quiet period takes a few seconds.</li>
            <li>Secrets belong in Site Settings → variables, never in your code.</li>
          </ul>
        </div>
      )}
    </Card>
  );
}
