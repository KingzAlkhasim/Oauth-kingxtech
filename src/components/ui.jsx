import { useState } from 'react';
import { Eye, EyeOff, Check } from 'lucide-react';

export function Button({ children, variant = 'primary', className = '', loading = false, ...props }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-full font-semibold text-sm px-5 py-2.5 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-white text-[#0a0a0c] hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-8px_rgba(0,163,255,.55)]',
    glow: 'bg-kx-gradient bg-[length:160%_160%] text-white hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-6px_rgba(139,92,246,.55)]',
    ghost: 'bg-transparent border border-white/15 text-white hover:border-white/35 hover:bg-white/5',
    subtle: 'bg-white/5 border border-white/10 text-white hover:bg-white/10',
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} disabled={loading || props.disabled} {...props}>
      {loading && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />}
      {children}
    </button>
  );
}

export function Input({ label, type = 'text', hint, error, className = '', containerClassName = '', ...props }) {
  const [show, setShow] = useState(false);
  const isPassword = type === 'password';
  return (
    <label className={`block ${containerClassName}`}>
      {label && <span className="block text-[13px] font-medium text-white/85 mb-1.5">{label}</span>}
      <div className={`flex items-center rounded-lg border bg-white/[0.02] transition-colors ${error ? 'border-red-400/60' : 'border-white/12 focus-within:border-kxblue focus-within:ring-2 focus-within:ring-kxblue/15'}`}>
        <input
          type={isPassword && show ? 'text' : type}
          className={`w-full bg-transparent px-3.5 py-2.5 text-sm outline-none placeholder:text-white/30 ${className}`}
          {...props}
        />
        {isPassword && (
          <button type="button" tabIndex={-1} onClick={() => setShow((s) => !s)} className="px-3 text-white/40 hover:text-white/70">
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      {hint && !error && <span className="block text-[12px] text-kxmist mt-1.5">{hint}</span>}
      {error && <span className="block text-[12px] text-red-400 mt-1.5">{error}</span>}
    </label>
  );
}

export function Card({ children, className = '' }) {
  return <div className={`glass rounded-2xl ${className}`}>{children}</div>;
}

export function Badge({ children, tone = 'default' }) {
  const tones = {
    default: 'border-white/15 text-kxmist',
    live: 'border-emerald-400/30 text-emerald-300 bg-emerald-400/10',
    beta: 'border-blue-300/30 text-blue-200 bg-blue-300/10',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full border ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Checkbox({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none text-sm text-kxmist">
      <span
        onClick={() => onChange(!checked)}
        className={`w-[18px] h-[18px] rounded-md border flex items-center justify-center transition-colors ${checked ? 'bg-kxblue border-kxblue' : 'border-white/25'}`}
      >
        {checked && <Check size={12} className="text-white" />}
      </span>
      {label}
    </label>
  );
}

export function Divider({ label }) {
  return (
    <div className="flex items-center gap-3 my-1">
      <span className="h-px flex-1 bg-white/10" />
      {label && <span className="text-[11px] font-mono uppercase tracking-wider text-white/30">{label}</span>}
      <span className="h-px flex-1 bg-white/10" />
    </div>
  );
}

export function SocialButtons({ onSelect }) {
  const providers = [
    { id: 'github', name: 'GitHub', icon: GithubIcon },
    { id: 'google', name: 'Google', icon: GoogleIcon },
    { id: 'discord', name: 'Discord', icon: DiscordIcon },
    { id: 'azure', name: 'Microsoft', icon: MicrosoftIcon },
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {providers.map(({ id, name, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onSelect?.(id)}
          className="flex items-center justify-center gap-2 rounded-lg border border-white/12 bg-white/[0.02] py-2.5 text-[13px] font-medium hover:border-white/30 hover:bg-white/5 transition-colors"
        >
          <Icon size={15} />
          {name}
        </button>
      ))}
    </div>
  );
}

function GithubIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2.1c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.4-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2A11 11 0 0112 5.8c1 0 2 .1 3 .4 2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.9 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A11.5 11.5 0 0023.5 12C23.5 5.7 18.3.5 12 .5z" /></svg>
  );
}
function GoogleIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"><path fill="#4285F4" d="M22.5 12.2c0-.7-.06-1.4-.18-2H12v3.8h5.9a5 5 0 01-2.2 3.3v2.7h3.6c2.1-1.9 3.2-4.7 3.2-7.8z" /><path fill="#34A853" d="M12 23c2.7 0 5-.9 6.6-2.4l-3.6-2.7c-1 .7-2.2 1.1-3 1.1-2.8 0-5.2-1.9-6-4.4H2.3v2.8A11 11 0 0012 23z" /><path fill="#FBBC05" d="M6 14.6a6.6 6.6 0 010-4.2V7.6H2.3a11 11 0 000 9.8L6 14.6z" /><path fill="#EA4335" d="M12 5.8c1.5 0 2.8.5 3.8 1.5l3.2-3.1C17 2.5 14.7 1.6 12 1.6A11 11 0 002.3 7.6L6 10.4C6.8 7.9 9.2 5.8 12 5.8z" /></svg>
  );
}
function DiscordIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A19.7 19.7 0 0015.6 3l-.3.5a14 14 0 014.1 1.6 15.6 15.6 0 00-13.8 0A14 14 0 019.7 3.5L9.4 3a19.7 19.7 0 00-4.7 1.4C1.9 8.6 1.1 12.6 1.4 16.6a19.8 19.8 0 005.9 2.9l.9-1.4a12.9 12.9 0 01-2-1c.2-.1.3-.2.5-.3a14.2 14.2 0 0012.6 0l.5.3a12.9 12.9 0 01-2 1l.9 1.4a19.7 19.7 0 005.9-2.9c.4-4.6-.7-8.6-3.3-12.2zM8.8 14.3c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.9.9 1.8 2c0 1.1-.8 2-1.8 2zm6.4 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.9.9 1.8 2c0 1.1-.8 2-1.8 2z" /></svg>
  );
}
function MicrosoftIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"><rect x="2" y="2" width="9" height="9" fill="#00A3FF" /><rect x="13" y="2" width="9" height="9" fill="#8B5CF6" /><rect x="2" y="13" width="9" height="9" fill="#D946C6" /><rect x="13" y="13" width="9" height="9" fill="#94A3B8" /></svg>
  );
}

export function OTPInput({ length = 6, onChange }) {
  const [values, setValues] = useState(Array(length).fill(''));

  const handleChange = (i, val) => {
    if (!/^[0-9]?$/.test(val)) return;
    const next = [...values];
    next[i] = val;
    setValues(next);
    onChange?.(next.join(''));
    if (val && i < length - 1) {
      document.getElementById(`otp-${i + 1}`)?.focus();
    }
  };

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !values[i] && i > 0) {
      document.getElementById(`otp-${i - 1}`)?.focus();
    }
  };

  return (
    <div className="flex gap-2.5 justify-center">
      {values.map((v, i) => (
        <input
          key={i}
          id={`otp-${i}`}
          value={v}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          inputMode="numeric"
          maxLength={1}
          className="w-11 h-[52px] text-center text-lg font-mono rounded-lg border border-white/12 bg-white/[0.02] outline-none focus:border-kxblue focus:ring-2 focus:ring-kxblue/15"
        />
      ))}
    </div>
  );
}

export function Skeleton({ className = '' }) {
  return <div className={`rounded-md bg-white/5 relative overflow-hidden ${className}`}>
    <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/10 to-transparent" />
  </div>;
}
