// Pure, dependency-free abuse pattern rules. They only decide what is worth a closer look:
// a match is a flag for review, never a block and never proof of abuse.

export type AbuseCategory = 'malware' | 'phishing' | 'fraud' | 'hacking' | 'weapons' | 'child_safety' | 'crypto_scam';
export type AbuseSeverity = 'low' | 'medium' | 'high';

export interface AbuseMatch {
  category: AbuseCategory;
  severity: AbuseSeverity;
  rule: string;
  excerpt: string | null;
}

interface PromptRule {
  category: AbuseCategory;
  rule: string;
  pattern: RegExp;
  severity: AbuseSeverity; // severity when the text asks to BUILD / DO the thing
  noExcerpt?: boolean;
}

// Asking to build or do something, as opposed to asking what it is.
const BUILD_INTENT = /\b(write|build|create|make|generate|code|develop|implement|give me|set up|design|clone|copy|replicate|script|help me)\b/i;

const PROMPT_RULES: PromptRule[] = [
  { category: 'malware', rule: 'malware-tool', severity: 'high',
    pattern: /\b(ransomware|key ?logger|keystroke logger|info ?stealer|credential stealer|password stealer|cookie stealer|remote access trojan|botnet|rootkit|cryptojack\w*|reverse shell|ddos (?:tool|script|attack|bot)|spyware|stalkerware)\b/i },
  { category: 'phishing', rule: 'fake-login-clone', severity: 'high',
    pattern: /\b(?:clone|copy|replica|replicate|fake|lookalike|look-alike|spoof|imitat\w+)\b[^.\n]{0,40}\b(?:log ?in|sign ?in|bank|paypal|payment|checkout|verification)\b[^.\n]{0,20}\b(?:page|site|website|portal|form|screen)\b/i },
  { category: 'phishing', rule: 'capture-credentials', severity: 'high',
    pattern: /\b(?:capture|steal|harvest|collect|grab|log|save)\b[^.\n]{0,25}\b(?:passwords?|credentials|card (?:number|details)|cvv|otp|pin code|login details)\b[^.\n]{0,40}\b(?:send|forward|post|to my|telegram|without)\b/i },
  { category: 'fraud', rule: 'fake-document-generator', severity: 'high',
    pattern: /\bfake\b[^.\n]{0,20}\b(?:receipt|invoice|bank (?:alert|statement|transfer)|credit alert|debit alert|transfer receipt|payment confirmation|certificate|transcript|id card|passport|reviews?|testimonials?)\b/i },
  { category: 'fraud', rule: 'carding', severity: 'high',
    pattern: /\b(?:carding|credit card (?:generator|checker)|card checker|bank logs|cc dumps?|bin attack)\b/i },
  { category: 'hacking', rule: 'hack-someone', severity: 'high',
    pattern: /\b(?:hack(?:ing)?|break|get) into\b[^.\n]{0,30}\b(?:account|phone|whatsapp|facebook|instagram|email|wifi|network|server)\b/i },
  { category: 'hacking', rule: 'bypass-auth', severity: 'medium',
    pattern: /\b(?:bypass|crack|brute ?force)\b[^.\n]{0,25}\b(?:2fa|otp|login|password|authentication|paywall|license)\b/i },
  { category: 'weapons', rule: 'weapon-making', severity: 'high',
    pattern: /\b(?:make|build|synthesi[sz]e|assemble|manufacture|produce)\b[^.\n]{0,25}\b(?:bomb|explosives?|nerve agent|sarin|ricin|pipe ?bomb|firearm|3d[- ]printed gun|chemical weapon)\b/i },
  { category: 'child_safety', rule: 'minor-sexual-content', severity: 'high', noExcerpt: true,
    pattern: /\b(?:child|children|minor|underage|teen|\d{1,2}[- ]year[- ]old)\b[^.\n]{0,60}\b(?:sexual|nude|naked|porn\w*|explicit)\b|\b(?:sexual|nude|naked|porn\w*|explicit)\b[^.\n]{0,60}\b(?:child|children|minor|underage|\d{1,2}[- ]year[- ]old)\b/i },
  { category: 'crypto_scam', rule: 'wallet-drainer', severity: 'high',
    pattern: /\b(?:wallet drainer|drain (?:the )?(?:victim|user)'?s? wallet|fake airdrop|rug ?pull)\b/i },
];

function excerptAround(text: string, index: number): string {
  const start = Math.max(0, index - 80);
  return text.slice(start, start + 240).replace(/\s+/g, ' ').trim();
}

export function scanPrompt(text: string): AbuseMatch[] {
  const input = text.slice(0, 20_000);
  const asksToBuild = BUILD_INTENT.test(input);
  const found: AbuseMatch[] = [];
  const seen = new Set<string>();
  for (const rule of PROMPT_RULES) {
    const m = rule.pattern.exec(input);
    if (!m || seen.has(rule.rule)) continue;
    seen.add(rule.rule);
    // Merely mentioning or explaining a topic is low severity; asking to build it keeps the rule's level.
    const severity: AbuseSeverity = rule.category === 'child_safety' || asksToBuild ? rule.severity : 'low';
    found.push({
      category: rule.category,
      severity,
      rule: rule.rule,
      excerpt: rule.noExcerpt ? null : excerptAround(input, m.index),
    });
  }
  return found;
}

// --- Published site scanning -------------------------------------------------

const BRANDS = /\b(paypal|gtbank|gtco|zenith bank|access bank|first bank|uba|opay|palmpay|moniepoint|kuda|flutterwave|paystack|binance|coinbase|metamask|facebook|instagram|whatsapp|google|microsoft|apple id|netflix|dhl|fedex|amazon)\b/i;
const EXFIL_ENDPOINT = /(api\.telegram\.org\/bot|discord(?:app)?\.com\/api\/webhooks|formsubmit\.co|formspree\.io|webhook\.site|requestbin|pipedream\.net)/i;

export function scanSiteFiles(files: { path: string; content: string | null }[]): AbuseMatch[] {
  const textFiles = files.filter((f) => f.content && /\.(html?|jsx?|tsx?|vue|svelte)$/i.test(f.path) && !f.content.startsWith('__KX_BINARY'));
  let budget = 400_000;
  const text = textFiles.map((f) => { const c = (f.content || '').slice(0, Math.max(0, budget)); budget -= c.length; return c; }).join('\n');
  if (!text) return [];

  const hasPassword = /type\s*=\s*["']password["']|type:\s*["']password["']/i.test(text);
  const hasCard = /(card[\s_-]?number|cvv|cvc|cc[-_]?num)/i.test(text);
  const hasOtp = /\b(otp|one[- ]time (?:pin|password)|atm pin)\b/i.test(text);
  const exfil = EXFIL_ENDPOINT.exec(text);
  const brand = BRANDS.exec(text);
  const found: AbuseMatch[] = [];
  const ex = (hit: RegExpExecArray | null) => (hit ? excerptAround(text, hit.index) : null);

  if (exfil && (hasPassword || hasCard || hasOtp)) {
    found.push({ category: 'phishing', severity: 'high', rule: 'site-sends-secrets-to-webhook', excerpt: ex(exfil) });
  }
  if (hasPassword && brand && /\b(verify|confirm|secure|unlock|restore)\b[^.\n]{0,40}\b(account|identity|wallet|login)\b/i.test(text)) {
    found.push({ category: 'phishing', severity: 'medium', rule: 'site-brand-login-lure', excerpt: ex(brand) });
  }
  if (hasCard && hasOtp) {
    found.push({ category: 'fraud', severity: 'medium', rule: 'site-collects-card-and-otp', excerpt: ex(/(cvv|cvc|card[\s_-]?number)/i.exec(text)) });
  }
  const drainer = /(setApprovalForAll|approve\s*all|claim\s+(?:your\s+)?airdrop|connect\s+wallet[^.\n]{0,80}(?:claim|airdrop|validate))/i.exec(text);
  if (drainer && /(connect\s*wallet|ethereum\.request|window\.ethereum)/i.test(text)) {
    found.push({ category: 'crypto_scam', severity: 'high', rule: 'site-wallet-drainer-pattern', excerpt: ex(drainer) });
  }
  const miner = /(coinhive|cryptonight|stratum\+tcp|coin-?imp|webminer)/i.exec(text);
  if (miner) found.push({ category: 'malware', severity: 'high', rule: 'site-crypto-miner', excerpt: ex(miner) });

  return found;
}
