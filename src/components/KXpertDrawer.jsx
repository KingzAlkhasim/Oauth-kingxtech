import { useEffect, useState, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getBillingProfile } from '../lib/billing';
import { API_BASE } from '../lib/apiBase';
import { supabase } from '../lib/supabase';
import {
  Sparkles, X, Send, Wallet, RotateCcw, Trash2, Terminal, FilePlus,
  FileEdit, FolderPlus, FileX, Check, Undo2, Info, MoreHorizontal, ChevronDown, Globe } from 'lucide-react';

const VIEW_LABELS = {
  '/welcome': 'Dashboard',
  '/projects': 'Projects',
  '/console': 'Console',
  '/activity': 'Activity',
  '/settings': 'Settings',
  '/sessions': 'Sessions',
  '/billing': 'Billing & Wallet',
  '/domains': 'Custom Domain Routing',
};

const VIEW_TIPS = {
  '/domains': "If a domain won't verify, double check the CNAME host is just the subdomain (e.g. \"app\"), not the full domain.",
  '/billing': 'Wallet balance only updates once a real webhook confirms payment — there can be a short delay after checkout.',
  '/console': 'The SQL editor tab under KX Cloud only allows read-only SELECT queries — Row Level Security still applies.',
};

const STEP_ICONS = {
  webSearch: Globe,
  checkLiveSite: Globe,
  executeTerminalCommand: Terminal,
  listProjectFiles: FileEdit,
  readProjectFile: FileEdit,
  writeProjectFile: FilePlus,
  createProjectFolder: FolderPlus,
  deleteProjectFile: FileX,
};

const PHASE_LABELS = {
  webSearch: 'Searching the web',
  checkLiveSite: 'Checking the live site',
  executeTerminalCommand: 'Running command',
  listProjectFiles: 'Checking project files',
  readProjectFile: 'Reading file',
  writeProjectFile: 'Building',
  createProjectFolder: 'Building',
  deleteProjectFile: 'Cleaning up',
};

const SESSION_KEY = 'kxpert_session_id';

function newSessionId() {
  const id = crypto.randomUUID();
  sessionStorage.setItem(SESSION_KEY, id);
  return id;
}

function StepLine({ step }) {
  const Icon = STEP_ICONS[step.tool] || Terminal;
  return (
    <div className={`flex items-center gap-1.5 text-[11.5px] ${step.status === 'error' ? 'text-red-400' : 'text-kxmist'}`}>
      <Icon size={11} className="shrink-0" />
      <span className="truncate">{step.summary}</span>
    </div>
  );
}

// Renders assistant text as markdown (bold, headers, lists, links, fenced
// code blocks, tables, etc). Kept intentionally lightweight — no syntax
// highlighter dependency — but styled to fit the drawer's dark theme.
function MarkdownMessage({ text }) {
  return (
    <div className="kxpert-md min-w-0 break-words [overflow-wrap:anywhere] text-[13px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0 whitespace-pre-wrap min-w-0 break-words [overflow-wrap:anywhere]">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-kxpurple underline underline-offset-2 hover:text-kxpurple/80"
            >
              {children}
            </a>
          ),
          h1: ({ children }) => <h1 className="text-[14.5px] font-semibold text-white mt-3 mb-1.5 first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="text-[14px] font-semibold text-white mt-3 mb-1.5 first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="text-[13.5px] font-semibold text-white mt-2.5 mb-1 first:mt-0">{children}</h3>,
          ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="marker:text-kxmist/60">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-kxpurple/40 pl-2.5 my-2 text-kxmist/90 italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-white/10" />,
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="min-w-full text-[12px] border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-white/10 bg-white/[0.04] px-2 py-1 text-left font-semibold text-white">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="border border-white/10 px-2 py-1 align-top">{children}</td>,
          code: ({ inline, className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || '');
            if (inline) {
              return (
                <code className="rounded bg-black/40 border border-white/10 px-1 py-[1px] font-mono text-[12px] text-green-300" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <div className="my-2 min-w-0 max-w-full rounded-lg border border-kxpurple/30 bg-black overflow-hidden">
                {match && (
                  <div className="px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-kxmist/60 border-b border-white/10">
                    {match[1]}
                  </div>
                )}
                <pre className="max-w-full px-3 py-2 overflow-x-auto">
                  <code className="font-mono text-[12px] text-green-400 leading-relaxed" {...props}>
                    {children}
                  </code>
                </pre>
              </div>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function resetLabel(value){if(!value)return 'reset time unavailable';const ms=new Date(value).getTime()-Date.now();if(ms<=0)return 'resetting soon';if(ms<86400000){const mins=Math.floor(ms/60000);return `resets in ${Math.floor(mins/60)}h ${mins%60}m`;}return `resets ${new Date(value).toLocaleDateString()}`;}
function UsageBar({label,percent,resetsAt}){const value=Math.max(0,Math.min(100,Number(percent)||0));return <div className="min-w-0"><div className="flex items-center justify-between gap-2 text-[11px] mb-1"><span className="text-kxmist">{label}</span><span className="text-white tabular-nums">{value}%</span></div><div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden"><div className={`h-full rounded-full ${value>=100?'bg-red-400':value>=80?'bg-amber-400':'bg-kxblue'}`} style={{width:`${value}%`}}/></div><p className="text-[10px] text-kxmist/80 mt-1">{resetLabel(resetsAt)}</p></div>}

export default function KXpertDrawer() {
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState(null);
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [liveSteps, setLiveSteps] = useState([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [showModelHint, setShowModelHint] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);
  const [showModelSheet, setShowModelSheet] = useState(false);
  const [showUsageSheet, setShowUsageSheet] = useState(false);
  const [tipDismissed, setTipDismissed] = useState(() => sessionStorage.getItem('kxpert_tip_dismissed') === '1');
  const [hasSentFirstMessage, setHasSentFirstMessage] = useState(() => sessionStorage.getItem('kxpert_tip_seen') === '1');
  const [models, setModels] = useState([]);
  const [usage, setUsage] = useState(null);
  const [upgradePrompt, setUpgradePrompt] = useState('');
  const [mode, setMode] = useState('build');
  const [selectedTag, setSelectedTag] = useState('');
  const [sessionId, setSessionId] = useState(
    () => sessionStorage.getItem(SESSION_KEY) || newSessionId()
  );
  // The model tag currently "sticky" for this session — once the user types
  // e.g. :C-opus/, every following message in this session keeps using it
  // (silently re-attached under the hood) until they type a different tag.
  const [activeTag, setActiveTag] = useState(() => sessionStorage.getItem(`kxpert_active_tag_${sessionId}`) || null);
  const location = useLocation();

  // Tracks which session we've already hydrated from the server, so
  // closing/reopening the drawer doesn't re-fetch and clobber local state
  // (e.g. pending Accept/Reject buttons, which only exist client-side —
  // the DB only stores plain text, not turn/changes metadata).
  const hydratedSessionRef = useRef(null);

  const viewLabel = VIEW_LABELS[location.pathname] || 'KingxTech';
  const tip = VIEW_TIPS[location.pathname];

  const workspaceMatch = location.pathname.match(/^\/projects\/([^/]+)\/workspace/);
  const activeProjectId = workspaceMatch ? workspaceMatch[1] : null;

  const getAuthHeaders = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return null;
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    };
  }, []);

  const refreshUsage = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(`${API_BASE}/api/ai/usage`, { headers });
      const data = await response.json();
      if (data.tier) setUsage(data);
    } catch {
      // Usage display is advisory; never block chat if it cannot refresh.
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (!open) return;

    const usagePoll = window.setInterval(() => { refreshUsage(); }, 30000);
    getBillingProfile().then(({ data }) => setBalance(data?.credit_balance ?? null));

    getAuthHeaders().then((headers) => {
      if (!headers) return;
      fetch(`${API_BASE}/api/ai/models`,{headers}).then((r)=>r.json()).then((data)=>data.success&&setModels(data.models)).catch(()=>{});
      refreshUsage();
    });

    // Only hydrate from the server once per session. Reopening the drawer
    // with the same session already loaded keeps whatever's in local state
    // (including pending review buttons) instead of overwriting it.
    if (hydratedSessionRef.current !== sessionId) {
      hydratedSessionRef.current = sessionId;
      (async () => {
      setIsHistoryLoading(true);
      try {
        const headers = await getAuthHeaders();
        if (!headers) return;
        const response = await fetch(
          `${API_BASE}/api/ai/history?sessionId=${encodeURIComponent(sessionId)}`,
          { headers }
        );
        const data = await response.json();
        if (data.success) setHistory(data.messages);
      } catch {
        // Silently ignore — history hydration failing shouldn't block chat.
      } finally {
        setIsHistoryLoading(false);
      }
      })();
    }
    return () => window.clearInterval(usagePoll);
  }, [open, sessionId, getAuthHeaders, refreshUsage]);

  const send = async (e) => {
    e.preventDefault();
    if (!message.trim() || isLoading || ((usage?.tier === 'free' || usage?.enforced) && (usage?.sessionPercent >= 100 || usage?.weekPercent >= 100))) return;
    const userText = message;
    setHasSentFirstMessage(true);
    sessionStorage.setItem('kxpert_tip_seen', '1');
    const explicitTag = userText.match(/^:([A-Za-z]+)-([^/]+)\/\s*/);
    const tagToUse = explicitTag ? '' : (selectedTag || activeTag || '');
    const modePrefix = mode === 'plan'
      ? 'PLANNING MODE: Analyze the request and inspect only what is available read-only. Do NOT create, edit, delete, or modify any project file. Return a concrete implementation plan with goals, evidence, files to change, ordered steps, risks, and validation. End with "Ready to build when approved."\\n\\n'
      : '';
    const promptToSend = `${tagToUse} ${modePrefix}${userText}`.trim();
    setHistory((h) => [...h, { role: 'user', text: userText }]);
    setMessage('');
    setIsLoading(true);
    setLiveSteps([]);

    // The model selector is the normal UI path now; legacy tags still work.
    // Planning/Build is encoded in the request prompt, while Build keeps the
    // current project context and Planning intentionally omits it.

    try {
      const headers = await getAuthHeaders();
      if (!headers) throw new Error('You must be signed in to use K-XpertAI.');

      const response = await fetch(`${API_BASE}/api/ai/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prompt: promptToSend,
          sessionId,
          projectId: activeProjectId,
        }),
      });

      if (response.status === 401) throw new Error('Your session expired — please sign in again.');
      if (response.status === 429) throw new Error("You're sending messages too fast — give it a minute and try again.");
      if (response.status === 402) {
        // Keep legacy backend credit-limit wording out of the UI until the later enforcement migration.
        throw new Error('This AI request is unavailable right now. Please try again later or check your plan.');
      }
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Generation failed');
      }

      // Read the SSE stream: "step" events update the live progress list,
      // the final "done" event carries the complete result.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalPayload = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const line = chunk.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          let payload;
          try {
            payload = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (payload.type === 'status') {
            setLiveSteps((s) => [...s, { tool: 'status', status: 'ok', summary: payload.label }]);
          } else if (payload.type === 'step') {
            setLiveSteps((s) => [...s, payload.step]);
          } else if (payload.type === 'done') {
            finalPayload = payload;
          } else if (payload.type === 'error') {
            throw new Error(payload.error || 'Generation failed');
          }
        }
      }

      if (!finalPayload) throw new Error('No response received.');

      setHistory((h) => [
        ...h,
        {
          role: 'system',
          text: finalPayload.output,
          type: 'text',
          steps: finalPayload.steps || [],
          changes: finalPayload.changes || [],
          turnId: finalPayload.turnId,
          model: finalPayload.model,
          reviewState: finalPayload.changes?.length ? 'pending' : null,
        },
      ]);
      if (finalPayload.model?.tag) {
        setActiveTag(finalPayload.model.tag);
        sessionStorage.setItem(`kxpert_active_tag_${sessionId}`, finalPayload.model.tag);
      }
      if (activeProjectId && finalPayload.changes?.length) {
        window.dispatchEvent(
          new CustomEvent('kxpert:files-changed', { detail: { projectId: activeProjectId } })
        );
      }
    } catch (err) {
      setHistory((h) => [...h, { role: 'system', text: 'Error: ' + err.message, type: 'text' }]);
    } finally {
      refreshUsage();
      setIsLoading(false);
      setLiveSteps([]);
    }
  };

  const rejectTurn = async (index, turnId) => {
    if (!activeProjectId || !turnId) return;
    try {
      const headers = await getAuthHeaders();
      await fetch(`${API_BASE}/api/projects/${activeProjectId}/turns/${turnId}/reject`, {
        method: 'POST',
        headers,
      });
      setHistory((h) => h.map((m, i) => (i === index ? { ...m, reviewState: 'rejected' } : m)));
      window.dispatchEvent(new CustomEvent('kxpert:files-changed', { detail: { projectId: activeProjectId } }));
    } catch {
      setHistory((h) => [...h, { role: 'system', text: 'Error: failed to revert those changes.', type: 'text' }]);
    }
  };

  const acceptTurn = (index) => {
    setHistory((h) => h.map((m, i) => (i === index ? { ...m, reviewState: 'accepted' } : m)));
  };

  const startNewChat = () => {
    if (isLoading) return;
    const newId = newSessionId();
    setSessionId(newId);
    setHistory([]);
    setActiveTag(null);
  };

  const clearChat = async () => {
    if (isLoading) return;
    try {
      const headers = await getAuthHeaders();
      if (headers) {
        await fetch(`${API_BASE}/api/ai/history?sessionId=${encodeURIComponent(sessionId)}`, {
          method: 'DELETE',
          headers,
        });
      }
    } catch {
      // Even if the server delete fails, still clear the local view.
    }
    setHistory([]);
    setActiveTag(null);
    sessionStorage.removeItem(`kxpert_active_tag_${sessionId}`);
  };

  const currentPhase = liveSteps.length === 0
    ? 'Starting…'
    : liveSteps[liveSteps.length - 1]?.tool === 'status'
      ? liveSteps[liveSteps.length - 1].summary
      : PHASE_LABELS[liveSteps[liveSteps.length - 1]?.tool] || 'Working…';

  const usagePercent = Math.max(0, Math.min(100, Number(usage?.sessionPercent) || 0), Math.max(0, Math.min(100, Number(usage?.weekPercent) || 0)));
  const usageAtLimit = Number(usage?.sessionPercent) >= 100 || Number(usage?.weekPercent) >= 100;
  const usageResetAt = Number(usage?.sessionPercent) >= 100 ? usage?.sessionResetsAt : usage?.weekResetsAt;
  const modelLocked = (m) => (m.minTier === 'pro' && (usage?.tier || 'free') === 'free') || (m.minTier === 'pro_plus' && (usage?.tier || 'free') !== 'pro_plus');
  const resolvedAutoModel = (usage?.tier || 'free') === 'free' ? models.find((m) => m.tag.toLowerCase().includes('qwen')) : models.find((m) => m.tag.toLowerCase().includes('gemma'));
  const chooseModel = (tag) => {
    const next = models.find((m) => m.tag === tag);
    if (next && modelLocked(next)) {
      setUpgradePrompt(next.minTier === 'pro_plus' ? 'Pro+ is required for this model.' : 'Pro is required for this model.');
      setShowModelSheet(false);
      return;
    }
    setUpgradePrompt('');
    setSelectedTag(tag);
    if (!tag) {
      setActiveTag(null);
      sessionStorage.removeItem(`kxpert_active_tag_${sessionId}`);
    }
    setShowModelSheet(false);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-30 w-12 h-12 rounded-full bg-kx-gradient flex items-center justify-center shadow-lg hover:scale-105 transition-transform"
        aria-label="Open K-XpertAI"
      >
        <Sparkles size={18} />
      </button>

      {open && (
        <div className="kxpert-overlay fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <section className="kxpert-drawer relative w-full max-w-sm h-[100dvh] bg-kxsurface border-l border-white/10 flex flex-col min-w-0" aria-label="K-XpertAI chat">
            <header className="kxpert-header flex items-center justify-between gap-2 px-3 border-b border-white/8 shrink-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <Sparkles size={16} className="text-kxpurple shrink-0" />
                <span className="font-display font-medium text-[14px] whitespace-nowrap">K-XpertAI</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <div className="flex items-center rounded-lg bg-white/[0.03] border border-white/10 p-0.5" role="group" aria-label="Chat mode">
                  <button type="button" onClick={() => setMode('plan')} className={"kxpert-mode-btn " + (mode === 'plan' ? 'is-plan' : '')}>Plan</button>
                  <button type="button" onClick={() => setMode('build')} className={"kxpert-mode-btn " + (mode === 'build' ? 'is-build' : '')}>Build</button>
                </div>
                <button type="button" onClick={() => setShowOverflow((s) => !s)} className="kxpert-icon-btn" aria-label="More chat options" aria-expanded={showOverflow}><MoreHorizontal size={19} /></button>
                <button type="button" onClick={() => setOpen(false)} className="kxpert-icon-btn" aria-label="Close K-XpertAI"><X size={18} /></button>
              </div>
              {showOverflow && (
                <div className="kxpert-overflow absolute right-3 top-12 z-50 rounded-xl border border-white/10 bg-kxsurface2 shadow-xl p-1.5 min-w-[210px]">
                  <div className="px-3 py-2 text-[12px] text-kxmist">Viewing: <span className="text-white">{viewLabel}</span></div>
                  <div className="px-3 py-2 text-[12px] text-kxmist flex items-center gap-2"><Wallet size={14} /> Wallet balance · compute/storage: <span className="text-white">{balance === null ? '—' : '$' + Math.max(0, Number(balance) || 0).toFixed(2)}</span></div>
                  <a href="/billing" className="kxpert-menu-item">Billing &amp; wallet</a>
                  <button type="button" onClick={() => { setShowModelHint((s) => !s); setShowOverflow(false); setShowModelSheet(true); }} className="kxpert-menu-item"><Info size={14} /> Model information</button>
                  <button type="button" onClick={() => { startNewChat(); setShowOverflow(false); }} disabled={isLoading} className="kxpert-menu-item"><RotateCcw size={14} /> New chat</button>
                  <button type="button" onClick={() => { clearChat(); setShowOverflow(false); }} disabled={isLoading} className="kxpert-menu-item text-red-300"><Trash2 size={14} /> Clear conversation</button>
                </div>
              )}
            </header>

            <div className="kxpert-context-row flex items-center justify-between gap-2 px-3 shrink-0">
              <button type="button" onClick={() => setShowModelSheet(true)} className="kxpert-chip min-w-0" aria-label="Choose AI model">
                <span className="truncate">{models.find((m) => m.tag === selectedTag)?.label || (activeTag ? models.find((m) => m.tag === activeTag)?.label || activeTag : 'Auto')}</span>
                <ChevronDown size={13} className="shrink-0 opacity-70" />
              </button>
              <button type="button" onClick={() => setShowUsageSheet(true)} className={"kxpert-usage-pill " + (usagePercent >= 100 ? 'is-limit' : usagePercent >= 80 ? 'is-warn' : '')} aria-label="View usage details">
                <span className="kxpert-usage-dot" /> Usage {usagePercent}%
              </button>
            </div>

            {usageAtLimit && (
              <p className="kxpert-limit-notice shrink-0" role="status">Usage limit reached · resets {resetLabel(usageResetAt)}</p>
            )}
            {upgradePrompt && (
              <div className="mx-3 mt-1 rounded-lg border border-amber-400/20 bg-amber-400/5 p-2.5 text-[12px] text-amber-200 flex items-center justify-between gap-2 shrink-0">
                <span className="min-w-0">{upgradePrompt}</span><a href="/billing" className="shrink-0 underline min-h-[44px] inline-flex items-center">Upgrade</a>
                <button type="button" className="kxpert-icon-btn" aria-label="Dismiss upgrade message" onClick={() => setUpgradePrompt('')}><X size={14}/></button>
              </div>
            )}

            {showModelSheet && (
              <div className="kxpert-sheet-backdrop" onClick={() => setShowModelSheet(false)}>
                <section className="kxpert-sheet" role="dialog" aria-modal="true" aria-label="Choose model" onClick={(e) => e.stopPropagation()}>
                  <div className="kxpert-sheet-handle" />
                  <div className="flex items-center justify-between mb-2"><h2 className="text-[14px] font-semibold">Choose a model</h2><button type="button" className="kxpert-icon-btn" aria-label="Close model list" onClick={() => setShowModelSheet(false)}><X size={18}/></button></div>
                  <div className="kxpert-sheet-list">
                    <button type="button" className={"kxpert-model-option " + (!selectedTag ? 'is-selected' : '')} onClick={() => chooseModel('')}><span><strong>Auto</strong><small>Default for your plan: {resolvedAutoModel?.label || ((usage?.tier || 'free') === 'free' ? 'Qwen3 Coder (free)' : 'Gemma 4 31B (free, Google)')}</small></span>{!selectedTag && <Check size={16}/>}</button>
                    {models.map((m) => (
                      <button type="button" key={m.tag} className={"kxpert-model-option " + (selectedTag === m.tag ? 'is-selected' : '')} onClick={() => chooseModel(m.tag)}>
                        <span className="min-w-0"><strong className="block truncate">{m.label}</strong><small>{m.tag}</small></span>
                        <span className="kxpert-model-tier">{modelLocked(m) ? (m.minTier === 'pro_plus' ? '🔒 Pro+' : '🔒 Pro') : (m.minTier === 'pro_plus' ? 'Pro+' : m.minTier === 'pro' ? 'Pro' : 'Free')}</span>
                      </button>
                    ))}
                    {!models.length && <p className="text-[12px] text-kxmist px-3 py-4">Loading models…</p>}
                  </div>
                </section>
              </div>
            )}

            {showUsageSheet && (
              <div className="kxpert-sheet-backdrop" onClick={() => setShowUsageSheet(false)}>
                <section className="kxpert-sheet" role="dialog" aria-modal="true" aria-label="Usage details" onClick={(e) => e.stopPropagation()}>
                  <div className="kxpert-sheet-handle" />
                  <div className="flex items-center justify-between mb-4"><h2 className="text-[14px] font-semibold">Usage</h2><button type="button" className="kxpert-icon-btn" aria-label="Close usage details" onClick={() => setShowUsageSheet(false)}><X size={18}/></button></div>
                  {usage ? <div className="space-y-5"><UsageBar label="Session usage" percent={usage.sessionPercent} resetsAt={usage.sessionResetsAt}/><UsageBar label="Weekly usage" percent={usage.weekPercent} resetsAt={usage.weekResetsAt}/>{usage.tier === 'free' && <a href="/billing" className="inline-flex min-h-[44px] items-center justify-center rounded-lg px-4 text-[12.5px] font-medium bg-kx-gradient text-white">Upgrade to Pro</a>}</div> : <p className="text-[12px] text-kxmist">Usage details are loading.</p>}
                </section>
              </div>
            )}

            {showModelHint && showModelSheet && (
              <div className="sr-only">Model tags are available in the model list.</div>
            )}

            {activeProjectId && (
              <div className={"kxpert-project-context shrink-0 " + (mode === 'plan' ? 'is-plan' : 'is-build')}>
                {mode === 'plan' ? 'Planning mode — project files will not be changed.' : 'Workspace active'}
              </div>
            )}

            <div className="kxpert-messages flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-3" aria-live="polite">
              {isHistoryLoading && <p className="text-[13px] text-kxmist italic">Loading conversation...</p>}
              {!isHistoryLoading && history.length === 0 && (
                <div className="kxpert-empty-state">
                  <div className="kxpert-empty-icon"><Sparkles size={21}/></div>
                  <p className="text-[14px] font-medium text-white">Hey! What are we working on?</p>
                  <p className="text-[12px] text-kxmist mt-1">Ask a question or pick a starting point.</p>
                  {tip && !tipDismissed && !hasSentFirstMessage && (
                    <div className="kxpert-empty-tip">
                      <button type="button" className="kxpert-tip-dismiss" aria-label="Dismiss tip" onClick={() => { setTipDismissed(true); sessionStorage.setItem('kxpert_tip_dismissed', '1'); }}><X size={13}/></button>
                      <span className="block text-[10px] uppercase tracking-wider text-kxpurple mb-1">Quick tip</span>{tip}
                    </div>
                  )}
                  <div className="kxpert-suggestions">
                    {[
                      'Explain this page to me',
                      activeProjectId ? 'Review my project structure' : 'Help me plan a project',
                      mode === 'plan' ? 'Make an implementation plan' : 'Help me fix a bug',
                    ].map((suggestion) => <button key={suggestion} type="button" onClick={() => setMessage(suggestion)}>{suggestion}</button>)}
                  </div>
                </div>
              )}
              {history.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[90%] min-w-0 break-words [overflow-wrap:anywhere] rounded-xl px-3.5 py-2.5 text-[13px] ${
                    m.role === 'user'
                      ? 'self-end bg-kxsurface2'
                      : m.type === 'tool'
                        ? 'self-start bg-black border border-kxpurple/30 font-mono text-green-400'
                        : 'self-start border border-white/10 bg-white/[0.02] text-kxmist'
                  }`}
                >
                  {m.type === 'tool' && <div className="text-[10px] opacity-50 mb-1">TERMINAL OUTPUT</div>}

                  {m.steps?.length > 0 && (
                    <div className="mb-2 pb-2 border-b border-white/10 space-y-1">
                      {m.steps.map((s, si) => <StepLine key={si} step={s} />)}
                    </div>
                  )}

                  {m.role === 'user' || m.type === 'tool' ? (
                    <div className="whitespace-pre-wrap">{m.text}</div>
                  ) : (
                    <MarkdownMessage text={m.text} />
                  )}

                  {m.model && <div className="mt-1.5 text-[10px] opacity-40">{m.model.label}</div>}

                  {m.changes?.length > 0 && m.reviewState === 'pending' && (
                    <div className="mt-3 pt-3 border-t border-white/10">
                      <p className="text-[11px] text-kxmist mb-2">
                        Changed {m.changes.length} file{m.changes.length > 1 ? 's' : ''}: {m.changes.map((c) => c.path).join(', ')}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => acceptTurn(i)}
                          className="flex items-center gap-1 text-[11.5px] px-2.5 py-1 rounded-md bg-green-500/15 text-green-400 hover:bg-green-500/25"
                        >
                          <Check size={12} /> Accept
                        </button>
                        <button
                          onClick={() => rejectTurn(i, m.turnId)}
                          className="flex items-center gap-1 text-[11.5px] px-2.5 py-1 rounded-md bg-red-500/15 text-red-400 hover:bg-red-500/25"
                        >
                          <Undo2 size={12} /> Reject &amp; undo
                        </button>
                      </div>
                    </div>
                  )}
                  {m.reviewState === 'accepted' && (
                    <p className="mt-2 text-[11px] text-green-400 flex items-center gap-1"><Check size={11} /> Accepted</p>
                  )}
                  {m.reviewState === 'rejected' && (
                    <p className="mt-2 text-[11px] text-red-400 flex items-center gap-1"><Undo2 size={11} /> Reverted</p>
                  )}
                </div>
              ))}

              {isLoading && (
                <div className="self-start max-w-[90%] rounded-xl px-3.5 py-2.5 text-[13px] border border-white/10 bg-white/[0.02] text-kxmist">
                  <p className="text-[11px] font-mono uppercase tracking-wider mb-1.5 bg-gradient-to-r from-kxpurple via-white to-kxpurple bg-[length:200%_100%] bg-clip-text text-transparent animate-shimmer">{currentPhase}</p>
                  {liveSteps.length > 0 && <div className="space-y-1">{liveSteps.map((s, i) => <StepLine key={i} step={s} />)}</div>}
                </div>
              )}
            </div>

            <form onSubmit={send} className="kxpert-composer shrink-0 flex items-end gap-2 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
              {activeTag && <span className="kxpert-active-tag" title="Model selected for this conversation">{models.find((m) => m.tag === activeTag)?.label || activeTag}</span>}
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={isLoading ? 'Working...' : mode === 'plan' ? 'Describe what you want to plan…' : 'Ask K-XpertAI to build…'}
                disabled={isLoading || ((usage?.tier === 'free' || usage?.enforced) && (usage?.sessionPercent >= 100 || usage?.weekPercent >= 100))}
                className="kxpert-message-input flex-1 min-w-0 bg-white/[0.02] border border-white/12 rounded-lg px-3 py-2.5 text-[13px] outline-none focus:border-kxblue"
              />
              <button type="submit" disabled={isLoading || ((usage?.tier === 'free' || usage?.enforced) && (usage?.sessionPercent >= 100 || usage?.weekPercent >= 100))} className="w-11 h-11 rounded-lg bg-kx-gradient flex items-center justify-center shrink-0 disabled:opacity-40" aria-label="Send message">
                <Send size={15} />
              </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
