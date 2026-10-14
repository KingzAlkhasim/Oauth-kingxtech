import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, LogIn, ShieldAlert } from 'lucide-react';
import { Button, Card } from '../components/ui';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import { acceptProjectInvite } from '../lib/collaboration';

export default function InviteAccept() {
  useSeo({ title: 'Project invitation — KingxTech', noindex: true });
  const { token } = useParams(); const navigate = useNavigate();
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [loading, setLoading] = useState(false); const [authenticated, setAuthenticated] = useState(null);
  useEffect(() => { import('../lib/supabase').then(({ supabase }) => supabase.auth.getUser().then(({ data }) => setAuthenticated(!!data.user))); }, []);
  const accept = async () => { setLoading(true); setError(''); setNotice(''); try { const result = await acceptProjectInvite(token); setNotice('You joined the project.'); if (result.member?.project_id) navigate(`/projects/${result.member.project_id}/workspace`, { replace: true }); } catch (e) { setError(e.message || 'This invitation could not be accepted.'); } finally { setLoading(false); } };
  if (authenticated === false) { const returnTo = `/invite/${encodeURIComponent(token || '')}`; return <main className="min-h-[100dvh] flex items-center justify-center p-4 bg-kxbg"><Card className="w-full max-w-md p-6 rounded-[22px] text-center"><ShieldAlert size={28} className="mx-auto text-kxpurple mb-3" /><h1 className="font-display text-2xl font-semibold">You have a project invitation</h1><p className="text-sm text-kxmist mt-2">Sign in to the KingxTech account that received the invitation, then come back here.</p><Link to={`/login?redirect=${encodeURIComponent(returnTo)}`} className="mt-5 w-full min-h-11 inline-flex items-center justify-center gap-2 rounded-lg bg-kxpurple text-white text-sm font-medium"><LogIn size={15} /> Sign in to continue</Link></Card></main>; }
  return <main className="min-h-[100dvh] flex items-center justify-center p-4 bg-kxbg"><Card className="w-full max-w-md p-6 rounded-[22px] text-center"><Check size={28} className="mx-auto text-kxblue mb-3" /><h1 className="font-display text-2xl font-semibold">Accept project invitation</h1><p className="text-sm text-kxmist mt-2">This link is single-use and expires after 7 days. Your account email must match the invited email.</p>{error && <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mt-4">{error}</p>}{notice && <p className="text-sm text-kxblue mt-4">{notice}</p>}<Button onClick={accept} loading={loading} disabled={!token || authenticated !== true} className="w-full min-h-11 mt-5">Accept invitation</Button></Card></main>;
}
