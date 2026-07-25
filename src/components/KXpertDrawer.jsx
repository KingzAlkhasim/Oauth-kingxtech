import { useEffect, useState, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { getBillingProfile } from '../lib/billing';
import { supabase } from '../lib/supabase';
import {
  Sparkles, X, Send, Wallet, RotateCcw, Trash2, Terminal, FilePlus,
  FileEdit, FolderPlus, FileX, Check, Undo2, Info, Gift,
} from 'lucide-react';

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
  executeTerminalCommand: Terminal,
  listProjectFiles: FileEdit,
  readProjectFile: FileEdit,
  writeProjectFile: FilePlus,
  createProjectFolder: FolderPlus,
  deleteProjectFile: FileX,
};

const PHASE_LABELS = {
  executeTerminalCommand: 'Running command',
  listProjectFiles: 'Checking project files',
  readProjectFile: 'Reading file',
  writeProjectFile: 'Building',
  createProjectFolder: 'Building',
  deleteProjectFile: 'Cleaning up',
};

const API_BASE = 'https://kx-neurocore-1066169621814.us-central1.run.app';
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

export default function KXpertDrawer() {
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState(null);
  const [credits, setCredits] = useState(null);
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [liveSteps, setLiveSteps] = useState([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [showModelHint, setShowModelHint] = useState(false);
  const [models, setModels] = useState([]);
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

  const refreshCredits = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const res = await fetch(`${API_BASE}/api/ai/credits`, { headers });
      const data = await res.json();
      if (data.success) setCredits({ remaining: data.remaining, allowance: data.allowance });
    } catch {
      // Non-critical — the badge just won't show if this fails.
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (!open) return;

    getBillingProfile().then(({ data }) => setBalance(data?.credit_balance ?? null));
    refreshCredits();

    getAuthHeaders().then((headers) => {
      if (!headers) return;
      fetch(`${API_BASE}/api/ai/models`, { headers })
        .then((r) => r.json())
        .then((d) => d.success && setModels(d.models))
        .catch(() => {});
    });

    // Only hydrate from the server once per session. Reopening the drawer
    // with the same session already loaded keeps whatever's in local state
    // (including pending review buttons) instead of overwriting it.
    if (hydratedSessionRef.current === sessionId) return;
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
  }, [open, sessionId, getAuthHeaders, refreshCredits]);

  const send = async (e) => {
    e.preventDefault();
    if (!message.trim() || isLoading) return;
    const userText = message;
    setHistory((h) => [...h, { role: 'user', text: userText }]);
    setMessage('');
    setIsLoading(true);
    setLiveSteps([]);

    // If the user typed their own tag (e.g. ":C-opus/ ..."), that becomes the
    // new sticky model going forward. Otherwise, silently re-attach whatever
    // tag is currently sticky, so the user doesn't have to retype it.
    const explicitTag = userText.match(/^:([A-Za-z]+)-([^/]+)\/\s*/);
    const promptToSend = explicitTag || !activeTag ? userText : `${activeTag} ${userText}`;

    try {
      const headers = await getAuthHeaders();
      if (!headers) throw new Error('You must be signed in to use K-XpertAI.');

      const response = await fetch(`${API_BASE}/api/ai/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt: promptToSend, sessionId, projectId: activeProjectId }),
      });

      if (response.status === 401) throw new Error('Your session expired — please sign in again.');
      if (response.status === 429) throw new Error("You're sending messages too fast — give it a minute and try again.");
      if (response.status === 402) {
        const data = await response.json();
        throw new Error(data.error || "You're out of free credits this month.");
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
          if (payload.type === 'step') {
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
      if (typeof finalPayload.creditsRemaining === 'number') {
        setCredits((c) => ({ remaining: finalPayload.creditsRemaining, allowance: c?.allowance ?? 200 }));
      }
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
    ? 'Thinking…'
    : PHASE_LABELS[liveSteps[liveSteps.length - 1].tool] || 'Working…';

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
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-sm h-full bg-kxsurface border-l border-white/10 flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-kxpurple" />
                <span className="font-display font-medium text-[15px]">K-XpertAI</span>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => setShowModelHint((s) => !s)} title="Available models" className="text-kxmist hover:text-white">
                  <Info size={15} />
                </button>
                <button onClick={startNewChat} title="Start a new chat" className="text-kxmist hover:text-white">
                  <RotateCcw size={15} />
                </button>
                <button onClick={clearChat} title="Clear this conversation" className="text-kxmist hover:text-white">
                  <Trash2 size={15} />
                </button>
                <button onClick={() => setOpen(false)} className="text-kxmist hover:text-white">
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-b border-white/8 text-[12.5px]">
              <span className="text-kxmist">Viewing: <span className="text-white">{viewLabel}</span></span>
              <div className="flex items-center gap-3">
                {credits && (
                  <span className="flex items-center gap-1.5 text-kxmist" title="Free credits reset monthly">
                    <Gift size={13} /> {credits.remaining}/{credits.allowance}
                  </span>
                )}
                <span className="flex items-center gap-1.5 text-kxmist">
                  <Wallet size={13} />
                  {balance === null ? '—' : `$${balance.toFixed(2)}`}
                </span>
              </div>
            </div>

            {showModelHint && (
              <div className="mx-5 mt-4 rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-2.5">
                <p className="text-[11px] font-mono uppercase tracking-wider text-kxmist mb-1.5">
                  Type a tag before your message to switch models
                </p>
                <div className="space-y-1">
                  {models.map((m) => (
                    <div key={m.tag} className="flex items-center justify-between text-[11.5px]">
                      <code className="text-kxpurple">{m.tag}</code>
                      <span className="text-kxmist">{m.label}{m.tier === 'free' ? ' · free' : ` · ${m.creditCost} credits`}</span>
                    </div>
                  ))}
                  {!models.length && <p className="text-[11.5px] text-kxmist">Open the drawer while signed in to load the list.</p>}
                </div>
              </div>
            )}

            {activeProjectId && (
              <div className="mx-5 mt-4 rounded-lg border border-green-500/25 bg-green-500/8 px-3.5 py-2.5">
                <p className="text-[11px] font-mono uppercase tracking-wider text-green-400">
                  Project workspace active — I can read, create, edit, and delete files here.
                </p>
              </div>
            )}

            {tip && (
              <div className="mx-5 mt-4 rounded-lg border border-kxpurple/25 bg-kxpurple/8 px-3.5 py-2.5">
                <p className="text-[11px] font-mono uppercase tracking-wider text-kxpurple mb-1">Quick tip</p>
                <p className="text-[12.5px] text-kxmist leading-relaxed">{tip}</p>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
              {isHistoryLoading && <p className="text-[13px] text-kxmist italic">Loading conversation...</p>}
              {!isHistoryLoading && history.length === 0 && (
                <p className="text-[13px] text-kxmist">Ask something — K-XpertAI is live!</p>
              )}
              {history.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[90%] rounded-xl px-3.5 py-2.5 text-[13px] ${
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

                  {m.text}

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
                  <p className="text-[11px] font-mono uppercase tracking-wider text-kxpurple mb-1.5">{currentPhase}</p>
                  {liveSteps.length > 0 && (
                    <div className="space-y-1">
                      {liveSteps.map((s, i) => <StepLine key={i} step={s} />)}
                    </div>
                  )}
                </div>
              )}
            </div>

            {activeTag && (
              <div className="flex items-center justify-between px-4 py-2 border-t border-white/8 bg-white/[0.015]">
                <span className="text-[11.5px] text-kxmist">
                  Using <span className="text-kxpurple font-mono">{models.find((m) => m.tag === activeTag)?.label || activeTag}</span> for this conversation
                </span>
                <button
                  onClick={() => {
                    setActiveTag(null);
                    sessionStorage.removeItem(`kxpert_active_tag_${sessionId}`);
                  }}
                  className="text-[11.5px] text-kxmist hover:text-white"
                >
                  Reset to free
                </button>
              </div>
            )}

            <form onSubmit={send} className="flex items-center gap-2 px-4 py-4 border-t border-white/8">
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={isLoading ? 'Generating...' : 'Ask K-XpertAI… (or :G-pro/, :C-fable/…)'}
                disabled={isLoading}
                className="flex-1 bg-white/[0.02] border border-white/12 rounded-lg px-3 py-2.5 text-[13px] outline-none focus:border-kxblue"
              />
              <button type="submit" disabled={isLoading} className="w-10 h-10 rounded-lg bg-kx-gradient flex items-center justify-center shrink-0">
                <Send size={15} />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
