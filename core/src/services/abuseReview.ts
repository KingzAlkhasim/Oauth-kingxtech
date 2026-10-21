const VERDICTS = new Set(['likely_abuse', 'likely_fine', 'unclear']);

// Model output is untrusted: accept only the expected shape and keep the reason short.
export function parseReviewVerdict(text: string): { verdict: string | null; reason: string | null } {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) return { verdict: null, reason: null };
  try {
    const parsed = JSON.parse(jsonText) as { verdict?: unknown; reason?: unknown };
    if (typeof parsed.verdict !== 'string' || !VERDICTS.has(parsed.verdict)) return { verdict: null, reason: null };
    const reason = typeof parsed.reason === 'string' ? parsed.reason.replace(/\s+/g, ' ').trim().slice(0, 200) : null;
    return { verdict: parsed.verdict, reason: reason || null };
  } catch {
    return { verdict: null, reason: null };
  }
}
