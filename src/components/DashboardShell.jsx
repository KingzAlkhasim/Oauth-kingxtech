import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Logo from './Logo';
import CommandPalette from './CommandPalette';
import { supabase } from '../lib/supabase';
import useCurrentUser, { initials } from '../lib/useCurrentUser';
import { LayoutDashboard, FolderKanban, Settings, Monitor, LogOut, Menu, X, Search, TerminalSquare, Activity as ActivityIcon, Wallet, Globe } from 'lucide-react';
import KXpertDrawer from './KXpertDrawer';

const NAV = [
  { to: '/welcome', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/console', label: 'Console', icon: TerminalSquare },
  { to: '/domains', label: 'Domains', icon: Globe },
  { to: '/billing', label: 'Billing', icon: Wallet },
  { to: '/activity', label: 'Activity', icon: ActivityIcon },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/sessions', label: 'Sessions', icon: Monitor },
];

export default function DashboardShell({ children, fullWidth = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useCurrentUser();
  const [mobileOpen, setMobileOpen] = useState(false);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  const SidebarContent = (
    <div className="flex flex-col h-full">
      <Link to="/welcome" className="px-5 pt-5 pb-4">
        <Logo size={28} />
      </Link>

      <button
        onClick={() => { setMobileOpen(false); window.dispatchEvent(new Event('kx:open-command-palette')); }}
        className="mx-3 mb-3 flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-[13px] text-kxmist hover:border-white/20 hover:text-white transition-colors"
      >
        <Search size={14} /> Quick jump
        <kbd className="ml-auto text-[10px] font-mono border border-white/10 rounded px-1.5 py-0.5">⌘K</kbd>
      </button>

      <nav className="flex-1 flex flex-col gap-1 px-3">
        {NAV.map(({ to, label, icon: Icon }) => {
          const active = location.pathname === to;
          return (
            <Link
              key={to}
              to={to}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13.5px] transition-colors ${
                active ? 'bg-white/8 text-white' : 'text-kxmist hover:text-white hover:bg-white/[0.03]'
              }`}
            >
              <Icon size={16} className={active ? 'text-kxblue' : ''} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pb-4 pt-3 border-t border-white/8 mt-3">
        <div className="flex items-center gap-3 px-2 py-2">
          <span className="w-8 h-8 rounded-full bg-kx-gradient flex items-center justify-center text-[11px] font-semibold shrink-0">
            {initials(user)}
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-medium truncate">{user?.user_metadata?.full_name || 'Your account'}</p>
            <p className="text-[11.5px] text-kxmistdim truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={signOut}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] text-kxmist hover:text-white hover:bg-white/[0.03] transition-colors mt-1"
        >
          <LogOut size={15} /> Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-kxbg text-white lg:flex">
      <CommandPalette />
      <KXpertDrawer />

      {/* Mobile top bar */}
      <div className="lg:hidden flex items-center justify-between px-4 h-14 border-b border-white/8 sticky top-0 z-20 bg-kxbg/90 backdrop-blur-xl">
        <Link to="/welcome"><Logo size={26} /></Link>
        <button onClick={() => setMobileOpen(true)} className="w-9 h-9 flex items-center justify-center rounded-lg border border-white/12">
          <Menu size={16} />
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-30 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div className="relative w-72 bg-kxsurface border-r border-white/10 h-full">
            <button onClick={() => setMobileOpen(false)} className="absolute top-4 right-4 text-kxmist hover:text-white">
              <X size={18} />
            </button>
            {SidebarContent}
          </div>
        </div>
      )}

      {/* Desktop sidebar — floating rounded panel */}
      <aside className="hidden lg:block w-64 shrink-0 p-4">
        <div className="h-[calc(100vh-2rem)] rounded-[20px] border border-white/10 bg-white/[0.015] sticky top-4">
          {SidebarContent}
        </div>
      </aside>

      <main className={`flex-1 px-4 sm:px-6 py-6 sm:py-10 lg:px-12 lg:py-12 min-w-0 ${fullWidth ? 'max-w-none' : 'max-w-4xl'}`}>{children}</main>
    </div>
  );
}
