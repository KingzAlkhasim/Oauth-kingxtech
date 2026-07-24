import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout, { SidePanelDefault } from '../components/AuthLayout';
import { Button, Input, Checkbox, Divider, SocialButtons } from '../components/ui';
import { KeyRound } from 'lucide-react';
import useSeo from '../lib/useSeo';
import { supabase } from '../lib/supabase';
import { redirectWithSession } from '../lib/ssoHandoff';
import { logActivity } from '../lib/activity';

export default function SignIn() {
  useSeo({ title: 'Sign in — KingxTech', noindex: false });
  const [remember, setRemember] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get('redirect');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);
    if (authError) {
      setError(authError.message);
      return;
    }

    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const factorId = factors?.totp?.[0]?.id;
      navigate(`/2fa?factorId=${factorId}` + (redirect ? `&redirect=${encodeURIComponent(redirect)}` : ''));
    } else {
      logActivity('Signed in', navigator.userAgent.slice(0, 60));
      if (redirect) { redirectWithSession(redirect); } else { navigate('/welcome'); }
    }
  };

  const socialSignIn = async (provider) => {
    setError('');
    const redirectTo = redirect
      ? `https://auth.kingxtech.name.ng/welcome?redirect=${encodeURIComponent(redirect)}`
      : 'https://auth.kingxtech.name.ng/welcome';
    const { error: oauthError } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
    if (oauthError) setError(oauthError.message);
  };

  return (
    <AuthLayout side={<SidePanelDefault />}>
      <h1 className="font-display text-2xl font-semibold mb-1.5">Sign in to KingxTech</h1>
      <p className="text-kxmist text-sm mb-7">Access K-XpertAI, SynthCode, and the future of developer tools.</p>

      {redirect && (
        <p className="text-[12px] font-mono text-kxblue/90 bg-kxblue/10 border border-kxblue/20 rounded-lg px-3 py-2 mb-6">
          Continuing to {redirect}
        </p>
      )}

      {error && (
        <p className="text-[12.5px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-6">
          {error}
        </p>
      )}

      <SocialButtons onSelect={socialSignIn} />
      <Divider label="or" />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input label="Email" type="email" placeholder="you@domain.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input label="Password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <div className="flex items-center justify-between -mt-1">
          <Checkbox label="Remember me" checked={remember} onChange={setRemember} />
          <Link to="/forgot-password" className="text-[13px] text-kxblue hover:underline">Forgot password?</Link>
        </div>
        <Button type="submit" variant="glow" className="w-full mt-1" loading={loading}>Continue</Button>
        <Button type="button" variant="subtle" className="w-full">
          <KeyRound size={15} /> Sign in with a passkey
        </Button>
      </form>

      <p className="text-center text-sm text-kxmist mt-7">
        Don't have an account? <Link to="/signup" className="text-white hover:underline">Create account</Link>
      </p>
    </AuthLayout>
  );
}
