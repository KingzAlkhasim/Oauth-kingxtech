// Rules for project servers (the sleep-when-idle Node API runtime). Pure functions, no env or database.
export const SERVER_PORT = 3000;
export const REQUEST_BODY_MAX = 1024 * 1024;        // 1 MB in
export const RESPONSE_BODY_MAX = 5 * 1024 * 1024;   // 5 MB out
export const IDLE_WINDOW_MS = 10 * 60 * 1000;       // the server sleeps after about 10 idle minutes
export const PROXY_TIMEOUT_MS = 25_000;
export const START_TIMEOUT_MS = 90_000;
export const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

/** Only these request headers reach the project's server. Cookies are never forwarded: all sites share one host. */
const FORWARD_REQUEST_HEADERS = ['content-type', 'accept', 'accept-language', 'user-agent', 'authorization', 'if-none-match', 'x-requested-with'];

export function buildForwardHeaders(incoming: Record<string, string | string[] | undefined>, visitorIp: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of FORWARD_REQUEST_HEADERS) {
    const v = incoming[name];
    const value = Array.isArray(v) ? v[0] : v;
    if (typeof value === 'string' && value && value.length <= 4096) out[name] = value;
  }
  out['x-forwarded-for'] = visitorIp.slice(0, 80);
  out['x-kingxtech'] = '1';
  return out;
}

/** Turns the part of the URL after /api/public/server/<id> into a safe path for the project's server. */
export function cleanServerPath(raw: unknown): string | null {
  const text = typeof raw === 'string' ? raw : '';
  const noQuery = text.split('?')[0];
  let decoded: string;
  try { decoded = decodeURIComponent(noQuery); } catch { return null; }
  if (decoded.length > 1000 || /[\u0000-\u001f\\]/.test(decoded)) return null;
  const segments = decoded.split('/').filter((s) => s !== '');
  if (segments.some((s) => s === '..' || s === '.')) return null;
  return '/' + segments.map(encodeURIComponent).join('/');
}

/** Query string passes through untouched except for control characters, capped in length. */
export function cleanQueryString(rawUrl: string): string {
  const i = rawUrl.indexOf('?');
  if (i < 0) return '';
  const q = rawUrl.slice(i);
  return /[\u0000-\u001f\s]/.test(q) || q.length > 2000 ? '' : q;
}

const DROP_RESPONSE_HEADERS = new Set([
  'set-cookie', 'set-cookie2', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailer', 'content-length', 'content-encoding', 'content-security-policy',
  'strict-transport-security', 'access-control-allow-origin', 'access-control-allow-credentials', 'x-frame-options', 'location',
]);

/**
 * Headers sent back to the visitor. Cookies and redirects are dropped, and every response is
 * sandboxed so an HTML reply can never run script with access to the shared KingxTech origin.
 */
export function cleanResponseHeaders(headers: Iterable<[string, string]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of headers) {
    const key = name.toLowerCase();
    if (DROP_RESPONSE_HEADERS.has(key) || key.startsWith('x-vercel') || key.startsWith('x-forwarded')) continue;
    out[key] = value;
  }
  out['content-security-policy'] = "sandbox; default-src 'none'";
  out['x-content-type-options'] = 'nosniff';
  out['cache-control'] = out['cache-control'] || 'no-store';
  return out;
}

/** True when the owner's start script can be used. Needs a "start" script in package.json. */
export function startCommandProblem(packageJsonText: string | null): string | null {
  if (!packageJsonText) return 'Your project needs a package.json with a "start" script that starts your server.';
  let pkg: any;
  try { pkg = JSON.parse(packageJsonText); } catch { return 'package.json is not valid JSON.'; }
  if (typeof pkg?.scripts?.start !== 'string' || !pkg.scripts.start.trim()) return 'Add a "start" script to package.json, for example "start": "node server.js".';
  return null;
}

export const SERVER_PLANS_ALLOWED = ['pro', 'pro_plus'] as const;
export function planAllowsServer(tier: string | null | undefined): boolean {
  return (SERVER_PLANS_ALLOWED as readonly string[]).includes(String(tier));
}
