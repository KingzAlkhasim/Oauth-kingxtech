import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout, { SidePanelDefault } from '../components/AuthLayout';
import Stepper from '../components/Stepper';
import { Button, Input, Divider, SocialButtons } from '../components/ui';
import { ArrowLeft, Check } from 'lucide-react';
import useSeo from '../lib/useSeo';
import { supabase } from '../lib/supabase';

const ROLES = ['Frontend Developer', 'Backend Developer', 'Full Stack Developer', 'Mobile Developer', 'AI Engineer', 'Machine Learning Engineer', 'DevOps Engineer', 'Security Engineer', 'Data Scientist', 'Game Developer', 'Student', 'Researcher', 'Designer', 'Entrepreneur', 'Other'];
const STACK = ['JavaScript', 'TypeScript', 'Python', 'PHP', 'Rust', 'C++', 'Java', 'Go', 'React', 'Vue', 'Angular', 'Node.js', 'Laravel', 'Next.js', 'Django', 'Flask', 'Docker', 'Kubernetes', 'TensorFlow', 'PyTorch', 'HuggingFace', 'Unsloth', 'PostgreSQL', 'MySQL', 'MongoDB'];
const EXPERIENCE = ['Beginner', 'Junior', 'Mid-level', 'Senior', 'Expert'];
const USER_TYPES = ['Individual', 'Student', 'Developer', 'Startup', 'Team', 'Company', 'Researcher'];

const TOTAL_STEPS = 9; // 8 data steps + review

function RadioGrid({ options, value, onChange, columns = 2 }) {
  const colClass = columns === 1 ? 'grid-cols-1' : 'grid-cols-2';
  return (
    <div className={`grid ${colClass} gap-2.5`}>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`text-left text-[13.5px] px-3.5 py-2.5 rounded-lg border transition-colors ${
            value === opt ? 'border-kxblue bg-kxblue/10 text-white' : 'border-white/12 bg-white/[0.02] text-kxmist hover:border-white/25'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function ChipMultiSelect({ options, values, onToggle }) {
  return (
    <div className="flex flex-wrap gap-2 max-h-72 overflow-y-auto pr-1">
      {options.map((opt) => {
        const active = values.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className={`text-[13px] px-3 py-1.5 rounded-full border transition-colors ${
              active ? 'border-kxpurple bg-kxpurple/15 text-white' : 'border-white/12 bg-white/[0.02] text-kxmist hover:border-white/25'
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export default function SignUp() {
  useSeo({ title: 'Create your account — KingxTech', noindex: false });
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const [form, setForm] = useState({
    email: '', password: '', confirmPassword: '',
    fullName: '', username: '',
    role: '', stack: [], experience: '', userType: '',
    company: '', github: '',
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleStack = (v) => setForm((f) => ({ ...f, stack: f.stack.includes(v) ? f.stack.filter((s) => s !== v) : [...f.stack, v] }));

  const next = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        emailRedirectTo: 'https://auth.kingxtech.name.ng/confirmed',
        data: {
          full_name: form.fullName,
          username: form.username,
          developer_role: form.role,
          tech_stack: form.stack,
          experience_level: form.experience,
          user_type: form.userType,
          company_name: form.company || null,
          github_url: form.github || null,
        },
      },
    });

    setLoading(false);

    if (signUpError) {
      console.error('Supabase signUp error:', signUpError);
      setError(signUpError.message);
      return;
    }

    // Supabase returns a "successful" response with no error even when the
    // email is already registered (an anti-enumeration measure) — the giveaway
    // is an empty identities array. Without this check, re-testing with the
    // same email looks like signup "does nothing".
    if (signUpData?.user && signUpData.user.identities?.length === 0) {
      setError('That email is already registered. Try signing in instead, or use "Forgot password" if you need to reset it.');
      return;
    }

    localStorage.setItem('kx_pending_verification_email', form.email);
    navigate('/verify-email', { state: { email: form.email } });
  };

  const socialSignUp = async (provider) => {
    setError('');
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: 'https://auth.kingxtech.name.ng/welcome' },
    });
    if (oauthError) setError(oauthError.message);
  };

  const githubValid = !form.github || /^https:\/\/(www\.)?github\.com\/[A-Za-z0-9-]+\/?$/.test(form.github);

  return (
    <AuthLayout side={<SidePanelDefault />}>
      {step === 0 ? (
        <>
          <h1 className="font-display text-2xl font-semibold mb-1.5">Create your account</h1>
          <p className="text-kxmist text-sm mb-7">One identity for every KingxTech product.</p>
          <SocialButtons onSelect={socialSignUp} />
          <Divider label="or" />
        </>
      ) : (
        <button onClick={back} className="inline-flex items-center gap-1.5 text-[13px] text-kxmist hover:text-white mb-5">
          <ArrowLeft size={14} /> Back
        </button>
      )}

      {error && (
        <p className="text-[12.5px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-5">
          {error}
        </p>
      )}

      <Stepper steps={Array.from({ length: TOTAL_STEPS })} current={step} />

      <form onSubmit={(e) => { e.preventDefault(); step === TOTAL_STEPS - 1 ? submit(e) : next(); }} className="flex flex-col gap-5">
        {step === 0 && (
          <div className="flex flex-col gap-4">
            <Input label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required />
            <Input label="Password" type="password" value={form.password} onChange={(e) => set('password', e.target.value)} required />
            <Input
              label="Confirm password" type="password" value={form.confirmPassword}
              onChange={(e) => set('confirmPassword', e.target.value)}
              error={form.confirmPassword && form.confirmPassword !== form.password ? "Passwords don't match" : undefined}
              required
            />
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-lg font-medium">What should we call you?</h2>
            <Input label="Full name" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} required />
            <Input
              label="Username" value={form.username}
              onChange={(e) => set('username', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              hint="Lowercase, 3–20 characters." required minLength={3} maxLength={20}
            />
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-lg font-medium">What's your role?</h2>
            <RadioGrid options={ROLES} value={form.role} onChange={(v) => set('role', v)} />
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-lg font-medium">Your tech stack</h2>
            <p className="text-[13px] text-kxmist -mt-2">Pick everything that applies.</p>
            <ChipMultiSelect options={STACK} values={form.stack} onToggle={toggleStack} />
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-lg font-medium">Experience level</h2>
            <RadioGrid options={EXPERIENCE} value={form.experience} onChange={(v) => set('experience', v)} columns={1} />
          </div>
        )}

        {step === 5 && (
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-lg font-medium">How would you describe yourself?</h2>
            <RadioGrid options={USER_TYPES} value={form.userType} onChange={(v) => set('userType', v)} />
          </div>
        )}

        {step === 6 && (
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-lg font-medium">Company</h2>
            <Input label="Company name (optional)" value={form.company} onChange={(e) => set('company', e.target.value)} placeholder="Leave blank if not applicable" />
          </div>
        )}

        {step === 7 && (
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-lg font-medium">Link your GitHub</h2>
            <Input
              label="GitHub profile URL (optional)" value={form.github}
              onChange={(e) => set('github', e.target.value)}
              placeholder="https://github.com/yourname"
              error={!githubValid ? 'Enter a valid GitHub profile URL' : undefined}
            />
          </div>
        )}

        {step === 8 && (
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-lg font-medium mb-1">Review &amp; confirm</h2>
            {[
              ['Full name', form.fullName || '—'],
              ['Username', form.username ? `@${form.username}` : '—'],
              ['Email', form.email || '—'],
              ['Role', form.role || '—'],
              ['Tech stack', form.stack.length ? form.stack.join(', ') : '—'],
              ['Experience', form.experience || '—'],
              ['Account type', form.userType || '—'],
              ['Company', form.company || '—'],
              ['GitHub', form.github || '—'],
            ].map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-4 py-2.5 border-b border-white/8 text-sm">
                <span className="text-kxmist">{k}</span>
                <span className="text-right max-w-[60%]">{v}</span>
              </div>
            ))}
          </div>
        )}

        <Button
          type="submit"
          variant="glow"
          className="w-full mt-1"
          loading={step === TOTAL_STEPS - 1 && loading}
          disabled={
            (step === 0 && (!form.email || !form.password || form.password !== form.confirmPassword)) ||
            (step === 1 && (!form.fullName || form.username.length < 3)) ||
            (step === 2 && !form.role) ||
            (step === 4 && !form.experience) ||
            (step === 5 && !form.userType) ||
            (step === 7 && !githubValid)
          }
        >
          {step === TOTAL_STEPS - 1 ? (<><Check size={16} /> Create account</>) : 'Continue'}
        </Button>
      </form>

      {(step === 0 || error.includes('already registered')) && (
        <p className="text-center text-sm text-kxmist mt-7">
          Already have an account? <Link to="/login" className="text-white hover:underline">Sign in</Link>
        </p>
      )}
    </AuthLayout>
  );
}
