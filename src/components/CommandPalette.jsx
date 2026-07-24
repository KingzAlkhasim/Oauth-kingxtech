import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, LayoutDashboard, FolderKanban, Settings, Monitor, LogOut, Plus, TerminalSquare, Activity as ActivityIcon, Wallet, Globe } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const navigate = useNavigate();

  const actions = useMemo(() => [
    { id: 'welcome', label: 'Go to dashboard', icon: LayoutDashboard, run: () => navigate('/welcome') },
    { id: 'projects', label: 'Go to projects', icon: FolderKanban, run: () => navigate('/projects') },
    { id: 'new-project', label: 'New project', icon: Plus, run: () => navigate('/projects?new=1') },
    { id: 'console', label: 'Go to console', icon: TerminalSquare, run: () => navigate('/console') },
    { id: 'domains', label: 'Go to domains', icon: Globe, run: () => navigate('/domains') },
    { id: 'billing', label: 'Go to billing', icon: Wallet, run: () => navigate('/billing') },
    { id: 'activity', label: 'Go to activity', icon: ActivityIcon, run: () => navigate('/activity') },
    { id: 'settings', label: 'Go to settings', icon: Settings, run: () => navigate('/settings') },
    { id: 'sessions', label: 'Go to sessions', icon: Monitor, run: () => navigate('/sessions') },
    { id: 'signout', label: 'Sign out', icon: LogOut, run: async () => { await supabase.auth.signOut(); navigate('/login'); } },
  ], [navigate]);

  const filtered = actions.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    const onOpenEvent = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('kx:open-command-palette', onOpenEvent);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('kx:open-command-palette', onOpenEvent);
    };
  }, []);

  useEffect(() => { setActiveIndex(0); }, [query]);

  const runAt = (i) => {
    const action = filtered[i];
    if (!action) return;
    setOpen(false);
    setQuery('');
    action.run();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center pt-[15vh] bg-black/60" onClick={() => setOpen(false)}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-[20px] border border-white/12 bg-kxsurface shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/8">
          <Search size={16} className="text-kxmist" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, filtered.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
              if (e.key === 'Enter') { e.preventDefault(); runAt(activeIndex); }
            }}
            placeholder="Jump to…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-white/30"
          />
          <kbd className="text-[10px] font-mono text-kxmistdim border border-white/10 rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        <div className="max-h-72 overflow-y-auto py-1.5">
          {filtered.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-kxmist">No matches.</p>}
          {filtered.map(({ id, label, icon: Icon }, i) => (
            <button
              key={id}
              onClick={() => runAt(i)}
              onMouseEnter={() => setActiveIndex(i)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-[13.5px] text-left transition-colors ${
                i === activeIndex ? 'bg-white/8 text-white' : 'text-kxmist'
              }`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
