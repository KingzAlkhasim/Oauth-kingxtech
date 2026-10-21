// Pure helpers for the AI web search tool: limits, secret screening and result cleaning.

export interface CleanResult { title: string; url: string; snippet: string }

// Searches per user per rolling 24 hours, by plan. Keeps the shared free quota fair.
export function dailySearchLimit(tier: string): number {
  if (tier === 'pro_plus') return 100;
  if (tier === 'pro') return 30;
  return 5;
}

// Never send something that looks like a credential to a third-party search service.
const SECRET_LIKE = /(sk-[a-z0-9_-]{16,}|sk_(?:live|test)_[a-z0-9]{10,}|kx_(?:live|test)_[a-z0-9]{8,}|eyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}|AKIA[0-9A-Z]{12,}|ghp_[a-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AIza[0-9A-Za-z_-]{20,})/i;

export function looksLikeSecret(query: string): boolean {
  return SECRET_LIKE.test(query);
}

export function normalizeQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const query = raw.replace(/\s+/g, ' ').trim();
  if (query.length < 2) return null;
  return query.slice(0, 200);
}

// Search results are untrusted text. Keep only https links and short snippets.
export function cleanResults(raw: unknown, max = 5): CleanResult[] {
  if (!Array.isArray(raw)) return [];
  const out: CleanResult[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { title, url, content } = item as { title?: unknown; url?: unknown; content?: unknown };
    if (typeof url !== 'string' || !url.startsWith('https://')) continue;
    out.push({
      title: typeof title === 'string' ? title.replace(/\s+/g, ' ').trim().slice(0, 140) : url,
      url: url.slice(0, 300),
      snippet: typeof content === 'string' ? content.replace(/\s+/g, ' ').trim().slice(0, 600) : '',
    });
    if (out.length >= max) break;
  }
  return out;
}
