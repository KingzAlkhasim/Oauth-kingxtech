import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout, { SidePanelDefault } from '../components/AuthLayout';
import { Button, OTPInput } from '../components/ui';
import { ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { redirectWithSession } from '../lib/ssoHandoff';
import { logActivity } from '../lib/activity';

export default function TwoFactor() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get('redirect');
  const factorId = params.get('factorId');

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    if (!factorId) {
      setError('No authenticator factor found for this account. Try signing in again.');
      return;
    }

    setLoading(true);
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) {
      setLoading(false);
      setError(challengeError.message);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });

    setLoading(false);
    if (verifyError) {
      setError(verifyError.message);
      return;
    }

    logActivity('Signed in', `${navigator.userAgent.slice(0, 50)} (2FA)`);
    if (redirect) { redirectWithSession(redirect); return; }
    navigate('/welcome');
  };

  return (
    <AuthLayout side={<SidePanelDefault />}>
      <div className="w-11 h-11 rounded-full bg-kxpurple/10 border border-kxpurple/25 flex items-center justify-center mb-5">
        <ShieldCheck size={20} className="text-kxpurple" />
      </div>
      <h1 className="font-display text-2xl font-semibold mb-1.5">Two-factor authentication</h1>
      <p className="text-kxmist text-sm mb-8">Enter the 6-digit code from your authenticator app.</p>

      {error && (
        <p className="text-[12.5px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-6">
          {error}
        </p>
      )}

      <form onSubmit={submit} className="flex flex-col gap-6">
        <OTPInput onChange={setCode} />
        <Button type="submit" variant="glow" className="w-full" loading={loading} disabled={code.length < 6}>
          Verify &amp; continue
        </Button>
      </form>
    </AuthLayout>
  );
}
