import { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthLayout, { SidePanelDefault } from '../components/AuthLayout';
import { Button, Input } from '../components/ui';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) {
        const message = resetError.message?.toLowerCase() || '';
        if (resetError.status === 429 || message.includes('rate limit') || message.includes('too many')) {
          setError('Too many reset requests. Please wait a little before trying again.');
          return;
        }
        if (resetError.status >= 500 || message.includes('network') || message.includes('fetch') || message.includes('timeout')) {
          setError('We couldn’t send the reset email. Check your connection and try again.');
          return;
        }
        // Account-specific responses are treated like success to avoid revealing account existence.
      }
      setSent(true);
    } catch {
      setError('We couldn’t send the reset email. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout side={<SidePanelDefault />}>
      <Link to="/login" className="inline-flex items-center gap-1.5 text-[13px] text-kxmist hover:text-white mb-6">
        <ArrowLeft size={14} /> Back to sign in
      </Link>
      {!sent ? (
        <>
          <h1 className="font-display text-2xl font-semibold mb-1.5">Reset your password</h1>
          <p className="text-kxmist text-sm mb-7">Enter the email on your account and we’ll send a reset link.</p>
          {error && <p role="alert" className="text-[12.5px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-4">{error}</p>}
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Input label="Email" type="email" placeholder="you@domain.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            <Button type="submit" variant="glow" className="w-full mt-1" loading={loading}>Send reset link</Button>
          </form>
        </>
      ) : (
        <div className="animate-fade-up">
          <div className="w-11 h-11 rounded-full bg-emerald-400/10 border border-emerald-400/30 flex items-center justify-center mb-5"><MailCheck size={20} className="text-emerald-300" /></div>
          <h1 className="font-display text-2xl font-semibold mb-1.5">Check your inbox</h1>
          <p className="text-kxmist text-sm leading-relaxed">If an account matches that email, a reset link is on its way. The link expires in 1 hour.</p>
        </div>
      )}
    </AuthLayout>
  );
}
