import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout, { SidePanelDefault } from '../components/AuthLayout';
import { Button, Input } from '../components/ui';
import { supabase } from '../lib/supabase';
import { useEnsureAal2 } from '../lib/ensureAal2';

function strengthOf(pw) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}
const LABELS = ['Very weak', 'Weak', 'Okay', 'Good', 'Strong'];
const COLORS = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-blue-400', 'bg-emerald-400'];

function isAalError(error) {
  const message = error?.message?.toLowerCase() || '';
  return ['mfa_required', 'insufficient_aal'].includes(error?.code) ||
    message.includes('aal2') || message.includes('assurance level') || message.includes('multi-factor authentication');
}

export default function ResetPassword() {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingRecovery, setCheckingRecovery] = useState(true);
  const [validRecovery, setValidRecovery] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const score = useMemo(() => strengthOf(pw), [pw]);
  const { ensureAal2, modal: aal2Modal } = useEnsureAal2();

  useEffect(() => {
    let active = true;
    let recoveryEventSeen = false;
    const hasRecoveryMarker = () => {
      const query = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      return query.get('type') === 'recovery' || hash.get('type') === 'recovery' || query.has('code');
    };
    const refreshRecoveryValidity = () => {
      supabase.auth.getSession().then(({ data, error: sessionError }) => {
        if (!active) return;
        const hasRecoveryFlag = sessionStorage.getItem('kx_password_recovery') === '1';
        setValidRecovery(!sessionError && Boolean(data.session) &&
          (hasRecoveryFlag || recoveryEventSeen || hasRecoveryMarker()));
        setCheckingRecovery(false);
      }).catch(() => {
        if (active) setCheckingRecovery(false);
      });
    };
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        recoveryEventSeen = true;
        refreshRecoveryValidity();
      }
    });

    refreshRecoveryValidity();
    return () => {
      active = false;
      listener.subscription.unsubscribe();
      sessionStorage.removeItem('kx_password_recovery');
    };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (pw.length < 8) { setError('Your password must be at least 8 characters long.'); return; }
    if (pw !== confirm) { setError("Passwords don't match."); return; }

    setLoading(true);
    try {
      let { error: updateError } = await supabase.auth.updateUser({ password: pw });
      if (updateError && isAalError(updateError)) {
        const verified = await ensureAal2();
        if (!verified) return;
        ({ error: updateError } = await supabase.auth.updateUser({ password: pw }));
      }
      if (updateError) { setError(updateError.message || 'We couldn’t update your password. Please try again.'); return; }
      sessionStorage.removeItem('kx_password_recovery');
      await supabase.auth.signOut();
      navigate('/login', { replace: true, state: { notice: 'Password updated. Sign in with your new password.' } });
    } catch (err) {
      setError(err.message || 'We couldn’t update your password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout side={<SidePanelDefault />}>
      {checkingRecovery ? <p className="text-sm text-kxmist">Checking your reset link…</p> : !validRecovery ? (
        <>
          <h1 className="font-display text-2xl font-semibold mb-1.5">This reset link is invalid or has expired</h1>
          <p className="text-kxmist text-sm mb-7">Request a new password reset link to continue.</p>
          <Link to="/forgot-password" className="inline-flex items-center justify-center rounded-full bg-kx-gradient text-white text-sm font-semibold px-5 py-2.5">Request a new reset link</Link>
        </>
      ) : (
        <>
          <h1 className="font-display text-2xl font-semibold mb-1.5">Set a new password</h1>
          <p className="text-kxmist text-sm mb-7">Choose something you haven’t used before on KingxTech.</p>
          {error && <p role="alert" className="text-[12.5px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-4">{error}</p>}
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div>
              <Input label="New password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} autoComplete="new-password" required />
              {pw && <div className="mt-2"><div className="flex gap-1.5">{Array.from({ length: 4 }).map((_, i) => <span key={i} className={`h-1 flex-1 rounded-full ${i < score ? COLORS[score] : 'bg-white/10'}`} />)}</div><span className="text-[12px] text-kxmist mt-1 block">{LABELS[score]}</span></div>}
            </div>
            <Input label="Confirm password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={confirm && confirm !== pw ? "Passwords don't match" : undefined} autoComplete="new-password" required />
            <Button type="submit" variant="glow" className="w-full mt-1" loading={loading} disabled={pw.length < 8 || pw !== confirm}>Reset password</Button>
          </form>
          {aal2Modal}
        </>
      )}
    </AuthLayout>
  );
}
