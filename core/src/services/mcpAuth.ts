// Tokens for the AI-app connector (Claude, ChatGPT). Supabase's OAuth server issues them: a normal Supabase JWT
// with one extra claim, `client_id`, naming the app the user approved. That claim is how we tell them apart.

/** Reads a JWT's payload. Does NOT verify it: only call this on a token Supabase has already accepted. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const value = JSON.parse(json);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The OAuth client a token was issued to, or null for an ordinary signed-in session token. */
export function oauthClientId(token: string): string | null {
  const id = decodeJwtPayload(token)?.client_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export interface McpPrincipal { userId: string; email?: string; clientId: string }

/**
 * Accepts a token only when Supabase says it is live AND it was issued to an OAuth app.
 * An ordinary session token is refused here, so revoking an app in "Connected AI apps" is what ends its access.
 */
export async function verifyMcpToken(
  token: string,
  supabaseUrl: string,
  anonKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<McpPrincipal | null> {
  const clientId = oauthClientId(token);
  if (!clientId) return null;
  const resp = await fetchImpl(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
  if (!resp.ok) return null;
  const user = (await resp.json()) as { id?: string; email?: string };
  if (!user.id) return null;
  return { userId: user.id, email: user.email, clientId };
}

/** Files an AI app may not read or write: secrets and the platform's own build output. */
export function isBlockedMcpPath(path: string): boolean {
  const p = path.trim().replace(/^\.\//, '');
  if (/^(\.kingxtech-dist|\.kx-verify-dist|\.git)(\/|$)/.test(p)) return true;
  const name = p.split('/').pop() ?? '';
  if (/^\.env(\..+)?$/i.test(name) && !/^\.env\.(example|sample|template)$/i.test(name)) return true;
  return false;
}
