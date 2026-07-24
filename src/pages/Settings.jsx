import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import DashboardShell from '../components/DashboardShell';
import useSeo from '../lib/useSeo';
import useRequireAuth from '../lib/useRequireAuth';
import useCurrentUser, { initials } from '../lib/useCurrentUser';
import { supabase } from '../lib/supabase';
import { Card, Button, Input, Badge } from '../components/ui';
import { logActivity, listActivity } from '../lib/activity';
import { User, ShieldCheck, Monitor, KeyRound, ScrollText, Laptop, Plus, Lock } from 'lucide-react';

const TABS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'sessions', label: 'Sessions', icon: Monitor },
  { id: 'api', label: 'API keys', icon: KeyRound },
  { id: 'logs', label: 'Security logs', icon: ScrollText },
];

export default function Settings() {
  useSeo({ title: 'Account settings — KingxTech', noindex: true });
  useRequireAuth();
  const [tab, setTab] = useState('profile');

  return (
    <DashboardShell>
      <h1 className="font-display text-2xl font-semibold mb-8">Account settings</h1>

      <div className="grid md:grid-cols-[220px_1fr] gap-8">
        <nav className="flex md:flex-col gap-1 overflow-x-auto rounded-[20px] border border-white/8 bg-white/[0.015] p-2 h-fit">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl text-[13.5px] whitespace-nowrap text-left transition-colors ${
                tab === id ? 'bg-white/8 text-white' : 'text-kxmist hover:text-white hover:bg-white/[0.03]'
              }`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </nav>

        <div className="animate-fade-up">
          {tab === 'profile' && <ProfileTab />}
          {tab === 'security' && <SecurityTab />}
          {tab === 'sessions' && <SessionsTab />}
          {tab === 'api' && <ApiKeysTab />}
          {tab === 'logs' && <LogsTab />}
        </div>
      </div>
    </DashboardShell>
  );
}

function Section({ title, desc, children, unavailable }) {
  return (
    <Card className="p-6 mb-5 rounded-[20px] relative">
      <div className="flex items-center gap-2.5 mb-1">
        <h2 className="font-display text-[16px] font-medium">{title}</h2>
        {unavailable && <Badge>Not available yet</Badge>}
      </div>
      {desc && <p className="text-[13px] text-kxmist mb-5">{desc}</p>}
      {children}
    </Card>
  );
}

function Notice({ error, notice }) {
  if (!error && !notice) return null;
  return (
    <p className={`text-[12.5px] rounded-lg px-3 py-2 mb-4 border ${
      error ? 'text-red-400 bg-red-400/10 border-red-400/20' : 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20'
    }`}>
      {error || notice}
    </p>
  );
}

/* ---------------- Profile ---------------- */

function ProfileTab() {
  const { user, loading } = useCurrentUser();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (user) {
      setForm({
        fullName: user.user_metadata?.full_name || '',
        username: user.user_metadata?.username || '',
        email: user.email || '',
        role: user.user_metadata?.developer_role || '',
        experience: user.user_metadata?.experience_level || '',
        company: user.user_metadata?.company_name || '',
        github: user.user_metadata?.github_url || '',
        avatarUrl: user.user_metadata?.avatar_url || '',
      });
    }
  }, [user]);

  if (loading || !form) {
    return <Card className="p-6 rounded-[20px] text-sm text-kxmist">Loading profile…</Card>;
  }

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const saveBasicInfo = async () => {
    setError(''); setNotice(''); setSaving(true);
    const updates = { data: { full_name: form.fullName, username: form.username } };
    if (form.email !== user.email) updates.email = form.email;

    const { error: updateError } = await supabase.auth.updateUser(updates);
    setSaving(false);
    if (updateError) { setError(updateError.message); return; }
    setNotice(
      form.email !== user.email
        ? 'Saved. Check your new email address to confirm the change.'
        : 'Profile updated.'
    );
  };

  const saveDeveloperProfile = async () => {
    setError(''); setNotice(''); setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({
      data: {
        developer_role: form.role,
        experience_level: form.experience,
        company_name: form.company || null,
        github_url: form.github || null,
      },
    });
    setSaving(false);
    if (updateError) { setError(updateError.message); return; }
    setNotice('Developer profile updated.');
  };

  const uploadAvatar = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(''); setNotice(''); setAvatarUploading(true);

    const path = `${user.id}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });

    if (uploadError) {
      setAvatarUploading(false);
      setError(
        uploadError.message?.includes('not found')
          ? "No 'avatars' storage bucket exists yet in Supabase — create a public bucket named avatars (Storage → New bucket) to enable uploads."
          : uploadError.message
      );
      return;
    }

    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
    const { error: updateError } = await supabase.auth.updateUser({ data: { avatar_url: pub.publicUrl } });
    setAvatarUploading(false);
    if (updateError) { setError(updateError.message); return; }
    set('avatarUrl', pub.publicUrl);
    setNotice('Profile picture updated.');
  };

  return (
    <>
      <Section title="Profile picture">
        <Notice error={error} notice={notice} />
        <div className="flex items-center gap-4">
          {form.avatarUrl ? (
            <img src={form.avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover" />
          ) : (
            <span className="w-16 h-16 rounded-full bg-kx-gradient flex items-center justify-center text-lg font-semibold">
              {initials(user)}
            </span>
          )}
          <label className={`inline-flex items-center justify-center gap-2 rounded-full font-semibold text-sm px-5 py-2.5 border border-white/15 text-white cursor-pointer hover:border-white/35 hover:bg-white/5 transition-colors ${avatarUploading ? 'opacity-60 pointer-events-none' : ''}`}>
            <input type="file" accept="image/*" className="hidden" onChange={uploadAvatar} disabled={avatarUploading} />
            {avatarUploading && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />}
            {avatarUploading ? 'Uploading…' : 'Upload new'}
          </label>
        </div>
      </Section>

      <Section title="Basic info">
        <div className="grid sm:grid-cols-2 gap-4">
          <Input label="Full name" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} />
          <Input
            label="Username" value={form.username}
            onChange={(e) => set('username', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
          />
          <Input
            label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)}
            containerClassName="sm:col-span-2" hint="Changing this sends a confirmation link to the new address."
          />
        </div>
        <Button variant="primary" className="mt-5" onClick={saveBasicInfo} loading={saving}>Save changes</Button>
      </Section>

      <Section title="Developer profile" desc="Shown to teams you collaborate with.">
        <div className="grid sm:grid-cols-2 gap-4">
          <Input label="Role" value={form.role} onChange={(e) => set('role', e.target.value)} />
          <Input label="Experience level" value={form.experience} onChange={(e) => set('experience', e.target.value)} />
          <Input label="Company" placeholder="Optional" value={form.company} onChange={(e) => set('company', e.target.value)} />
          <Input label="GitHub" placeholder="https://github.com/yourname" value={form.github} onChange={(e) => set('github', e.target.value)} />
        </div>
        <Button variant="primary" className="mt-5" onClick={saveDeveloperProfile} loading={saving}>Save changes</Button>
      </Section>
    </>
  );
}

/* ---------------- Security ---------------- */

function SecurityTab() {
  return (
    <>
      <PasswordSection />
      <MfaSection />
      <Section title="Passkeys & WebAuthn" desc="Sign in without a password using a passkey or security key." unavailable>
        <Button variant="subtle" disabled className="opacity-50 cursor-not-allowed">
          <Plus size={14} /> Add a passkey
        </Button>
        <p className="text-[12px] text-kxmist mt-3">Passkey support isn't available yet — Supabase's client SDK doesn't currently expose WebAuthn enrollment.</p>
      </Section>
    </>
  );
}

function PasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const { user } = useCurrentUser();

  const submit = async () => {
    setError(''); setNotice('');
    if (next !== confirm) { setError("New passwords don't match."); return; }
    setSaving(true);

    // Re-verify the current password before changing it.
    const { error: reauthError } = await supabase.auth.signInWithPassword({ email: user.email, password: current });
    if (reauthError) {
      setSaving(false);
      setError('Current password is incorrect.');
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: next });
    setSaving(false);
    if (updateError) { setError(updateError.message); return; }
    setNotice('Password updated.');
    logActivity('Password changed');
    setCurrent(''); setNext(''); setConfirm('');
  };

  return (
    <Section title="Password">
      <Notice error={error} notice={notice} />
      <div className="grid sm:grid-cols-2 gap-4">
        <Input label="Current password" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <div />
        <Input label="New password" type="password" value={next} onChange={(e) => setNext(e.target.value)} />
        <Input label="Confirm new password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      <Button variant="primary" className="mt-5" onClick={submit} loading={saving} disabled={!current || !next}>
        Update password
      </Button>
    </Section>
  );
}

function MfaSection() {
  const [status, setStatus] = useState('checking'); // checking | disabled | enrolling | enabled
  const [factorId, setFactorId] = useState(null);
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [challengeId, setChallengeId] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) { setError(listError.message); setStatus('disabled'); return; }
    const totp = data.totp?.find((f) => f.status === 'verified');
    if (totp) { setFactorId(totp.id); setStatus('enabled'); }
    else setStatus('disabled');
  };

  useEffect(() => { refresh(); }, []);

  const startEnroll = async () => {
    setError(''); setNotice(''); setBusy(true);
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
    setBusy(false);
    if (enrollError) { setError(enrollError.message); return; }
    setFactorId(data.id);
    setQr(data.totp.qr_code);
    setSecret(data.totp.secret);
    setStatus('enrolling');
  };

  const confirmEnroll = async () => {
    setError(''); setBusy(true);
    let cid = challengeId;
    if (!cid) {
      const { data, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeError) { setBusy(false); setError(challengeError.message); return; }
      cid = data.id;
      setChallengeId(cid);
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: cid, code });
    setBusy(false);
    if (verifyError) { setError(verifyError.message); return; }
    setNotice('Two-factor authentication enabled.');
    logActivity('2FA enabled');
    setStatus('enabled');
    setCode('');
  };

  const disable = async () => {
    setError(''); setBusy(true);
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId });
    setBusy(false);
    if (unenrollError) { setError(unenrollError.message); return; }
    setStatus('disabled');
    setFactorId(null);
    setNotice('Two-factor authentication disabled.');
    logActivity('2FA disabled');
  };

  return (
    <Section title="Two-factor authentication" desc="Add a second step when signing in with a TOTP authenticator app.">
      <Notice error={error} notice={notice} />

      {status === 'checking' && <p className="text-sm text-kxmist">Checking status…</p>}

      {status === 'disabled' && (
        <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3.5">
          <div>
            <p className="text-sm font-medium">Authenticator app</p>
            <p className="text-[12.5px] text-kxmist">Disabled</p>
          </div>
          <Button variant="subtle" onClick={startEnroll} loading={busy}>Enable</Button>
        </div>
      )}

      {status === 'enrolling' && (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-kxmist">Scan this with your authenticator app, or enter the secret manually:</p>
          {qr && <img src={qr} alt="TOTP QR code" className="w-40 h-40 rounded-lg bg-white p-2" />}
          <p className="text-[12px] font-mono text-kxmist break-all">{secret}</p>
          <Input label="Enter the 6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          <Button variant="primary" onClick={confirmEnroll} loading={busy} disabled={code.length < 6} className="self-start">
            Confirm &amp; enable
          </Button>
        </div>
      )}

      {status === 'enabled' && (
        <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3.5">
          <div>
            <p className="text-sm font-medium">Authenticator app</p>
            <p className="text-[12.5px] text-emerald-300">Enabled</p>
          </div>
          <button onClick={disable} disabled={busy} className="text-[13px] text-red-400 hover:text-red-300 disabled:opacity-50">
            Disable
          </button>
        </div>
      )}
    </Section>
  );
}

/* ---------------- Sessions ---------------- */

function detectDevice() {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Unknown browser';
  return `${os} · ${browser}`;
}

function SessionsTab() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const signOutOthers = async () => {
    setError(''); setNotice(''); setBusy(true);
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'others' });
    setBusy(false);
    if (signOutError) { setError(signOutError.message); return; }
    setNotice('Signed out of all other sessions.');
  };

  return (
    <Section title="Active sessions" desc="Supabase's client SDK can end sessions, but can't list other devices individually — that needs a backend to track logins.">
      <Notice error={error} notice={notice} />
      <div className="flex flex-col gap-2.5 mb-5">
        <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3.5">
          <div className="flex items-center gap-3">
            <Laptop size={18} className="text-kxmist" />
            <div>
              <p className="text-sm font-medium flex items-center gap-2">{detectDevice()} <Badge tone="live">This device</Badge></p>
              <p className="text-[12.5px] text-kxmist">Detected from your browser — location isn't tracked</p>
            </div>
          </div>
        </div>
      </div>
      <Button variant="subtle" onClick={signOutOthers} loading={busy}>Sign out of all other sessions</Button>
    </Section>
  );
}

/* ---------------- API keys (now live in Console → AI Lab) ---------------- */

function ApiKeysTab() {
  return (
    <Section title="API keys" desc="Generate and manage API keys.">
      <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-4 py-4">
        <p className="text-[13px] text-kxmist">API keys now live in Console → AI Lab, alongside model routing.</p>
        <Link to="/console" className="text-[13px] text-kxblue hover:underline shrink-0">Open Console →</Link>
      </div>
    </Section>
  );
}

/* ---------------- Security logs (real, from activity_log) ---------------- */

const SECURITY_ACTIONS = ['Signed in', 'Password changed', '2FA enabled', '2FA disabled'];

function LogsTab() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    listActivity(200).then(({ data, error: listError }) => {
      if (listError) {
        setError(/relation .*activity_log.* does not exist/i.test(listError.message) ? 'SETUP' : listError.message);
        return;
      }
      setEntries(data.filter((e) => SECURITY_ACTIONS.includes(e.action)));
    });
  }, []);

  if (error === 'SETUP') {
    return (
      <Section title="Security activity" unavailable desc="A record of security-relevant events on your account.">
        <p className="text-[13px] text-kxmist">
          Run <code className="text-white font-mono">supabase/migrations/007_activity_log.sql</code> in your Supabase SQL Editor to start recording these for real.
        </p>
      </Section>
    );
  }

  return (
    <Section title="Security activity" desc="Real events from your account — sign-ins, password changes, and 2FA toggles. Nothing here is sample data.">
      {error && error !== 'SETUP' && <Notice error={error} />}
      {entries === null && !error && <p className="text-sm text-kxmist">Loading…</p>}
      {entries !== null && entries.length === 0 && (
        <p className="text-[13px] text-kxmist">Nothing recorded yet — this fills in as you sign in, change your password, or toggle 2FA.</p>
      )}
      {entries !== null && entries.length > 0 && (
        <div className="flex flex-col">
          {entries.map((e, i) => (
            <div key={e.id} className={`flex items-center justify-between py-3.5 ${i !== entries.length - 1 ? 'border-b border-white/8' : ''}`}>
              <div>
                <p className="text-sm font-medium">{e.action}</p>
                {e.detail && <p className="text-[12.5px] text-kxmist">{e.detail}</p>}
              </div>
              <span className="text-[12px] font-mono text-kxmistdim">{new Date(e.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
