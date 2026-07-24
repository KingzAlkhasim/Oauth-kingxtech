import { Link } from 'react-router-dom';
import Logo from './Logo';

export default function AuthLayout({ children, side }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-kxbg text-white">
      <div className="relative flex flex-col justify-between px-8 py-8 lg:px-14 lg:py-12 overflow-hidden">
        <div className="absolute inset-0 kx-bg-grid pointer-events-none" />
        <div className="absolute w-[420px] h-[420px] rounded-full bg-kxpurple/25 blur-[110px] -top-32 -left-20 pointer-events-none" />

        <Link to="/" className="relative z-10"><Logo /></Link>

        <div className="relative z-10 w-full max-w-sm mx-auto py-10">
          {children}
        </div>

        <p className="relative z-10 text-[12px] font-mono text-white/25">© {new Date().getFullYear()} KingxTech, Inc.</p>
      </div>

      <div className="hidden lg:flex relative overflow-hidden border-l border-white/8 bg-kxsurface items-center justify-center p-14">
        <div className="absolute inset-0 kx-bg-grid opacity-60 pointer-events-none" />
        <div className="absolute w-[460px] h-[460px] rounded-full bg-kxblue/20 blur-[120px] top-10 right-0 pointer-events-none" />
        <div className="relative z-10 max-w-md">
          {side}
        </div>
      </div>
    </div>
  );
}

export function SidePanelDefault() {
  return (
    <div className="animate-fade-up">
      <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-kxmist mb-6">
        <span className="w-1.5 h-1.5 rounded-full bg-kx-gradient" /> Single sign-on
      </span>
      <h2 className="font-display text-3xl font-semibold leading-tight mb-4">
        One account for the whole <span className="text-gradient">KingxTech</span> ecosystem.
      </h2>
      <p className="text-kxmist text-[15px] leading-relaxed mb-8">
        Sign in once to access K-XpertAI, SynthCode IDE, and KX Cloud — no separate accounts, no repeated logins.
      </p>
      <div className="flex flex-col gap-3">
        {['K-XpertAI', 'SynthCode IDE', 'KX Cloud'].map((p) => (
          <div key={p} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
            <span className="w-2 h-2 rounded-full bg-kx-gradient" />
            <span className="text-sm">{p}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
