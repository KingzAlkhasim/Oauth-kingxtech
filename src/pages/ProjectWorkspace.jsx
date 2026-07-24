import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import DashboardShell from '../components/DashboardShell';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import { Card, Button, Input } from '../components/ui';
import {
  listFiles, readFile, writeFile, createFolder, deleteFile, revertFile,
  previewUrl, publishProject, runTerminalCommand,
} from '../lib/projectFiles';
import { getProjectRepoLink, pushProjectToGithub, importRepoFromGithub } from '../lib/github';
import { listProjectEnvVars, setProjectEnvVar, deleteProjectEnvVar } from '../lib/projectEnvVars';
import CodeMirror from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import {
  File as FileIcon,
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
} from 'lucide-react';

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

const BINARY_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'eot', 'mp4', 'mp3', 'pdf', 'zip', 'webp']);
const MAX_LOCAL_IMPORT_FILES = 300;
const MAX_LOCAL_IMPORT_BYTES = 300_000;

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
                  {child.isFolder ? <Folder size={13} className="shrink-0" /> : <FileIcon size={13} className="shrink-0" />}
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

function TerminalTab({ projectId }) {
  const [lines, setLines] = useState([]); // [{ type: 'cmd'|'out'|'err', text }]
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [githubLink, setGithubLink] = useState(null);
  const [isPushing, setIsPushing] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    getProjectRepoLink(projectId).then(setGithubLink).catch(() => setGithubLink(null));
  }, [projectId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

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
      const { commitUrl, filesChanged } = await pushProjectToGithub(projectId, commitMessage);
      setLines((l) => [...l, { type: 'out', text: `Pushed ${filesChanged} file(s). ${commitUrl}` }]);
    } catch (err) {
      setLines((l) => [...l, { type: 'err', text: err.message }]);
    } finally {
      setIsPushing(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] text-kxmist font-mono">Allowed: {ALLOWED_COMMANDS_HINT}</p>
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

      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-black/50 rounded-lg border border-white/10 p-3 font-mono text-[12.5px] space-y-1.5">
        {lines.length === 0 && <p className="text-kxmist opacity-60">Run a command, or push this project to a linked GitHub repo.</p>}
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
          placeholder={isRunning ? 'Running…' : 'git status'}
          disabled={isRunning}
          className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[13px] font-mono text-kxmist outline-none focus:border-kxblue"
        />
        <Button type="submit" disabled={isRunning || !input.trim()}>Run</Button>
      </form>
    </div>
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

  const refresh = useCallback(() => {
    listProjectEnvVars(projectId).then(setVars).catch((e) => setError(e.message));
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    if (!key.trim()) return;
    setSaving(true);
    setError('');
    try {
      await setProjectEnvVar(projectId, key.trim(), value, isPublic);
      setKey(''); setValue(''); setIsPublic(false);
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    try {
      await deleteProjectEnvVar(projectId, id);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <p className="text-[12px] text-kxmist mb-4 flex items-start gap-1.5">
        <Info size={13} className="mt-0.5 shrink-0" />
        Variables specific to this project — separate from your account-wide KX Cloud config. Vars marked
        <span className="text-amber-400 mx-1">Public</span> are exposed to this project's published site via <code className="text-white">window.KX_ENV</code> — never mark a real secret public.
      </p>

      {error && <p className="text-[12.5px] text-red-400 mb-3">{error}</p>}

      <div className="flex flex-col gap-2 mb-4">
        {vars === null && <p className="text-[13px] text-kxmist">Loading…</p>}
        {vars?.length === 0 && <p className="text-[13px] text-kxmist">No variables set for this project yet.</p>}
        {vars?.map((v) => (
          <div key={v.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3.5 py-2.5">
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
              <button onClick={() => remove(v.id)} className="hover:text-red-400"><Trash2 size={13} /></button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        <Input label="Key" value={key} onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))} placeholder="API_URL" containerClassName="flex-1" />
        <Input label="Value" value={value} onChange={(e) => setValue(e.target.value)} containerClassName="flex-1" />
        <label className="flex items-center gap-1.5 text-[12px] text-kxmist pb-2.5 cursor-pointer select-none">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
          Public
        </label>
        <Button variant="glow" onClick={save} loading={saving} disabled={!key.trim()}><Plus size={14} /> Set</Button>
      </div>
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
  const [copied, setCopied] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState(() => new Set());
  const [mobileView, setMobileView] = useState('workspace'); // 'files' | 'workspace' — mobile only, both shown side-by-side on desktop
  const folderInputRef = useRef(null);

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

  const refreshFiles = useCallback(async () => {
    setIsLoadingFiles(true);
    setError('');
    try {
      const data = await listFiles(projectId);
      setFiles(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoadingFiles(false);
    }
  }, [projectId]);

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

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
      setError(err.message);
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
      setError(err.message);
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
      setError(err.message);
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
      setError(err.message);
    }
  };

  const newFolder = async () => {
    const path = prompt('New folder path (e.g. src/components):');
    if (!path) return;
    try {
      await createFolder(projectId, path);
      await refreshFiles();
    } catch (err) {
      setError(err.message);
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
      setError(err.message);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publishedUrl || url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail silently on some browsers/permissions — no-op.
    }
  };

  const publish = async () => {
    setIsPublishing(true);
    setError('');
    try {
      const { url: hostedUrl } = await publishProject(projectId);
      setPublishedUrl(hostedUrl);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsPublishing(false);
    }
  };

  const importFromGithub = async () => {
    const repoFullName = prompt('GitHub repo to import from (owner/repo):');
    if (!repoFullName) return;
    const branch = prompt('Branch:', 'main') || 'main';
    setIsImporting(true);
    setError('');
    try {
      const { filesImported, skipped } = await importRepoFromGithub(projectId, repoFullName.trim(), branch.trim());
      await refreshFiles();
      alert(`Imported ${filesImported} file(s).${skipped.length ? `\n\nSkipped ${skipped.length}:\n${skipped.slice(0, 10).join('\n')}${skipped.length > 10 ? '\n…' : ''}` : ''}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsImporting(false);
    }
  };

  const importLocalFolder = () => folderInputRef.current?.click();

  const handleLocalFolderSelected = async (e) => {
    const fileList = Array.from(e.target.files || []);
    e.target.value = ''; // allow re-selecting the same folder later
    if (fileList.length === 0) return;

    setIsImporting(true);
    setError('');
    let imported = 0;
    const skipped = [];

    for (const file of fileList) {
      const relPath = file.webkitRelativePath.split('/').slice(1).join('/') || file.name;
      if (relPath.includes('node_modules/') || relPath.includes('.git/')) continue;

      if (imported >= MAX_LOCAL_IMPORT_FILES) { skipped.push(`${relPath} (file limit reached)`); continue; }
      const ext = relPath.split('.').pop()?.toLowerCase();
      if (BINARY_EXTS.has(ext)) { skipped.push(`${relPath} (binary, not supported yet)`); continue; }
      if (file.size > MAX_LOCAL_IMPORT_BYTES) { skipped.push(`${relPath} (too large)`); continue; }

      try {
        const text = await file.text();
        await writeFile(projectId, relPath, text);
        imported += 1;
      } catch (err) {
        skipped.push(`${relPath} (${err.message})`);
      }
    }

    setIsImporting(false);
    await refreshFiles();
    alert(`Imported ${imported} file(s).${skipped.length ? `\n\nSkipped ${skipped.length}:\n${skipped.slice(0, 10).join('\n')}${skipped.length > 10 ? '\n…' : ''}` : ''}`);
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
          <code className="text-[12.5px] text-kxmist truncate">{publishedUrl || url}</code>
          {publishedUrl && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 shrink-0">Published</span>}
          <span
            className="text-kxmist shrink-0 cursor-help"
            title={publishedUrl
              ? "Permanent address — updates instantly whenever files change, no redeploy needed."
              : "Already live right now. Publish gives it a permanent, friendly address instead of the raw ID. Anyone with the link can view it, same as most sharable preview tools."}
          >
            <Info size={13} />
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!publishedUrl && (
            <button onClick={publish} disabled={isPublishing} className="flex items-center gap-1 text-[12.5px] text-kxpurple hover:text-white">
              <Rocket size={13} /> {isPublishing ? 'Publishing…' : 'Publish'}
            </button>
          )}
          <button onClick={copyLink} className="flex items-center gap-1 text-[12.5px] text-kxmist hover:text-white">
            <Copy size={13} /> {copied ? 'Copied!' : 'Copy link'}
          </button>
          <a href={publishedUrl || url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[12.5px] text-kxblue hover:text-white">
            Open <ExternalLink size={13} />
          </a>
        </div>
      </Card>

      {error && (
        <Card className="p-3 mb-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-[13px]">
          {error}
        </Card>
      )}

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
        <Card className={`${mobileView === 'files' ? 'flex' : 'hidden'} md:flex flex-col rounded-[20px] p-3 shadow-lg shadow-black/10 overflow-y-auto ${isFullscreen ? 'flex-1 min-h-0 md:h-full' : 'h-[65vh] md:h-[60vh]'}`}>
          <div className="flex items-center justify-between mb-2 px-1 shrink-0">
            <span className="text-[11px] font-mono uppercase tracking-wider text-kxmist">Files</span>
            <div className="flex items-center gap-2.5">
              <button onClick={newFile} title="New file" className="text-kxmist hover:text-white p-0.5">
                <FilePlus size={14} />
              </button>
              <button onClick={newFolder} title="New folder" className="text-kxmist hover:text-white p-0.5">
                <FolderPlus size={14} />
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
          {isImporting && <p className="text-[11.5px] text-kxpurple px-1 mb-2 shrink-0">Importing…</p>}
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
                onClick={() => { setTab('preview'); setPreviewKey((k) => k + 1); }}
                className={`flex items-center gap-1.5 text-[12.5px] px-2.5 py-1.5 rounded-md transition-colors duration-150 shrink-0 whitespace-nowrap ${tab === 'preview' ? 'bg-white/8 text-white' : 'text-kxmist hover:text-white'}`}
              >
                <Eye size={13} /> Preview
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
              src={publishedUrl || url}
              title="Project preview"
              className="flex-1 w-full rounded-lg border border-white/10 bg-white"
            />
          )}

          {tab === 'terminal' && <TerminalTab projectId={projectId} />}

          {tab === 'settings' && <SiteSettingsTab projectId={projectId} />}

          {tab === 'editor' && (selectedPath ? (
            <>
              <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <span className="text-[12.5px] md:text-[13px] font-mono text-kxmist truncate min-w-0">{selectedPath}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <Button onClick={undoFile} disabled={isUndoing} variant="ghost" className="flex items-center gap-1.5">
                    <Undo2 size={14} /> <span className="hidden sm:inline">{isUndoing ? 'Undoing…' : 'Undo'}</span>
                  </Button>
                  <Button onClick={save} disabled={!dirty || isSaving} className="flex items-center gap-1.5">
                    <Save size={14} /> <span className="hidden sm:inline">{isSaving ? 'Saving…' : 'Save'}</span>
                  </Button>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden rounded-lg border border-white/10">
                <CodeMirror
                  value={content}
                  height="100%"
                  theme={vscodeDark}
                  extensions={languageForPath(selectedPath) ? [languageForPath(selectedPath)] : []}
                  onChange={(value) => {
                    setContent(value);
                    setDirty(true);
                  }}
                  basicSetup={{ foldGutter: true, highlightActiveLine: true }}
                  style={{ height: '100%', fontSize: '13px' }}
                />
              </div>
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
