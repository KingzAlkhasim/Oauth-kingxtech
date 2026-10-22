import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { acceptProjectInvite } from '../lib/projectCollaboration';
import { friendlyError } from '../lib/errors';

export default function ProjectInvite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('Checking your invitation…');

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      if (!data.session) {
        const next = `/invite/${encodeURIComponent(token || '')}`;
        navigate(`/login?redirect=${encodeURIComponent(next)}`, { replace: true });
        return;
      }
      setSession(data.session);
      try {
        const result = await acceptProjectInvite(token || '');
        if (!alive) return;
        setStatus('success');
        setMessage('You joined the project.');
        navigate(`/projects/${result.project_id}/workspace`, { replace: true });
      } catch (error) {
        if (!alive) return;
        setStatus('error');
        setMessage(friendlyError(error, 'This invitation is no longer available.'));
      }
    }).catch(() => { if (alive) { setStatus('error'); setMessage('We could not verify your invitation. Please sign in again.'); } });
    return () => { alive = false; };
  }, [token, navigate]);

  if (status === 'loading' && !session) return <main className="min-h-[100dvh] flex items-center justify-center p-6 bg-kxbg text-white"><div className="text-center"><div className="text-lg font-semibold">KingxTech invitation</div><p className="text-sm text-kxmist mt-2">Redirecting you to sign in…</p></div></main>;
  return <main className="min-h-[100dvh] flex items-center justify-center p-6 bg-kxbg text-white"><div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-center"><div className="text-lg font-semibold">KingxTech invitation</div><p className="text-sm text-kxmist mt-3">{message}</p>{status === 'error' && <button type="button" onClick={() => navigate('/projects')} className="mt-5 min-h-11 px-5 rounded-xl bg-white text-black">Back to projects</button>}</div></main>;
}