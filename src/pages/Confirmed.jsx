import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AuthLayout, { SidePanelDefault } from '../components/AuthLayout';
import useSeo from '../lib/useSeo';
import { supabase } from '../lib/supabase';
import { CheckCircle2, XCircle } from 'lucide-react';

const REDIRECT_DELAY_MS = 2200;

export default function Confirmed() {
  useSeo({ title: 'Account confirmed — KingxTech', noindex: true });
  const navigate = useNavigate();
  const [status, setStatus] = useState('checking'); // checking | confirmed | failed

  useEffect(() => {
    let redirectTimer;

    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setStatus('confirmed');
        localStorage.removeItem('kx_pending_verification_email');
        redirectTimer = setTimeout(() => {
          window.location.href = 'https://auth.kingxtech.name.ng/welcome';
        }, REDIRECT_DELAY_MS);
      } else {
        setStatus('failed');
      }
    };

    const t = setTimeout(check, 300);
    return () => { clearTimeout(t); clearTimeout(redirectTimer); };
  }, [navigate]);

  return (
    <AuthLayout side={<SidePanelDefault />}>
      <div className="flex flex-col items-center text-center">
        {status === 'checking' && (
          <>
            <div className="w-12 h-12 rounded-full border-2 border-white/15 border-t-kxblue animate-spin mb-6" />
            <h1 className="font-display text-2xl font-semibold mb-2">Confirming your email…</h1>
            <p className="text-kxmist text-sm">This will only take a moment.</p>
          </>
        )}

        {status === 'confirmed' && (
          <>
            <div className="w-14 h-14 rounded-full bg-emerald-400/10 border border-emerald-400/30 flex items-center justify-center mb-6">
              <CheckCircle2 size={26} className="text-emerald-300" />
            </div>
            <h1 className="font-display text-2xl font-semibold mb-2">Your account is confirmed</h1>
            <p className="text-kxmist text-sm">Taking you to your dashboard…</p>
          </>
        )}

        {status === 'failed' && (
          <>
            <div className="w-14 h-14 rounded-full bg-red-400/10 border border-red-400/30 flex items-center justify-center mb-6">
              <XCircle size={26} className="text-red-400" />
            </div>
            <h1 className="font-display text-2xl font-semibold mb-2">That link didn't work</h1>
            <p className="text-kxmist text-sm mb-6">It may have expired, or already been used. Try signing in — if your account is confirmed, you'll get straight in.</p>
            <button onClick={() => navigate('/login')} className="text-[13px] text-kxblue hover:underline">Go to sign in</button>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
