import crypto from 'node:crypto';
import type { Sandbox } from '@vercel/sandbox' with { "resolution-mode": "import" };
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { assertProjectRole } from './projectCollaboration';
import { listProjectFilesWithContent } from './projectFs';
import { getProjectEnvVarsForRuntime } from './projectEnvVars';
import { getUserTier } from './credits';
import { BINARY_PREFIX } from './binaryFiles';
import {
  SERVER_PORT, IDLE_WINDOW_MS, PROXY_TIMEOUT_MS, START_TIMEOUT_MS, RESPONSE_BODY_MAX,
  cleanResponseHeaders, startCommandProblem, planAllowsServer,
} from './projectServerPolicy';

const PROJECT_ROOT = '/vercel/sandbox/project';
const LOG_FILE = '/tmp/kx-server.log';
const SNAPSHOT_KEEP = { count: 1, expiration: 7 * 24 * 60 * 60 * 1000 };

export class ProjectServerError extends Error {
  constructor(message: string, public status = 400, public logs = '') { super(message); }
}

type SandboxModule = typeof import('@vercel/sandbox', { with: { "resolution-mode": "import" } });
let sandboxModulePromise: Promise<SandboxModule> | null = null;
function loadSandboxModule(): Promise<SandboxModule> {
  // Same ESM-from-CommonJS workaround as projectRuntime.ts.
  if (!sandboxModulePromise) sandboxModulePromise = (new Function('return import("@vercel/sandbox")') as () => Promise<SandboxModule>)();
  return sandboxModulePromise;
}

const serverSandboxName = (projectId: string) => `kx-srv-${projectId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 48)}`;

export async function getServerSettings(projectId: string): Promise<{ enabled: boolean }> {
  const { data, error } = await supabaseAdmin.from('project_server_settings').select('enabled').eq('project_id', projectId).maybeSingle();
  if (error) throw new Error(`Server settings lookup failed: ${error.message}`);
  return { enabled: data?.enabled === true };
}

export async function saveServerSettings(userId: string, projectId: string, input: any): Promise<{ enabled: boolean }> {
  await assertProjectRole(userId, projectId, 'owner');
  const enabled = input?.enabled === true;
  if (enabled && !planAllowsServer(await getUserTier(userId))) throw new ProjectServerError('Project servers are part of the Pro plan. Upgrade in Billing to turn this on.', 402);
  const { error } = await supabaseAdmin.from('project_server_settings').upsert({ project_id: projectId, enabled, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Server settings save failed: ${error.message}`);
  if (!enabled) await stopServer(projectId);
  return { enabled };
}

export async function stopServer(projectId: string): Promise<void> {
  try {
    const { Sandbox } = await loadSandboxModule();
    const sandbox = await Sandbox.get({ name: serverSandboxName(projectId), resume: false });
    if (sandbox.status === 'running') await sandbox.stop();
  } catch { /* not created yet, or already stopped */ }
}

async function isUp(sandbox: Sandbox): Promise<boolean> {
  try {
    const res = await fetch(sandbox.domain(SERVER_PORT) + '/', { signal: AbortSignal.timeout(3000), redirect: 'manual' });
    await res.body?.cancel();
    return true; // any HTTP answer, even 404, means something is listening
  } catch { return false; }
}

const starting = new Map<string, Promise<Sandbox>>();
let startsInFlight = 0;
const MAX_STARTS_IN_FLIGHT = 3;

async function tail(sandbox: Sandbox): Promise<string> {
  try {
    const r = await sandbox.runCommand({ cmd: 'sh', args: ['-c', `tail -c 3000 ${LOG_FILE} 2>/dev/null || true`], timeoutMs: 10_000 });
    return (await r.stdout()).trim();
  } catch { return ''; }
}

async function startServer(ownerId: string, projectId: string): Promise<Sandbox> {
  const { Sandbox } = await loadSandboxModule();
  const sandbox = await Sandbox.getOrCreate({
    name: serverSandboxName(projectId),
    runtime: 'node24',
    timeout: IDLE_WINDOW_MS,
    ports: [SERVER_PORT],
    resources: { vcpus: 1 },
    persistent: true,
    snapshotExpiration: SNAPSHOT_KEEP.expiration,
    keepLastSnapshots: SNAPSHOT_KEEP,
  });
  if (sandbox.status === 'running' && (await isUp(sandbox))) return sandbox;

  const files = await listProjectFilesWithContent(ownerId, projectId);
  const pkg = files.find((f) => f.path === 'package.json');
  const problem = startCommandProblem(typeof pkg?.content === 'string' ? pkg.content : null);
  if (problem) throw new ProjectServerError(problem, 400);

  await sandbox.writeFiles(files.filter((f) => typeof f.content === 'string').map((f) => {
    const content = f.content ?? '';
    return { path: `${PROJECT_ROOT}/${f.path}`, content: content.startsWith(BINARY_PREFIX) ? Buffer.from(content.slice(BINARY_PREFIX.length), 'base64') : Buffer.from(content, 'utf8') };
  }));

  const hash = crypto.createHash('sha256')
    .update(files.filter((f) => /^(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(f.path)).map((f) => `${f.path}\n${f.content ?? ''}`).join('\n'))
    .digest('hex').slice(0, 16);
  const env = { ...(await getProjectEnvVarsForRuntime(ownerId, projectId)), PORT: String(SERVER_PORT), HOST: '0.0.0.0', NODE_ENV: 'production' };

  const fresh = await sandbox.runCommand({ cmd: 'sh', args: ['-c', `[ -d node_modules ] && [ "$(cat .kx-hash 2>/dev/null)" = "${hash}" ]`], cwd: PROJECT_ROOT, timeoutMs: 15_000 });
  if (fresh.exitCode !== 0) {
    const install = await sandbox.runCommand({ cmd: 'npm', args: ['install', '--no-audit', '--no-fund'], cwd: PROJECT_ROOT, env, timeoutMs: 150_000 });
    if (install.exitCode !== 0) throw new ProjectServerError('Installing your dependencies failed.', 502, ((await install.stderr()) || '').trim().slice(-3000));
    await sandbox.runCommand({ cmd: 'sh', args: ['-c', `echo ${hash} > .kx-hash`], cwd: PROJECT_ROOT, timeoutMs: 10_000 });
  }

  await sandbox.runCommand({ cmd: 'sh', args: ['-c', `fuser -k ${SERVER_PORT}/tcp 2>/dev/null; true`], timeoutMs: 10_000 });
  await sandbox.runCommand({ cmd: 'sh', args: ['-c', `npm start > ${LOG_FILE} 2>&1`], cwd: PROJECT_ROOT, env, detached: true });

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isUp(sandbox)) return sandbox;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new ProjectServerError(`Your server did not start listening on port ${SERVER_PORT} in time. Make sure it uses process.env.PORT and host 0.0.0.0.`, 504, await tail(sandbox));
}

/** Makes sure the project's server is awake, starting it if needed. One start at a time per project. */
export async function ensureServerRunning(ownerId: string, projectId: string): Promise<Sandbox> {
  const pending = starting.get(projectId);
  if (pending) return pending;
  if (startsInFlight >= MAX_STARTS_IN_FLIGHT) throw new ProjectServerError('The platform is busy waking servers. Try again in a few seconds.', 503);
  startsInFlight += 1;
  const p = startServer(ownerId, projectId).finally(() => { starting.delete(projectId); startsInFlight -= 1; });
  starting.set(projectId, p);
  return p;
}

/** Each request pushes the sleep time out, so a server stays awake while it is being used. */
async function keepAwake(sandbox: Sandbox) {
  try {
    const left = sandbox.expiresAt ? sandbox.expiresAt.getTime() - Date.now() : 0;
    if (left < IDLE_WINDOW_MS / 2) await sandbox.extendTimeout(IDLE_WINDOW_MS - Math.max(0, left));
  } catch { /* plan maximum reached: it will restart on the next request */ }
}

function headerPairs(h: Headers): [string, string][] {
  const out: [string, string][] = [];
  h.forEach((value, name) => out.push([name, value]));
  return out;
}

export interface ProxyResult { status: number; headers: Record<string, string>; body: Buffer }

export async function proxyToServer(
  ownerId: string, projectId: string, req: { method: string; path: string; query: string; headers: Record<string, string>; body?: Buffer },
): Promise<ProxyResult> {
  const sandbox = await ensureServerRunning(ownerId, projectId);
  void keepAwake(sandbox);
  let res: Response;
  try {
    res = await fetch(sandbox.domain(SERVER_PORT) + req.path + req.query, {
      method: req.method, headers: req.headers, body: req.body && req.body.length ? new Uint8Array(req.body) : undefined,
      redirect: 'manual', signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
  } catch {
    throw new ProjectServerError('The server did not answer in time.', 504);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > RESPONSE_BODY_MAX) { await reader.cancel(); throw new ProjectServerError('The server sent a reply that is too large (5 MB limit).', 502); }
      chunks.push(Buffer.from(value));
    }
  }
  const status = res.status >= 300 && res.status < 400 ? 502 : res.status; // redirects are not followed or passed on
  return { status, headers: cleanResponseHeaders(headerPairs(res.headers)), body: Buffer.concat(chunks) };
}

/** Why a public request may not reach the server, or null when it may. Checked on every request. */
export async function publicServerBlocker(projectId: string): Promise<{ ownerId: string } | { error: string; status: number }> {
  const { data: project, error } = await supabaseAdmin.from('projects').select('user_id').eq('id', projectId).maybeSingle();
  if (error) throw new Error(`Project lookup failed: ${error.message}`);
  if (!project?.user_id) return { error: 'Not found.', status: 404 };
  const settings = await getServerSettings(projectId);
  if (!settings.enabled) return { error: 'Not found.', status: 404 };
  if (!planAllowsServer(await getUserTier(project.user_id))) return { error: 'This server is not available right now.', status: 503 };
  return { ownerId: project.user_id };
}
