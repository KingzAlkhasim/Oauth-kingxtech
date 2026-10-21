import { Link } from 'react-router-dom';
import Logo from '../components/Logo';
import useSeo from '../lib/useSeo';
import { TERMS_VERSION } from '../lib/terms';

const SECTIONS = [
  ['1. Agreement', [
    'These Terms govern your use of KingxTech, including K-XpertAI, SynthCode IDE, KX Cloud Console, project hosting and related services. By creating an account or using the service you agree to them.',
  ]],
  ['2. Your account', [
    'You are responsible for your account, your password and everything done through it, including API keys you create. Give accurate information and keep it up to date. You must be old enough to form a binding contract where you live.',
  ]],
  ['3. Acceptable use', [
    'You may use KingxTech to build and host lawful software. You must not use it, or the AI tools in it, to build, run, host or promote any of the following:',
    '• Malware, ransomware, spyware, credential stealers, botnets, or tools made to attack or break into systems you do not own or have permission to test.',
    '• Phishing pages, fake login or payment pages, impersonation of a person or organisation, scams, fraud or fake reviews.',
    '• Anything that sexually exploits or endangers children.',
    '• Content that threatens, harasses or incites violence against people, or that helps make weapons.',
    '• Spam, unlawful surveillance, illegal gambling or any other activity that is against the law that applies to you or to us.',
    '• Content that infringes someone else\'s copyright, trademark or privacy.',
    '• Attempts to get around usage limits, billing, security controls or these rules, or to resell access without our written permission.',
  ]],
  ['4. AI features and review', [
    'AI output can be wrong. You are responsible for checking it before you use it, and for how you use it.',
    'To keep the service safe, we record how AI features are used and may review usage, flagged requests and published projects, by automated tools and by people, to find breaches of these Terms. We only look at content where that is needed to investigate misuse, respond to a report, keep the service secure or meet a legal duty.',
  ]],
  ['5. Enforcement', [
    'If we believe these Terms are being broken, we may remove content, take a published site offline, limit features, or suspend or end your account. When an account is suspended you can still sign in to see the reason, contact support and download your project information. Serious breaches, or anything we are legally required to act on, may be reported to the relevant authorities.',
    'If you think we made a mistake, contact support and we will look at it.',
  ]],
  ['6. Your content', [
    'You keep ownership of the code and content you create. You give us the permission needed to store, process and host it so the service works, and to apply these Terms. Do not upload secrets or personal data of other people unless you have the right to.',
  ]],
  ['7. Plans and payments', [
    'Paid plans and prepaid balances are charged through our payment providers at the prices shown when you pay. Plans run for the period shown and do not renew unless stated. Fees already paid are not refundable except where the law requires it or we say otherwise in writing.',
  ]],
  ['8. Availability and liability', [
    'We work to keep KingxTech running but do not promise it will be uninterrupted or error free. To the extent the law allows, KingxTech is provided as is, and we are not liable for indirect or consequential loss, or for loss caused by content you or other users create or publish.',
  ]],
  ['9. Changes', [
    'We may update these Terms. If a change is material we will tell you in the app or by email. Using the service after a change means you accept it.',
  ]],
  ['10. Contact', [
    'Questions, reports of misuse or appeals: hello@kingxtech.name.ng. KingxTech is based in Kaduna, Nigeria, and these Terms are governed by the laws of the Federal Republic of Nigeria.',
  ]],
];

export default function Terms() {
  useSeo({ title: 'Terms of Service — KingxTech' });
  return (
    <div className="min-h-screen px-4 py-10">
      <div className="mx-auto w-full max-w-2xl flex flex-col gap-6">
        <Link to="/" aria-label="KingxTech home"><Logo /></Link>
        <div>
          <h1 className="font-display text-3xl">Terms of Service</h1>
          <p className="text-[12.5px] text-kxmist mt-1">Version {TERMS_VERSION}</p>
        </div>
        {SECTIONS.map(([title, paragraphs]) => (
          <section key={title} className="flex flex-col gap-2">
            <h2 className="font-display text-lg">{title}</h2>
            {paragraphs.map((p) => <p key={p.slice(0, 40)} className="text-[14px] text-kxmist leading-relaxed break-words">{p}</p>)}
          </section>
        ))}
      </div>
    </div>
  );
}
