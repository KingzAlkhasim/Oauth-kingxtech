import { useEffect, useState } from 'react';
import DashboardShell from '../components/DashboardShell';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import { listActivity } from '../lib/activity';
import { Card } from '../components/ui';
import {
  Activity as ActivityIcon, LogIn, KeyRound, ShieldCheck, User, FolderKanban, Plug, Ticket,
} from 'lucide-react';

const ICONS = {
  'Signed in': LogIn,
  'Password changed': KeyRound,
  '2FA enabled': ShieldCheck,
  '2FA disabled': ShieldCheck,
  'Profile updated': User,
  'Profile picture updated': User,
  'Project created': FolderKanban,
  'Project updated': FolderKanban,
  'Project deleted': FolderKanban,
  'API key created': KeyRound,
  'API key revoked': KeyRound,
  'Webhook added': Plug,
  'Webhook removed': Plug,
  'Support ticket submitted': Ticket,
};

export default function Activity() {
  useSeo({ title: 'Activity — KingxTech', noindex: true });
  useRequireAuth();
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    listActivity().then(({ data, error: listError }) => {
      if (listError) { setError(/relation .*activity_log.* does not exist/i.test(listError.message) ? 'SETUP' : listError.message); return; }
      setEntries(data);
    });
  }, []);

  if (error === 'SETUP') {
    return (
      <DashboardShell>
        <h1 className="font-display text-2xl font-semibold mb-4">Activity</h1>
        <Card className="p-6 rounded-[20px]">
          <p className="text-sm text-kxmist leading-relaxed">
            The <code className="text-white font-mono">activity_log</code> table doesn't exist yet.
            Run <code className="text-white font-mono">supabase/migrations/007_activity_log.sql</code> once in the Supabase SQL Editor to start recording real events.
          </p>
        </Card>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <h1 className="font-display text-2xl font-semibold mb-1">Activity</h1>
      <p className="text-kxmist text-sm mb-8">A real, chronological record of what's actually happened on your account — nothing here is sample data.</p>

      {error && error !== 'SETUP' && (
        <p className="text-[12.5px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-5">{error}</p>
      )}

      {entries === null && !error && <p className="text-sm text-kxmist">Loading…</p>}

      {entries !== null && entries.length === 0 && (
        <Card className="p-10 rounded-[20px] flex flex-col items-center text-center gap-3">
          <ActivityIcon size={28} className="text-kxmist" />
          <p className="text-sm text-kxmist">Nothing recorded yet — actions like signing in, changing your password, or enabling 2FA will show up here as they happen.</p>
        </Card>
      )}

      {entries !== null && entries.length > 0 && (
        <Card className="p-2 rounded-[20px]">
          {entries.map((e, i) => {
            const Icon = ICONS[e.action] || ActivityIcon;
            return (
              <div key={e.id} className={`flex items-center gap-3 px-4 py-3.5 ${i !== entries.length - 1 ? 'border-b border-white/6' : ''}`}>
                <span className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center shrink-0">
                  <Icon size={14} className="text-kxmist" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{e.action}</p>
                  {e.detail && <p className="text-[12.5px] text-kxmist truncate">{e.detail}</p>}
                </div>
                <span className="text-[11.5px] font-mono text-kxmistdim shrink-0">{new Date(e.created_at).toLocaleString()}</span>
              </div>
            );
          })}
        </Card>
      )}
    </DashboardShell>
  );
}
