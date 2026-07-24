import { Link } from 'react-router-dom';
import Logo from '../components/Logo';
import { Button, Badge } from '../components/ui';
import { ShieldCheck, KeyRound, Fingerprint } from 'lucide-react';
import useSeo from '../lib/useSeo';

export default function Landing() {
  useSeo({ title: 'KingxTech — Sign in to the ecosystem', noindex: false });
  return (
    <div className="min-h-screen bg-kxbg text-white relative overflow-hidden">
      <div className="absolute inset-0 kx-bg-grid pointer-events-none" />
      <div className="absolute w-[500px] h-[500px] rounded-full bg-kxpurple/25 blur-[120px] -top-40 left-1/4 pointer-events-none" />
      <div className="absolute w-[400px] h-[400px] rounded-full bg-kxblue/20 blur-[110px] top-20 right-0 pointer-events-none" />

      <header className="relative z-10 max-w-6xl mx-auto flex items-center justify-between px-6 py-6">
        <Logo />
        <div className="flex items-center gap-3">
          <Link to="/login"><Button variant="ghost">Sign in</Button></Link>
          <Link to="/signup"><Button variant="glow">Create account</Button></Link>
        </div>
      </header>

      <main className="relative z-10 max-w-3xl mx-auto text-center px-6 pt-24 pb-20">
        <Badge>Identity &amp; access for the KingxTech ecosystem</Badge>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold mt-6 leading-tight">
          One identity. <span className="text-gradient">Every KingxTech product.</span>
        </h1>
        <p className="text-kxmist text-lg mt-5 max-w-xl mx-auto leading-relaxed">
          Sign in once to reach K-XpertAI, SynthCode IDE, and KX Cloud — secured with the same account, everywhere.
        </p>
        <div className="flex items-center justify-center gap-3 mt-8">
          <Link to="/signup"><Button variant="glow">Create your account</Button></Link>
          <Link to="/login"><Button variant="ghost">Sign in</Button></Link>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 mt-20 text-left">
          {[
            { icon: ShieldCheck, title: 'SSO across products', desc: 'Authenticate once, move between K-XpertAI, SynthCode, and KX Cloud without logging in again.' },
            { icon: KeyRound, title: 'Modern security', desc: 'OAuth2, OpenID Connect, and two-factor authentication protect every account by default.' },
            { icon: Fingerprint, title: 'Passkeys ready', desc: 'Sign in with a passkey or security key — passwords are optional, not required.' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="glass rounded-2xl p-6">
              <Icon size={20} className="text-kxblue mb-3" />
              <h3 className="font-display text-[15px] font-medium mb-1.5">{title}</h3>
              <p className="text-[13px] text-kxmist leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="relative z-10 text-center pb-10 text-[12px] font-mono text-white/25">
        auth.kingxtech.name.ng — part of the KingxTech ecosystem
      </footer>
    </div>
  );
}
