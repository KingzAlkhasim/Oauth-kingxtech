import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AuthLayout, { SidePanelDefault } from '../components/AuthLayout';
import { Button, Input } from '../components/ui';

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

export default function ResetPassword() {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const score = useMemo(() => strengthOf(pw), [pw]);

  const submit = (e) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => navigate('/login'), 700);
  };

  return (
    <AuthLayout side={<SidePanelDefault />}>
      <h1 className="font-display text-2xl font-semibold mb-1.5">Set a new password</h1>
      <p className="text-kxmist text-sm mb-7">Choose something you haven't used before on KingxTech.</p>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <Input label="New password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} required />
          {pw && (
            <div className="mt-2">
              <div className="flex gap-1.5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <span key={i} className={`h-1 flex-1 rounded-full ${i < score ? COLORS[score] : 'bg-white/10'}`} />
                ))}
              </div>
              <span className="text-[12px] text-kxmist mt-1 block">{LABELS[score]}</span>
            </div>
          )}
        </div>
        <Input
          label="Confirm password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={confirm && confirm !== pw ? "Passwords don't match" : undefined}
          required
        />
        <Button type="submit" variant="glow" className="w-full mt-1" loading={loading} disabled={!pw || pw !== confirm}>
          Reset password
        </Button>
      </form>
    </AuthLayout>
  );
}
