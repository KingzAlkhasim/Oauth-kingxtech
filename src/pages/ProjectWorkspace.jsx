import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import DashboardShell from '../components/DashboardShell';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import { Card, Button, Input } from '../components/ui';
import {
  listFiles, readFile, writeFile, createFolder, deleteFile, revertFile,
  previewUrl, publishProject, PublishError, getSiteViews, listSnapshots, saveSnapshot, restoreSnapshot, deleteSnapshot, runTerminalCommand, startProjectRuntime, syncProjectRuntime,
} from '../lib/projectFiles';
import { friendlyPublishError } from '../lib/publishErrors';
import { formatBytes } from '../lib/formatBytes';
import { getProjectRepoLink, pushProjectToGithub, importRepoFromGithub } from '../lib/github';
import { listProjectEnvVars, setProjectEnvVar, deleteProjectEnvVar } from '../lib/projectEnvVars';
import { runSecurityCheck } from '../lib/securityCheck';
import { getBillingProfile } from '../lib/billing';
import { siteUrl } from '../lib/apiBase';
import { supabase } from '../lib/supabase';
import { getProjectPwa, setProjectPwa, uploadProjectPwaIcon, removeProjectPwaIcon } from '../lib/projectPwa';
import ShareSettingsCard from '../components/ShareSettingsCard';
import CodeMirror from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import {
  File as FileIcon,
  FileImage,
  Folder,
  FolderPlus,
  FilePlus,
  Trash2,
  Save,
  RefreshCw,
  Undo2,
  Copy,
  ExternalLink,
  Code2,
  Eye,
  Rocket,
  TerminalSquare,
  Upload,
  Download,
  Maximize2,
  Minimize2,
  FolderInput,
  SlidersHorizontal,
  Info,
  Plus,
  ChevronRight,
  ChevronDown,
  PanelLeft,
  PanelLeftClose,
  Shield,
  Lock,
  Loader2,
} from 'lucide-react';
import { friendlyError } from '../lib/errors';

function Github({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2.1c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.4-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2A11 11 0 0112 5.8c1 0 2 .1 3 .4 2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.9 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A11.5 11.5 0 0023.5 12C23.5 5.7 18.3.5 12 .5z" /></svg>
  );
}

/** Picks a CodeMirror language extension based on the file's extension. */
function languageForPath(path) {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'html' || ext === 'htm') return html();
  if (ext === 'css') return css();
  if (ext === 'jsx') return javascript({ jsx: true });
  if (ext === 'tsx') return javascript({ jsx: true, typescript: true });
  if (ext === 'ts') return javascript({ typescript: true });
  if (ext === 'js' || ext === 'mjs') return javascript();
  if (ext === 'json') return javascript(); // close enough for highlighting, no dedicated json mode needed here
  return null;
}

const BINARY_PREFIX = '__KX_BINARY_BASE64__:';
const BINARY_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'woff', 'woff2', 'ttf', 'otf', 'pdf']);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'svg']);
const ASSET_EXTS = new Set([...BINARY_EXTS, 'svg']);
const UNSUPPORTED_BINARY_EXTS = new Set(['eot', 'mp4', 'mp3', 'zip', 'wasm']);
const MAX_LOCAL_IMPORT_FILES = 300;
const MAX_LOCAL_IMPORT_BYTES = 5 * 1024 * 1024;
function extensionOf(path) { return path.split('/').pop()?.split('.').pop()?.toLowerCase() || ''; }
function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function mimeForPath(path) {
  const ext = extensionOf(path);
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', svg: 'image/svg+xml', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', pdf: 'application/pdf' })[ext] || 'application/octet-stream';
}
function isUnsafeSvg(text) { return /<script\b/i.test(text) || /\bon[a-z][a-z0-9_-]*\s*=/i.test(text) || /javascript\s*:/i.test(text); }
function formatFileSize(bytes) { return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`; }
function isProbablyBinary(buffer) {
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) {
    const value = bytes[i];
    if (value === 0) return true;
    if (value < 0x20 && value !== 0x09 && value !== 0x0a && value !== 0x0c && value !== 0x0d) return true;
  }
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return false; }
  catch { return true; }
}

/** Turns the flat [{path, is_folder}] list into a nested tree for rendering. */
function buildTree(files) {
  const root = { name: '', children: {}, isFolder: true };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      if (!node.children[part]) {
        node.children[part] = {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          isFolder: isLast ? f.is_folder : true,
          children: {},
        };
      }
      node = node.children[part];
    });
  }
  return root;
}

function TreeNode({ node, depth, selectedPath, onSelect, onDelete, collapsed, onToggleFolder }) {
  const entries = Object.values(node.children).sort((a, b) =>
    a.isFolder === b.isFolder ? a.name.localeCompare(b.name) : a.isFolder ? -1 : 1
  );

  return (
    <>
      {entries.map((child) => {
        const hasChildren = child.isFolder && Object.keys(child.children).length > 0;
        const isOpen = !collapsed.has(child.path);
        return (
          <div key={child.path}>
            <div
              className={`group flex items-center justify-between gap-1 px-2 py-1.5 rounded-lg text-[13px] cursor-pointer transition-colors duration-150 hover:bg-white/5 ${
                selectedPath === child.path ? 'bg-white/8 text-white' : 'text-kxmist'
              }`}
              style={{ paddingLeft: `${depth * 14 + 8}px` }}
              onClick={() => (child.isFolder ? onToggleFolder(child.path) : onSelect(child.path))}
            >
              <span className="flex items-center gap-1 min-w-0 flex-1">
                {child.isFolder ? (
                  hasChildren ? (
                    isOpen ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />
                  ) : (
                    <span className="w-3 shrink-0" />
                  )
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <span className="flex items-center gap-1.5 truncate">
                  {child.isFolder ? <Folder size={13} className="shrink-0" /> : (ASSET_EXTS.has(extensionOf(child.name)) ? <FileImage size={13} className="shrink-0 text-kxpurple" /> : <FileIcon size={13} className="shrink-0" />)}
                  <span className="truncate">{child.name}</span>
                </span>
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(child.path);
                }}
                className="opacity-40 md:opacity-0 md:group-hover:opacity-100 shrink-0 text-kxmist hover:text-red-400 p-1 -m-1"
                title={`Delete ${child.isFolder ? 'folder' : 'file'}`}
              >
                <Trash2 size={12} />
              </button>
            </div>
            {child.isFolder && hasChildren && isOpen && (
              <TreeNode
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
                onDelete={onDelete}
                collapsed={collapsed}
                onToggleFolder={onToggleFolder}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

const ALLOWED_COMMANDS_HINT = 'git status|log|diff|branch, npm test|run|ls|lint, node --version, tsc --noEmit, ls, pwd';

function TerminalTab({ projectId, publishedUrl }) {
  const [lines, setLines] = useState([]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [runtime, setRuntime] = useState(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeError, setRuntimeError] = useState('');
  const [githubLink, setGithubLink] = useState(null);
  const [isPushing, setIsPushing] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    getProjectRepoLink(projectId).then(setGithubLink).catch(() => setGithubLink(null));
  }, [projectId]);

  useEffect(() => {
    startProjectRuntime(projectId)
      .then((result) => {
        setRuntime(result);
        setRuntimeError('');
        setLines((l) => [...l, { type: 'out', text: `Sandbox ready: ${result.framework} / ${result.packageManager}` }]);
      })
      .catch((err) => setRuntimeError(friendlyError(err)));
  }, [projectId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  const startRuntime = async () => {
    setRuntimeLoading(true);
    setRuntimeError('');
    try {
      const result = await startProjectRuntime(projectId);
      setRuntime(result);
      setLines((l) => [...l, { type: 'out', text: `Runtime started: ${result.url}` }]);
    } catch (err) {
      setRuntimeError(friendlyError(err));
      setLines((l) => [...l, { type: 'err', text: err.message }]);
    } finally {
      setRuntimeLoading(false);
    }
  };

  const syncRuntime = async () => {
    setRuntimeLoading(true);
    setRuntimeError('');
    try {
      const result = await syncProjectRuntime(projectId);
      setLines((l) => [...l, { type: 'out', text: `Synced ${result.fileCount} file(s) into the sandbox.` }]);
      const refreshed = await startProjectRuntime(projectId);
      setRuntime(refreshed);
      setLines((l) => [...l, { type: 'out', text: `Preview: ${refreshed.url}` }]);
    } catch (err) {
      setRuntimeError(friendlyError(err));
      setLines((l) => [...l, { type: 'err', text: err.message }]);
    } finally {
      setRuntimeLoading(false);
    }
  };

  const run = async (e) => {
    e.preventDefault();
    const raw = input.trim();
    if (!raw || isRunning) return;
    setInput('');
    const [command, ...args] = raw.split(/\s+/);
    setLines((l) => [...l, { type: 'cmd', text: raw }]);
    setIsRunning(true);
    try {
      const { ok, output } = await runTerminalCommand(projectId, command, args);
      setLines((l) => [...l, { type: ok ? 'out' : 'err', text: output }]);
    } catch (err) {
      setLines((l) => [...l, { type: 'err', text: err.message }]);
    } finally {
      setIsRunning(false);
    }
  };

  const pushToGithub = async () => {
    if (!githubLink) return;
    const commitMessage = prompt('Commit message:', 'Update from KingxTech workspace');
    if (commitMessage === null) return;
    setIsPushing(true);
    setLines((l) => [...l, { type: 'cmd', text: `push to ${githubLink.repo_full_name} (${githubLink.branch})` }]);
    try {
      const { commitUrl, filesChanged, filesSkipped } = await pushProjectToGithub(projectId, commitMessage);
      setLines((l) => [...l, { type: 'out', text: `Pushed ${filesChanged} file(s); skipped ${filesSkipped} generated/dependency file(s). ${commitUrl}` }]);
    } catch (err) {
      setLines((l) => [...l, { type: 'err', text: err.message }]);
    } finally {
      setIsPushing(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div>
          <p className="text-[11px] text-kxmist font-mono">Sandbox terminal — isolated per project</p>
          <p className="text-[10px] text-kxmist opacity-70">Node/Vite/React/TypeScript/Express commands run inside the project runtime.</p>
        </div>
        <div className="flex flex-wrap gap-2 w-full">
          {runtime?.url && (
            <a href={runtime.url} target="_blank" rel="noreferrer" className="flex-1 min-w-[120px] flex items-center justify-center gap-1.5 text-[12px] px-2.5 py-1 rounded-md border border-kxblue/30 text-kxblue hover:bg-kxblue/10">
              <ExternalLink size={12} /> Open Preview
            </a>
          )}
          <Button variant="ghost" className="flex-1 min-w-[120px]" onClick={syncRuntime} loading={runtimeLoading}>Sync & Restart</Button>
          <Button variant="glow" className="flex-1 min-w-[120px]" onClick={startRuntime} loading={runtimeLoading}>Start Runtime</Button>
        </div>
      </div>

      {runtime && (
        <div className="mb-2 rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2 text-[11px] font-mono text-green-300 break-all">
          ● {runtime.framework} · {runtime.packageManager} ·{' '}
          {publishedUrl ? (
            <>
              <a href={publishedUrl} target="_blank" rel="noreferrer" className="text-green-200 hover:text-white underline underline-offset-2">
                {publishedUrl}
              </a>
              <span className="ml-2 inline-flex max-w-full items-center gap-1 text-[10px] text-kxmist/70">
                · <a href={runtime.url} target="_blank" rel="noreferrer" className="truncate hover:text-white" title={runtime.url}>
                  Live dev preview
                </a>
              </span>
            </>
          ) : (
            <a href={runtime.url} target="_blank" rel="noreferrer" className="hover:text-white underline underline-offset-2">
              {runtime.url}
            </a>
          )}
        </div>
      )}
      {runtimeError && (
        <div className="mb-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[12px] text-red-300">
          {runtimeError}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-black/50 rounded-lg border border-white/10 p-3 font-mono text-[12.5px] space-y-1.5">
        {lines.length === 0 && <p className="text-kxmist opacity-60">The isolated project terminal is ready.</p>}
        {lines.map((l, i) => (
          <div key={i} className={l.type === 'cmd' ? 'text-white' : l.type === 'err' ? 'text-red-400' : 'text-green-400'}>
            {l.type === 'cmd' && <span className="text-kxpurple">$ </span>}
            <span className="whitespace-pre-wrap break-words">{l.text}</span>
          </div>
        ))}
      </div>

      <form onSubmit={run} className="flex items-center gap-2 mt-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isRunning ? 'Running…' : 'npm run build'}
          disabled={isRunning || runtimeLoading}
          className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[13px] font-mono text-kxmist outline-none focus:border-kxblue"
        />
        <Button type="submit" disabled={isRunning || runtimeLoading || !input.trim()}>Run</Button>
      </form>

      <p className="text-[10px] text-kxmist mt-2">
        Allowed: npm · pnpm · yarn · bun · node · npx · git · tsc · vite · ls · pwd · cat
      </p>

      <div className="flex justify-end mt-2">
        {githubLink ? (
          <button
            onClick={pushToGithub}
            disabled={isPushing}
            className="flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-md bg-kx-gradient disabled:opacity-50"
          >
            <Upload size={12} /> {isPushing ? 'Pushing…' : `Push to ${githubLink.repo_full_name}`}
          </button>
        ) : (
          <span className="text-[11px] text-kxmist">No GitHub repo linked — link one in Console → Credentials.</span>
        )}
      </div>
    </div>
  );
}

function SettingsGroupLabel({ children }) {
  return <h2 className="pt-2 text-[11px] font-mono uppercase tracking-wider text-kxmist">{children}</h2>;
}

function SiteViewsCard({ projectId }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setStats(await getSiteViews(projectId)); } catch (err) { setError(friendlyError(err)); }
    setLoading(false);
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const max = stats ? Math.max(1, ...stats.daily.map((d) => d.views)) : 1;
  const fmt = (n) => Number(n).toLocaleString();
  return (
    <Card className="p-4 rounded-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold">Visits</h3>
          <p className="text-[11.5px] text-kxmist mt-0.5 leading-relaxed">Page views of your published site.</p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="min-h-11 px-3 text-[12px] text-kxmist hover:text-white disabled:opacity-50">{loading ? 'Loading…' : 'Refresh'}</button>
      </div>
      {error && <p className="text-[12.5px] text-red-400 mt-2">{error}</p>}
      {stats && (
        <>
          <div className="grid grid-cols-4 gap-2 mt-3 text-center">
            {[['Today', stats.today], ['7 days', stats.last7], ['30 days', stats.last30], ['All time', stats.total]].map(([label, n]) => (
              <div key={label} className="rounded-lg border border-white/10 bg-white/[0.02] py-2 min-w-0">
                <p className="font-display text-[17px] leading-tight break-words">{fmt(n)}</p>
                <p className="text-[10.5px] text-kxmist">{label}</p>
              </div>
            ))}
          </div>
          {stats.total === 0 ? (
            <p className="text-[12px] text-kxmist mt-3">No visits yet. Publish your site and share the link, and visits will show up here.</p>
          ) : (
            <div className="mt-3 flex items-end gap-1 h-16" role="img" aria-label="Visits per day for the last 14 days">
              {stats.daily.map((d) => (
                <div key={d.day} title={`${d.day}: ${d.views}`} className="flex-1 rounded-t bg-kxpurple/80 min-h-[2px]" style={{ height: `${Math.max(3, Math.round((d.views / max) * 100))}%`, opacity: d.views === 0 ? 0.25 : 1 }} />
              ))}
            </div>
          )}
          <p className="text-[11px] text-kxmist mt-3 leading-relaxed">Counts page loads in real browsers. No cookies or IP addresses are stored. Bots and your own previews are not counted, and numbers are approximate. Days use UTC time.</p>
        </>
      )}
    </Card>
  );
}

function RestorePointsCard({ projectId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try { setData(await listSnapshots(projectId)); setError(''); } catch (err) { setError(friendlyError(err)); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const run = async (key, action, success) => {
    setBusy(key); setError(''); setNotice('');
    try { const result = await action(); setNotice(typeof success === 'function' ? success(result) : success); await load(); return true; }
    catch (err) { setError(friendlyError(err)); return false; }
    finally { setBusy(''); }
  };

  const saveNow = () => run('save', () => saveSnapshot(projectId, 'Manual'), (r) => (r.created ? 'Restore point saved.' : 'Nothing has changed since your latest restore point.'));
  const restore = async (snap) => {
    if (!window.confirm(`Restore "${snap.label}" from ${new Date(snap.created_at).toLocaleString()}?\n\nYour current files will be replaced. Your current version is saved first, so you can undo this.`)) return;
    const ok = await run(`restore-${snap.id}`, () => restoreSnapshot(projectId, snap.id), (r) => `Restored ${r.restoredFiles} file(s). Publish again to put this version live.`);
    if (ok) window.dispatchEvent(new CustomEvent('kxpert:files-changed', { detail: { projectId } }));
  };
  const remove = (snap) => {
    if (!window.confirm('Delete this restore point? This cannot be undone.')) return;
    return run(`delete-${snap.id}`, () => deleteSnapshot(projectId, snap.id), 'Restore point deleted.');
  };

  return (
    <Card className="p-4 rounded-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold">Restore points</h3>
          <p className="text-[11.5px] text-kxmist mt-0.5 leading-relaxed">
            A copy of your files is saved every time you publish. Go back to an earlier version if an edit or an AI change goes wrong.
          </p>
        </div>
        <button type="button" onClick={saveNow} disabled={busy !== ''} className="shrink-0 min-h-11 px-3 text-[12px] rounded-lg border border-white/12 text-kxmist hover:text-white disabled:opacity-50">{busy === 'save' ? 'Saving…' : 'Save now'}</button>
      </div>
      {error && <p className="text-[12.5px] text-red-400 mt-2">{error}</p>}
      {notice && <p className="text-[12.5px] text-emerald-300 mt-2">{notice}</p>}
      {data === null && !error && <p className="text-[12.5px] text-kxmist mt-3">Loading…</p>}
      {data && data.snapshots.length === 0 && (
        <p className="text-[12px] text-kxmist mt-3">No restore points yet. One is saved automatically the next time you publish.</p>
      )}
      <div className="flex flex-col gap-2 mt-3">
        {data?.snapshots.map((snap) => (
          <div key={snap.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <p className="text-[13px] font-medium break-words">{snap.label}</p>
            <p className="text-[11.5px] text-kxmist">{new Date(snap.created_at).toLocaleString()} · {snap.file_count} file{snap.file_count === 1 ? '' : 's'} · {formatBytes(snap.bytes)}</p>
            <div className="flex gap-2 mt-2">
              <button type="button" onClick={() => restore(snap)} disabled={busy !== ''} className="min-h-11 px-3 text-[12.5px] rounded-lg border border-white/12 hover:border-white/30 disabled:opacity-50">{busy === `restore-${snap.id}` ? 'Restoring…' : 'Restore'}</button>
              <button type="button" onClick={() => remove(snap)} disabled={busy !== ''} className="min-h-11 px-3 text-[12.5px] rounded-lg text-kxmist hover:text-red-300 disabled:opacity-50">Delete</button>
            </div>
          </div>
        ))}
      </div>
      {data && <p className="text-[11px] text-kxmist mt-3 leading-relaxed">Your plan keeps the latest {data.keep} restore points. Older ones are removed automatically. They do not use your storage limit.</p>}
    </Card>
  );
}

function SiteSettingsTab({ projectId }) {
  const [vars, setVars] = useState(null);
  const [error, setError] = useState('');
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState({});
  const [isPro, setIsPro] = useState(null);
  const [scRunning, setScRunning] = useState(false);
  const [scError, setScError] = useState('');
  const [scResult, setScResult] = useState(null);
  const [pwaEnabled, setPwaEnabled] = useState(false);
  const [pwaLoading, setPwaLoading] = useState(true);
  const [pwaSaving, setPwaSaving] = useState(false);
  const [pwaIconUrl, setPwaIconUrl] = useState(null);
  const [pwaIconBusy, setPwaIconBusy] = useState(false);
  const pwaIconInputRef = useRef(null);

  useEffect(() => {
    getBillingProfile().then(({ data }) => setIsPro(!!data?.is_pro_member));
    getProjectPwa(projectId)
      .then((pwa) => {
        setPwaEnabled(!!pwa?.enabled);
        setPwaIconUrl(pwa?.customIconUrl || null);
      })
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setPwaLoading(false));
  }, [projectId]);

  const togglePwa = async (enabled) => {
    const confirmed = confirm(enabled
      ? 'Enable Install as App for this published site? KingxTech will add a scoped PWA manifest and service worker without changing your project files.'
      : 'Disable Install as App for this published site? New visits will stop registering the PWA. Existing installed app icons cannot be removed remotely.');
    if (!confirmed) return;
    setPwaSaving(true);
    setError('');
    try {
      await setProjectPwa(projectId, enabled);
      setPwaEnabled(enabled);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setPwaSaving(false);
    }
  };

  const uploadIcon = async (file) => {
    if (!file) return;
    if (file.type !== 'image/png') {
      setError('Icon must be a PNG image. SVG and all other file types are not supported.');
      return;
    }
    if (file.size > 1024 * 1024) {
      setError('Icon must be 1 MB or smaller.');
      return;
    }

    setPwaIconBusy(true);
    setError('');
    try {
      const data = await uploadProjectPwaIcon(projectId, file);
      setPwaIconUrl((data.customIconUrl || '') + '?v=' + Date.now());
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setPwaIconBusy(false);
    }
  };

  const removeIcon = async () => {
    if (!pwaIconUrl || !confirm('Remove this custom PWA icon and return to the default KingxTech icon?')) return;
    setPwaIconBusy(true);
    setError('');
    try {
      await removeProjectPwaIcon(projectId);
      setPwaIconUrl(null);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setPwaIconBusy(false);
    }
  };

  const runSecureCheck = async () => {
    setScRunning(true);
    setScError('');
    try {
      const result = await runSecurityCheck(projectId);
      setScResult(result);
    } catch (err) {
      setScError(friendlyError(err));
    } finally {
      setScRunning(false);
    }
  };

  const refresh = useCallback(() => {
    listProjectEnvVars(projectId).then(setVars).catch((e) => setError(friendlyError(e)));
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    if (!key.trim()) return;
    setSaving(true);
    setError('');
    try {
      await setProjectEnvVar(projectId, key.trim(), value, isPublic);
      setKey('');
      setValue('');
      setIsPublic(false);
      refresh();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    try {
      await deleteProjectEnvVar(projectId, id);
      refresh();
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  return (
    <div className="flex-1 min-w-0 overflow-y-auto space-y-4">
      <SiteViewsCard projectId={projectId} />
      <ShareSettingsCard projectId={projectId} />

      <SettingsGroupLabel>App &amp; install</SettingsGroupLabel>
      <Card className="p-4 rounded-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold">Install as App</h3>
            <p className="text-[11.5px] text-kxmist mt-0.5 leading-relaxed">
              Add PWA install support to this project only. It stays off for every project until its owner enables it here.
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input type="checkbox" className="sr-only peer" checked={pwaEnabled} disabled={pwaLoading || pwaSaving} onChange={(e) => togglePwa(e.target.checked)} />
            <span className="w-11 h-6 rounded-full bg-white/10 peer-checked:bg-kxpurple transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5" />
          </label>
        </div>
        <div className="mt-3 text-[11px] text-kxmist">
          {pwaLoading ? 'Loading PWA setting…' : pwaEnabled ? 'Enabled for this project.' : 'Disabled — the published site stays a normal website.'}
        </div>

        <div className="my-4 border-t border-white/10" />

        <div className="flex flex-col gap-3 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-[14px] font-semibold min-w-0">Custom PWA icon</h3>
            <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full border border-kxpurple/30 bg-kxpurple/10 text-kxpurple">Pro</span>
          </div>
          <p className="text-[11.5px] text-kxmist leading-relaxed w-full min-w-0">Use a square PNG from 512×512 to 1024×1024, up to 1 MB.</p>
          {isPro ? (
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              {pwaIconUrl && <img src={pwaIconUrl} alt="Custom PWA icon preview" className="w-12 h-12 rounded-xl border border-white/10 object-cover bg-white shrink-0" />}
              <button type="button" disabled={pwaIconBusy} onClick={() => pwaIconInputRef.current?.click()} className="text-[12px] px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-kxmist hover:text-white disabled:opacity-50">
                {pwaIconBusy ? 'Uploading…' : 'Upload icon'}
              </button>
              {pwaIconUrl && <button type="button" disabled={pwaIconBusy} onClick={removeIcon} className="text-[12px] text-red-300 hover:text-red-200 disabled:opacity-50">Remove icon</button>}
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-2 min-w-0">
              <div className="flex items-center gap-2 min-w-0 text-[11.5px] text-kxmist">
                <Lock size={13} className="text-kxpurple shrink-0" />
                <span className="min-w-0">Custom icon is a Pro feature</span>
              </div>
              <a href="/billing" className="text-[12px] text-kxpurple hover:text-white underline underline-offset-2">Upgrade in Billing</a>
            </div>
          )}
        </div>
        <input ref={pwaIconInputRef} type="file" accept="image/png" className="hidden" onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          uploadIcon(file);
        }} />
      </Card>

      <SettingsGroupLabel>Secrets &amp; environment</SettingsGroupLabel>
      <Card className="p-4 rounded-xl">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-[14px] font-semibold">Environment variables &amp; secrets</h3>
            <p className="text-[11.5px] text-kxmist mt-0.5">Private by default, hidden until you reveal them. Injected into this project's runtime.</p>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-kxmist">Project only</span>
        </div>

        <div className="flex items-start gap-2 text-[12px] text-kxmist leading-relaxed mb-3">
          <Info size={13} className="mt-0.5 shrink-0" />
          <p>
            Variables belong only to this project. Public variables are exposed to the published site through{' '}
            <code className="text-white">window.KX_ENV</code>. Never mark a secret as public.
          </p>
        </div>

        {error && (
          <p className="text-[12.5px] text-red-400 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 mb-3">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2 mb-4">
          {vars === null && <p className="text-[13px] text-kxmist">Loading…</p>}
          {vars?.length === 0 && <p className="text-[13px] text-kxmist">No variables set for this project yet.</p>}
          {vars?.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
              <div className="font-mono text-[13px] flex items-center gap-2 min-w-0">
                <span className="text-kxblue truncate">{v.key}</span>
                <span className="text-kxmist">=</span>
                <span className="truncate">{revealed[v.id] ? v.value : '••••••••'}</span>
                {v.is_public && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-sans shrink-0">Public</span>}
              </div>
              <div className="flex items-center gap-3 text-kxmist shrink-0">
                <button onClick={() => setRevealed((r) => ({ ...r, [v.id]: !r[v.id] }))} className="text-[11.5px] hover:text-white">
                  {revealed[v.id] ? 'Hide' : 'Reveal'}
                </button>
                <button onClick={() => remove(v.id)} className="hover:text-red-400" title="Delete variable"><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto_auto] items-end gap-3">
          <Input label="Key" value={key} onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))} placeholder="API_URL" />
          <Input label="Value" value={value} onChange={(e) => setValue(e.target.value)} />
          <label className="flex items-center gap-1.5 text-[12px] text-kxmist pb-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
            Public
          </label>
          <Button variant="glow" onClick={save} loading={saving} disabled={!key.trim()}><Plus size={14} /> Set</Button>
        </div>
      </Card>

      <SettingsGroupLabel>Versions</SettingsGroupLabel>
      <RestorePointsCard projectId={projectId} />

      <SettingsGroupLabel>Security</SettingsGroupLabel>
      <Card className="p-4 rounded-xl">
        <div className="flex items-center gap-2 mb-1">
          <Shield size={15} className="text-kxblue" />
          <h3 className="text-[14px] font-semibold">SecureCheck</h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-kxblue/15 text-kxblue font-sans">Pro</span>
        </div>
        <p className="text-[12.5px] text-kxmist mb-3 leading-relaxed">
          Dual-model security review for secrets, missing auth checks, injection risks, and similar issues.
        </p>

        {isPro === false && (
          <div className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3.5 py-3 text-[12.5px] text-kxmist">
            <Lock size={13} className="shrink-0 mt-0.5" />
            <span>SecureCheck is available on the Pro plan. <a href="/billing" className="text-kxblue hover:underline">Upgrade to run it</a>.</span>
          </div>
        )}

        {isPro === true && (
          <>
            <Button variant="glow" onClick={runSecureCheck} loading={scRunning}>
              <Shield size={14} /> Run SecureCheck
            </Button>

            {scError && <p className="text-[12.5px] text-red-400 mt-3">{scError}</p>}

            {scResult && (
              <div className="mt-4 flex flex-col gap-4">
                <p className="text-[11.5px] text-kxmist">
                  Reviewed {scResult.filesReviewed} file(s)
                </p>
                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3.5">
                  <p className="text-[12px] font-semibold text-kxblue mb-2">Claude's review</p>
                  <pre className="text-[12px] whitespace-pre-wrap font-sans">{scResult.claude}</pre>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3.5">
                  <p className="text-[12px] font-semibold text-kxblue mb-2">Gemini's review</p>
                  <pre className="text-[12px] whitespace-pre-wrap font-sans">{scResult.gemini}</pre>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
export default function ProjectWorkspace() {
  useSeo({ title: 'Project Workspace — KingxTech', noindex: true });
  useRequireAuth();

  const { id: projectId } = useParams();
  const [files, setFiles] = useState([]);
  const [selectedPath, setSelectedPath] = useState(null);
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [tab, setTab] = useState('editor'); // 'editor' | 'preview' | 'terminal' | 'settings'
  const [previewKey, setPreviewKey] = useState(0);
  const [runtimePreviewUrl, setRuntimePreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [copied, setCopied] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState(null);
  const [publishedAt, setPublishedAt] = useState(null);
  const [publishNotice, setPublishNotice] = useState(null); // { kind: 'success', url } | { kind: 'error', title, hint, details }
  const [publishSeconds, setPublishSeconds] = useState(0);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState(null); // { label, done, total }
  const [collapsedFolders, setCollapsedFolders] = useState(() => new Set());
  const [mobileView, setMobileView] = useState('workspace'); // 'files' | 'workspace' — mobile only, both shown side-by-side on desktop
  const folderInputRef = useRef(null);
  const uploadInputRef = useRef(null);

  const toggleFolder = (path) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  useEffect(() => {
    if (folderInputRef.current) folderInputRef.current.webkitdirectory = true;
  }, []);

  const tree = useMemo(() => buildTree(files), [files]);
  const url = previewUrl(projectId);
  const previewSrc = runtimePreviewUrl || publishedUrl || url;
  const hasUnpublishedChanges = Boolean(
    publishedAt && files.some((file) => file.updated_at && new Date(file.updated_at).getTime() > new Date(publishedAt).getTime())
  );

  const refreshFiles = useCallback(async () => {
    setIsLoadingFiles(true);
    setError('');
    try {
      const data = await listFiles(projectId);
      setFiles(data);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setIsLoadingFiles(false);
    }
  }, [projectId]);

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('projects')
      .select('slug, published_at')
      .eq('id', projectId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setPublishedAt(data?.published_at || null);
        const slug = data?.published_at && data?.slug ? data.slug : null;
        setPublishedUrl(slug ? siteUrl(`/${slug}/`) : null);
      });
    return () => { cancelled = true; };
  }, [projectId]);


  // The K-XpertAI drawer broadcasts this after it edits files in this
  // project, so the tree/editor/preview here stay in sync automatically.
  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.projectId !== projectId) return;
      refreshFiles();
      if (tab === 'preview') setPreviewKey((k) => k + 1);
      if (selectedPath) openFile(selectedPath); // keep the open file's content current
    };
    window.addEventListener('kxpert:files-changed', handler);
    return () => window.removeEventListener('kxpert:files-changed', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, refreshFiles, tab, selectedPath]);

  const openFile = async (path) => {
    try {
      const file = await readFile(projectId, path);
      setSelectedPath(path);
      setContent(file.content ?? '');
      setDirty(false);
      setMobileView('workspace');
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const save = async () => {
    if (!selectedPath) return;
    setIsSaving(true);
    try {
      await writeFile(projectId, selectedPath, content);
      setDirty(false);
      await refreshFiles();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setIsSaving(false);
    }
  };

  const undoFile = async () => {
    if (!selectedPath) return;
    if (!confirm(`Revert "${selectedPath}" to its previous saved version?`)) return;
    setIsUndoing(true);
    try {
      await revertFile(projectId, selectedPath);
      await openFile(selectedPath);
      await refreshFiles();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setIsUndoing(false);
    }
  };

  const newFile = async () => {
    const path = prompt('New file path (e.g. index.html):');
    if (!path) return;
    try {
      await writeFile(projectId, path, '');
      await refreshFiles();
      openFile(path);
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const newFolder = async () => {
    const path = prompt('New folder path (e.g. src/components):');
    if (!path) return;
    try {
      await createFolder(projectId, path);
      await refreshFiles();
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const removePath = async (path) => {
    if (!confirm(`Delete "${path}"? You can undo this from the version history if needed.`)) return;
    try {
      await deleteFile(projectId, path);
      if (selectedPath === path) {
        setSelectedPath(null);
        setContent('');
      }
      await refreshFiles();
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const openProjectPreview = async () => {
    setPreviewLoading(true);
    setPreviewError('');
    try {
      // Modern projects must be rendered by the isolated sandbox runtime.
      // The old /preview route only serves virtual text files and cannot compile TSX/JSX.
      const runtime = await startProjectRuntime(projectId);
      setRuntimePreviewUrl(runtime.url);
      setPreviewKey((k) => k + 1);
      setTab('preview');
    } catch (err) {
      // Fall back to the classic preview for simple HTML/CSS/JS projects.
      setPreviewError(friendlyError(err));
      setRuntimePreviewUrl(null);
      setPreviewKey((k) => k + 1);
      setTab('preview');
    } finally {
      setPreviewLoading(false);
    }
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publishedUrl || runtimePreviewUrl || url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail silently on some browsers/permissions — no-op.
    }
  };

  useEffect(() => {
    if (!isPublishing) return undefined;
    setPublishSeconds(0);
    const timer = setInterval(() => setPublishSeconds((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [isPublishing]);

  const publish = async () => {
    setIsPublishing(true);
    setPublishNotice(null);
    setError('');
    const startedAt = Date.now();
    const loadPublishedAt = async () => {
      const { data, error: publishedAtError } = await supabase
        .from('projects')
        .select('published_at, slug')
        .eq('id', projectId)
        .maybeSingle();
      if (publishedAtError) throw publishedAtError;
      return data;
    };
    try {
      const { url: hostedUrl } = await publishProject(projectId);
      setPublishedUrl(hostedUrl);
      const row = await loadPublishedAt().catch(() => null);
      if (row) setPublishedAt(row.published_at || null);
      setPublishNotice({ kind: 'success', url: hostedUrl });
    } catch (err) {
      // If the connection dropped or timed out, the server may still have finished. Check before reporting failure.
      if (err instanceof PublishError && (err.network || err.status >= 502)) {
        const row = await loadPublishedAt().catch(() => null);
        if (row?.slug && row.published_at && new Date(row.published_at).getTime() >= startedAt - 5000) {
          const recoveredUrl = siteUrl(`/${row.slug}/`);
          setPublishedUrl(recoveredUrl);
          setPublishedAt(row.published_at);
          setPublishNotice({ kind: 'success', url: recoveredUrl });
          setIsPublishing(false);
          return;
        }
      }
      setPublishNotice({ kind: 'error', ...friendlyPublishError({ message: err?.message, status: err?.status, network: err?.network }) });
    } finally {
      setIsPublishing(false);
    }
  };

  const importFromGithub = async () => {
    const repoFullName = prompt('GitHub repo to import from (owner/repo):');
    if (!repoFullName) return;
    const branch = prompt('Branch:', 'main') || 'main';
    setIsImporting(true);
    setImportStatus({ label: `Downloading ${repoFullName.trim()} from GitHub. Big repos can take a minute.`, done: 0, total: 0 });
    setError('');
    try {
      const { filesImported, skipped } = await importRepoFromGithub(projectId, repoFullName.trim(), branch.trim());
      await refreshFiles();
      alert(`Imported ${filesImported} file(s).${skipped.length ? `\n\nSkipped ${skipped.length}:\n${skipped.slice(0, 10).join('\n')}${skipped.length > 10 ? '\n…' : ''}` : ''}`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setIsImporting(false);
      setImportStatus(null);
    }
  };

  const importLocalFolder = () => folderInputRef.current?.click();

  const handleAssetUploads = async (inputFiles) => {
    const selected = Array.from(inputFiles || []);
    if (!selected.length) return;
    setIsImporting(true);
    setError('');
    let imported = 0;
    const importedPaths = [];
    const skipped = [];
    let seen = 0;
    for (const file of selected) {
      setImportStatus({ label: `Uploading ${file.name}`, done: seen, total: selected.length });
      seen += 1;
      const ext = extensionOf(file.name);
      if (!ASSET_EXTS.has(ext)) { skipped.push(`${file.name} (unsupported type; use PNG, JPG/JPEG, GIF, WebP, AVIF, ICO, SVG, WOFF/WOFF2, TTF, OTF, or PDF)`); continue; }
      if (file.size > MAX_LOCAL_IMPORT_BYTES) { skipped.push(`${file.name} (over 5 MB; choose a smaller file)`); continue; }
      try {
        let content;
        if (ext === 'svg') {
          content = await file.text();
          if (isUnsafeSvg(content)) throw new Error('SVG contains script, an on* event handler, or a javascript: URL.');
          if (!/<svg(?:\s|>)/i.test(content)) throw new Error('This .svg file does not contain an SVG image.');
        } else {
          content = BINARY_PREFIX + bytesToBase64(await file.arrayBuffer());
        }
        await writeFile(projectId, file.name, content);
        imported += 1;
        importedPaths.push(file.name);
      } catch (err) { skipped.push(`${file.name} (${err.message})`); }
    }
    await refreshFiles();
    if (importedPaths.length > 0) await openFile(importedPaths[importedPaths.length - 1]).catch(() => {});
    setIsImporting(false);
    setImportStatus(null);
    if (skipped.length) setError(`Uploaded ${imported} file(s). ${skipped.length} file(s) were not uploaded: ${skipped.slice(0, 4).join('; ')}${skipped.length > 4 ? '; …' : ''}`);
  };

  const handleUploadInputChange = async (e) => {
    const selected = Array.from(e.target.files || []);
    e.target.value = '';
    await handleAssetUploads(selected);
  };

  const handleLocalFolderSelected = async (e) => {
    const fileList = Array.from(e.target.files || []);
    e.target.value = ''; // allow re-selecting the same folder later
    if (fileList.length === 0) return;

    setIsImporting(true);
    setError('');
    setImportStatus({ label: 'Reading your folder', done: 0, total: 0 });
    let imported = 0;
    const skipped = [];
    const queue = [];

    for (const file of fileList) {
      const relPath = file.webkitRelativePath.split('/').slice(1).join('/') || file.name;
      if (relPath.split('/').some((part) => part === '.env' || part.startsWith('.env.'))) { skipped.push(`${relPath} (environment files are not imported)`); continue; }
      if (relPath.includes('node_modules/') || relPath.includes('.git/')) continue;
      if (queue.length >= MAX_LOCAL_IMPORT_FILES) { skipped.push(`${relPath} (file limit reached)`); continue; }
      const ext = extensionOf(relPath);
      if (file.size > MAX_LOCAL_IMPORT_BYTES) { skipped.push(`${relPath} (over 5 MB)`); continue; }
      if (UNSUPPORTED_BINARY_EXTS.has(ext)) { skipped.push(`${relPath} (unsupported binary type)`); continue; }
      queue.push({ file, relPath, ext });
    }

    let done = 0;
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const { file, relPath, ext } = queue[cursor]; cursor += 1;
        setImportStatus({ label: `Importing ${relPath}`, done, total: queue.length });
        try {
          let text;
          if (BINARY_EXTS.has(ext)) text = BINARY_PREFIX + bytesToBase64(await file.arrayBuffer());
          else {
            const raw = await file.arrayBuffer();
            if (isProbablyBinary(raw)) throw new Error('Unsupported binary type; import only text files and supported image/font/PDF assets.');
            text = await file.text();
            if (ext === 'svg' && isUnsafeSvg(text)) throw new Error('SVG contains unsafe script or event code.');
          }
          await writeFile(projectId, relPath, text);
          imported += 1;
        } catch (err) {
          skipped.push(`${relPath} (${err.message})`);
        }
        done += 1;
        setImportStatus({ label: `Importing ${relPath}`, done, total: queue.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));

    setImportStatus({ label: 'Refreshing files', done: queue.length, total: queue.length });
    await refreshFiles();
    setIsImporting(false);
    setImportStatus(null);
    alert(`Imported ${imported} file(s).${skipped.length ? `\n\nSkipped ${skipped.length}:\n${skipped.slice(0, 10).join('\n')}${skipped.length > 10 ? '\n…' : ''}` : ''}`);
  };

  const selectedExt = selectedPath ? extensionOf(selectedPath) : '';
  const selectedIsBinary = typeof content === 'string' && content.startsWith(BINARY_PREFIX);
  const selectedIsImage = Boolean(selectedPath && IMAGE_EXTS.has(selectedExt));
  const selectedIsAssetPreview = selectedIsImage || selectedIsBinary;
  const selectedImageSrc = selectedExt === 'svg'
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`
    : `data:${mimeForPath(selectedPath || '')};base64,${content.startsWith(BINARY_PREFIX) ? content.slice(BINARY_PREFIX.length) : ''}`;
  const selectedSize = selectedIsBinary ? (() => { const encoded = content.slice(BINARY_PREFIX.length); const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0; return Math.max(0, Math.floor(encoded.length * 3 / 4) - padding); })() : selectedExt === 'svg' ? new Blob([content || '']).size : 0;
  const downloadSelectedBinary = () => {
    if (!selectedPath || !selectedIsBinary) return;
    const raw = atob(content.slice(BINARY_PREFIX.length));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeForPath(selectedPath) }));
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = selectedPath.split('/').pop() || 'download';
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  };

  return (
    <DashboardShell fullWidth>
      {/* Compact header: title + refresh + the shareable link, all in one row */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h1 className="font-display text-xl sm:text-2xl font-semibold">Project workspace</h1>
        <Button onClick={refreshFiles} variant="ghost" className="flex items-center gap-1.5">
          <RefreshCw size={14} className={isLoadingFiles ? 'animate-spin' : ''} /> Refresh
        </Button>
      </div>

      <Card className="p-3 mb-4 rounded-xl flex items-center justify-between gap-3 flex-wrap shadow-lg shadow-black/10">
        <div className="flex items-center gap-2 min-w-0">
          <Eye size={14} className="text-kxpurple shrink-0" />
          <span className="text-[12.5px] text-kxmist">
            {publishedUrl ? 'Published site' : 'Preview URL'}
          </span>
          {publishedUrl && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 shrink-0">Live</span>}
          {hasUnpublishedChanges && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 shrink-0">Unpublished changes</span>}
          <span
            className="text-kxmist shrink-0 cursor-help"
            title={publishedUrl
              ? "Permanent published address for this project."
              : "Preview runs inside an isolated KingxTech Sandbox."}
          >
            <Info size={13} />
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={publish}
            disabled={isPublishing}
            className={`min-h-11 ${
              publishedUrl
                ? hasUnpublishedChanges
                  ? 'flex items-center gap-1 text-[12.5px] font-medium text-amber-300 hover:text-amber-200 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-400/20'
                  : 'flex items-center gap-1 text-[12.5px] text-kxmist hover:text-white px-2 py-1 rounded-md'
                : 'flex items-center gap-1 text-[12.5px] text-kxpurple hover:text-white'
            }`}
          >
            <Rocket size={13} />
            {isPublishing
              ? `Publishing… ${publishSeconds}s`
              : publishedUrl
                ? hasUnpublishedChanges
                  ? 'Publish changes'
                  : 'Republish'
                : 'Publish'}
          </button>
          <button onClick={copyLink} className="flex items-center gap-1 text-[12.5px] text-kxmist hover:text-white">
            <Copy size={13} /> {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
      </Card>

      {isPublishing && (
        <Card className="p-3 mb-4 rounded-xl border border-kxpurple/30 bg-kxpurple/10 text-[13px]" role="status">
          <p className="flex items-center gap-2 text-white"><Loader2 size={14} className="animate-spin shrink-0" /> Building and publishing your site ({publishSeconds}s)</p>
          <p className="text-kxmist mt-1">Keep this page open. The first publish of a project with packages can take a few minutes.</p>
        </Card>
      )}
      {!isPublishing && publishNotice?.kind === 'success' && (
        <Card className="p-3 mb-4 rounded-xl border border-emerald-400/30 bg-emerald-400/10 text-[13px]" role="status">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-emerald-200 font-medium">Published. Your site is live.</p>
              <a href={publishNotice.url} target="_blank" rel="noreferrer" className="text-kxblue underline break-all">{publishNotice.url}</a>
            </div>
            <button type="button" onClick={() => setPublishNotice(null)} aria-label="Dismiss" className="min-h-11 min-w-11 -mt-2 -mr-2 text-kxmist hover:text-white">✕</button>
          </div>
        </Card>
      )}
      {!isPublishing && publishNotice?.kind === 'error' && (
        <Card className="p-3 mb-4 rounded-xl border border-red-500/30 bg-red-500/10 text-[13px]" role="alert">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-red-200 font-medium">{publishNotice.title}</p>
              <p className="text-red-200/80 mt-1">{publishNotice.hint}</p>
            </div>
            <button type="button" onClick={() => setPublishNotice(null)} aria-label="Dismiss" className="min-h-11 min-w-11 -mt-2 -mr-2 text-red-200/70 hover:text-white">✕</button>
          </div>
          {publishNotice.details && (
            <details className="mt-2">
              <summary className="cursor-pointer text-red-200/70 min-h-8">Technical details</summary>
              <pre className="mt-1 whitespace-pre-wrap break-words text-[12px] text-red-200/80 font-mono">{publishNotice.details}</pre>
            </details>
          )}
          <button type="button" onClick={publish} className="mt-3 min-h-11 px-3 rounded-lg border border-red-300/30 text-red-100 hover:text-white">Try again</button>
        </Card>
      )}
      {error && (
        <Card className="p-3 mb-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-[13px]">
          {error}
        </Card>
      )}

      <input ref={uploadInputRef} type="file" multiple accept=".png,.jpg,.jpeg,.gif,.webp,.avif,.ico,.svg,.woff,.woff2,.ttf,.otf,.pdf" style={{ display: 'none' }} onChange={handleUploadInputChange} />
      <input
        ref={folderInputRef}
        type="file"
        webkitdirectory="true"
        directory=""
        multiple
        style={{ display: 'none' }}
        onChange={handleLocalFolderSelected}
      />

      <div className={isFullscreen
        ? 'fixed inset-0 z-50 bg-kxsurface p-3 md:p-4 flex flex-col md:grid md:grid-cols-[260px_1fr] md:grid-rows-1 gap-3 md:gap-4 overflow-hidden'
        : 'flex flex-col md:grid md:grid-cols-[260px_1fr] gap-3 md:gap-4'
      }>
        {/* File tree — full panel on mobile (toggled via the Files button), always-visible sidebar on desktop */}
        <Card className={`${mobileView === 'files' ? 'flex' : 'hidden'} md:flex flex-col rounded-[20px] p-3 shadow-lg shadow-black/10 overflow-y-auto ${isFullscreen ? 'flex-1 min-h-0 md:h-full' : 'h-[65vh] md:h-[60vh]'}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); handleAssetUploads(e.dataTransfer.files); }}>
          <div className="flex items-center justify-between mb-2 px-1 shrink-0">
            <span className="text-[11px] font-mono uppercase tracking-wider text-kxmist">Files</span>
            <div className="flex items-center gap-2.5">
              <button onClick={newFile} title="New file" className="text-kxmist hover:text-white p-0.5">
                <FilePlus size={14} />
              </button>
              <button onClick={newFolder} title="New folder" className="text-kxmist hover:text-white p-0.5">
                <FolderPlus size={14} />
              </button>
              <button onClick={() => uploadInputRef.current?.click()} disabled={isImporting} title="Upload images and binary files (max 5 MB each)" className="text-kxmist hover:text-white disabled:opacity-50 p-0.5">
                <Upload size={14} />
              </button>
              <button onClick={importFromGithub} disabled={isImporting} title="Import from GitHub repo" className="text-kxmist hover:text-white disabled:opacity-50 p-0.5">
                <Github size={14} />
              </button>
              <button onClick={importLocalFolder} disabled={isImporting} title="Import local folder" className="text-kxmist hover:text-white disabled:opacity-50 p-0.5">
                <FolderInput size={14} />
              </button>
              <button
                onClick={() => setMobileView('workspace')}
                title="Back to editor"
                className="md:hidden text-kxmist hover:text-white p-0.5"
              >
                <PanelLeftClose size={14} />
              </button>
            </div>
          </div>
          {isImporting && (
            <div className="px-1 mb-2 shrink-0" role="status" aria-live="polite">
              <p className="flex items-center gap-2 text-[11.5px] text-kxpurple min-w-0">
                <Loader2 size={12} className="animate-spin shrink-0" />
                <span className="truncate">{importStatus?.label || 'Importing…'}</span>
                {importStatus?.total > 0 && <span className="shrink-0 text-kxmist">{importStatus.done}/{importStatus.total}</span>}
              </p>
              {importStatus?.total > 0 && (
                <div className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full bg-kxpurple transition-all duration-200" style={{ width: `${Math.round((importStatus.done / importStatus.total) * 100)}%` }} />
                </div>
              )}
            </div>
          )}
          {files.length === 0 && !isLoadingFiles && !isImporting && (
            <p className="text-[12.5px] text-kxmist px-1">
              No files yet — create one, import from GitHub/a local folder, or ask K-XpertAI to scaffold something.
            </p>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <TreeNode
              node={tree}
              depth={0}
              selectedPath={selectedPath}
              onSelect={openFile}
              onDelete={removePath}
              collapsed={collapsedFolders}
              onToggleFolder={toggleFolder}
            />
          </div>
        </Card>

        {/* Editor / Preview / Terminal / Settings — full panel on mobile, main pane on desktop */}
        <Card className={`${mobileView === 'workspace' ? 'flex' : 'hidden'} md:flex rounded-[20px] p-3 md:p-4 flex-col min-h-0 shadow-lg shadow-black/10 ${isFullscreen ? 'flex-1 md:h-full' : 'h-[65vh] md:h-[60vh]'}`}>
          <div className="flex items-center justify-between mb-3 border-b border-white/8 pb-2 gap-2 shrink-0">
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              <button
                onClick={() => setMobileView('files')}
                title="Show file tree"
                className="md:hidden flex items-center shrink-0 gap-1 text-[12.5px] px-2 py-1.5 rounded-md text-kxmist hover:text-white"
              >
                <PanelLeft size={14} />
              </button>
              <button
                onClick={() => setTab('editor')}
                className={`flex items-center gap-1.5 text-[12.5px] px-2.5 py-1.5 rounded-md transition-colors duration-150 shrink-0 whitespace-nowrap ${tab === 'editor' ? 'bg-white/8 text-white' : 'text-kxmist hover:text-white'}`}
              >
                <Code2 size={13} /> Editor
              </button>
              <button
                onClick={openProjectPreview} disabled={previewLoading}
                className={`flex items-center gap-1.5 text-[12.5px] px-2.5 py-1.5 rounded-md transition-colors duration-150 shrink-0 whitespace-nowrap ${tab === 'preview' ? 'bg-white/8 text-white' : 'text-kxmist hover:text-white'}`}
              >
                <Eye size={13} /> {previewLoading ? 'Starting…' : 'Preview'}
              </button>
              <button
                onClick={() => setTab('terminal')}
                className={`flex items-center gap-1.5 text-[12.5px] px-2.5 py-1.5 rounded-md transition-colors duration-150 shrink-0 whitespace-nowrap ${tab === 'terminal' ? 'bg-white/8 text-white' : 'text-kxmist hover:text-white'}`}
              >
                <TerminalSquare size={13} /> Terminal
              </button>
              <button
                onClick={() => setTab('settings')}
                className={`flex items-center gap-1.5 text-[12.5px] px-2.5 py-1.5 rounded-md transition-colors duration-150 shrink-0 whitespace-nowrap ${tab === 'settings' ? 'bg-white/8 text-white' : 'text-kxmist hover:text-white'}`}
              >
                <SlidersHorizontal size={13} /> Settings
              </button>
            </div>
            <button
              onClick={() => setIsFullscreen((f) => !f)}
              title={isFullscreen ? 'Exit full screen' : 'Full screen'}
              className="text-kxmist hover:text-white shrink-0"
            >
              {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          </div>

          {tab === 'preview' && (
            <iframe
              key={previewKey}
              src={previewSrc}
              title="Project preview"
              className="flex-1 w-full rounded-lg border border-white/10 bg-white"
            />
          )}

          {tab === 'terminal' && <TerminalTab projectId={projectId} publishedUrl={publishedUrl} />}

          {tab === 'settings' && <SiteSettingsTab projectId={projectId} />}

          {tab === 'editor' && (selectedPath ? (
            <>
              <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <div className="min-w-0">
                  <span className="block text-[12.5px] md:text-[13px] font-mono text-kxmist truncate">{selectedPath}</span>
                  {selectedIsAssetPreview && <span className="text-[11px] text-kxmist">{mimeForPath(selectedPath)} · {formatFileSize(selectedSize)}</span>}
                </div>
                {!selectedIsAssetPreview && (
                  <div className="flex items-center gap-2 shrink-0">
                    <Button onClick={undoFile} disabled={isUndoing} variant="ghost" className="flex items-center gap-1.5">
                      <Undo2 size={14} /> <span className="hidden sm:inline">{isUndoing ? 'Undoing…' : 'Undo'}</span>
                    </Button>
                    <Button onClick={save} disabled={!dirty || isSaving} className="flex items-center gap-1.5">
                      <Save size={14} /> <span className="hidden sm:inline">{isSaving ? 'Saving…' : 'Save'}</span>
                    </Button>
                  </div>
                )}
              </div>
              {selectedIsImage ? (
                <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-white/10 bg-black/10 p-4 flex flex-col items-center justify-center gap-3">
                  <img src={selectedImageSrc} alt={selectedPath.split('/').pop()} className="max-w-full max-h-full object-contain" />
                  <div className="text-[12px] text-kxmist">{selectedPath.split('/').pop()} · {mimeForPath(selectedPath)} · {formatFileSize(selectedSize)}</div>
                  {selectedIsBinary && <Button onClick={downloadSelectedBinary} variant="ghost">Download image</Button>}
                </div>
              ) : selectedIsBinary ? (
                <div className="flex-1 min-h-0 rounded-lg border border-white/10 p-5 flex flex-col items-center justify-center gap-3 text-center">
                  <FileImage size={30} className="text-kxpurple" />
                  <p className="text-sm text-white">Binary file, {formatFileSize(selectedSize)}</p>
                  <p className="text-xs text-kxmist">{selectedPath.split('/').pop()} · {mimeForPath(selectedPath)}</p>
                  <div className="flex gap-2">
                    <Button onClick={downloadSelectedBinary} className="flex items-center gap-1.5"><Download size={14} /> Download</Button>
                    <Button onClick={() => removePath(selectedPath)} variant="ghost" className="flex items-center gap-1.5"><Trash2 size={14} /> Delete</Button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-hidden rounded-lg border border-white/10">
                  <CodeMirror value={content} height="100%" theme={vscodeDark} extensions={languageForPath(selectedPath) ? [languageForPath(selectedPath)] : []} onChange={(value) => { setContent(value); setDirty(true); }} basicSetup={{ foldGutter: true, highlightActiveLine: true }} style={{ height: '100%', fontSize: '13px' }} />
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[13px] text-kxmist">
              Select a file to view or edit it — or ask K-XpertAI (bottom right) to create one for you.
            </div>
          ))}
        </Card>
      </div>
    </DashboardShell>
  );
}