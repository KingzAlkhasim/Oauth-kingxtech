import { useEffect, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import AuthLayout, { SidePanelDefault } from '../components/AuthLayout';
import { Button } from '../components/ui';
import { MailCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function VerifyEmail() {
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const email = location.state?.email || localStorage.getItem('kx_pending_verification_email') || '';

  useEffect(() => {
    const finish = (session) => {
      if (!session) return;
      localStorage.removeItem('kx_pending_verification_email');
      navigate('/confirmed');
    };
    supabase.auth.getSession().then(({ data }) => finish(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') finish(session);
    });
    const poll = setInterval(() => {
      supabase.auth.getSession().then(({ data }) => finish(data.session));
    }, 3000);
    return () => { listener.subscription.unsubscribe(); clearInterval(poll); };
  }, [navigate]);

  const resend = async () => {
    setError('');
    setNotice('');
    setResending(true);
    const { error: resendError } = await supabase.auth.resend({ type: 'signup', email });
    setResending(false);
    if (resendError) { setError(resendError.message); return; }
    setNotice('Email resent — check your inbox.');
  };

  if (!email) {
    return (
      <AuthLayout side={<SidePanelDefault />}>
        <div className="w-11 h-11 rounded-full bg-kxblue/10 border border-kxblue/25 flex items-center justify-center mb-5">
          <MailCheck size={20} className="text-kxblue" />
        </div>
        <h1 className="font-display text-2xl font-semibold mb-1.5">Verify your email</h1>
        <p className="text-kxmist text-sm mb-6">
          We couldn't find which email to verify. Start sign-up again to get a fresh confirmation email.
        </p>
        <Link to="/signup"><Button variant="glow">Back to sign up</Button></Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout side={<SidePanelDefault />}>
      <div className="w-11 h-11 rounded-full bg-kxblue/10 border border-kxblue/25 flex items-center justify-center mb-5">
        <MailCheck size={20} className="text-kxblue" />
      </div>
      <h1 className="font-display text-2xl font-semibold mb-1.5">Check your email</h1>
      <p className="text-kxmist text-sm mb-2">
        We sent a confirmation link to <span className="text-white">{email}</span>.
      </p>
      <p className="text-kxmist text-sm mb-8">
        Click it, and this page will pick that up automatically — no need to come back and refresh.
      </p>

      {error && (
        <p className="text-[12.5px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-5">
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="text-[12.5px] text-emerald-300 bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-3 py-2 mb-5">
          {notice}
        </p>
      )}

      <div className="flex items-center gap-3 mb-8">
        <span className="w-4 h-4 rounded-full border-2 border-white/15 border-t-kxblue animate-spin shrink-0" />
        <span className="text-[13px] text-kxmist">Waiting for confirmation…</span>
      </div>

      <button onClick={resend} disabled={resending} className="text-[13px] text-kxmist hover:text-white disabled:opacity-50">
        {resending ? 'Resending…' : "Didn't get it? Resend email"}
      </button>
    </AuthLayout>
  );
}
