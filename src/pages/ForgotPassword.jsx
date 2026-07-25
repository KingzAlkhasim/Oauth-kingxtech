import { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthLayout, { SidePanelDefault } from '../components/AuthLayout';
import { Button, Input } from '../components/ui';
import { ArrowLeft, MailCheck } from 'lucide-react';

export default function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => { setLoading(false); setSent(true); }, 700);
  };

  return (
    <AuthLayout side={<SidePanelDefault />}>
      <Link to="/login" className="inline-flex items-center gap-1.5 text-[13px] text-kxmist hover:text-white mb-6">
        <ArrowLeft size={14} /> Back to sign in
      </Link>

      {!sent ? (
        <>
          <h1 className="font-display text-2xl font-semibold mb-1.5">Reset your password</h1>
          <p className="text-kxmist text-sm mb-7">Enter the email on your account and we'll send a reset link.</p>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Input label="Email" type="email" placeholder="you@domain.com" required />
            <Button type="submit" variant="glow" className="w-full mt-1" loading={loading}>Send reset link</Button>
          </form>
        </>
      ) : (
        <div className="animate-fade-up">
          <div className="w-11 h-11 rounded-full bg-emerald-400/10 border border-emerald-400/30 flex items-center justify-center mb-5">
            <MailCheck size={20} className="text-emerald-300" />
          </div>
          <h1 className="font-display text-2xl font-semibold mb-1.5">Check your inbox</h1>
          <p className="text-kxmist text-sm leading-relaxed">
            If an account matches that email, a reset link is on its way. It expires in 30 minutes.
          </p>
        </div>
      )}
    </AuthLayout>
  );
}
