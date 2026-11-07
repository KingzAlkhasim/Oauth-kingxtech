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

/** The in-sandbox user that runs ALL project code (install and start). Never the default privileged user. */
export const APP_USER = 'kxapp';
export const APP_HOME = '/home/kxapp';
export const APP_DIR = '/home/kxapp/app';
export const APP_PORT = 3001; // loopback only; the gate on SERVER_PORT is the only thing reachable from outside
/** The sandbox image keeps node/npm here, not in /usr/bin. Without it on PATH, `npm` is "No such file or directory". */
export const NODE_RUNTIME = 'node24';
export const NODE_BIN_DIR = `/vercel/runtimes/${NODE_RUNTIME}/bin`;
export const APP_PATH = `${NODE_BIN_DIR}:/usr/local/bin:/usr/bin:/bin`;

const RESERVED_ENV = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'PWD', 'PORT', 'HOST', 'NODE_ENV', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'SUDO_USER', 'SUDO_UID', 'SUDO_GID', 'SUDO_COMMAND']);

/** Only the project's own variables reach its code, with safe names, and nothing the platform controls can be overridden. */
export function sanitizeAppEnv(vars: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars || {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(k)) continue;
    if (RESERVED_ENV.has(k.toUpperCase()) || /^(VERCEL|SUDO|KX_|PROJECT_SERVER)/i.test(k)) continue;
    if (typeof v !== 'string' || v.length > 8192 || v.includes('\0')) continue;
    out[k] = v;
  }
  return out;
}

/** `env -i ... setpriv ... <cmd>`: a clean environment and a permanently unprivileged process. */
export function restrictedCommand(userEnv: Record<string, string>, cmd: string[]): string[] {
  const pairs = Object.entries({ ...sanitizeAppEnv(userEnv), PATH: APP_PATH, HOME: APP_HOME, PORT: String(APP_PORT), NODE_ENV: 'production' }).map(([k, v]) => `${k}=${v}`);
  return ['env', '-i', ...pairs, 'setpriv', `--reuid=${APP_USER}`, `--regid=${APP_USER}`, '--init-groups', '--no-new-privs', '--', ...cmd];
}

/** Egress rules. Project code may reach the public internet but never the platform's private or metadata networks. */
export const DENIED_EGRESS_CIDRS = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24',
  '192.168.0.0/16', '198.18.0.0/15', '224.0.0.0/4', '240.0.0.0/4',
];
/**
 * Egress policy: any public domain, but never the private/metadata ranges. (The Vercel API rejects IPv6 CIDRs,
 * and sandboxes have no global IPv6 route, so only IPv4 ranges can and need to be listed. Verified for real.)
 * "allow: {'*': []}" is required: with only deny CIDRs, no public DNS name resolves at all.
 */
export function serverNetworkPolicy() {
  return { allow: { '*': [] as never[] }, subnets: { deny: [...DENIED_EGRESS_CIDRS] } };
}
