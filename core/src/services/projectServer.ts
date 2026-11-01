import crypto from 'node:crypto';
import type { Sandbox } from '@vercel/sandbox' with { "resolution-mode": "import" };
import { env } from '../config/env';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { assertProjectRole } from './projectCollaboration';
import { listProjectFilesWithContent } from './projectFs';
import { getProjectEnvVarsForRuntime } from './projectEnvVars';
import { getUserTier } from './credits';
import { BINARY_PREFIX } from './binaryFiles';
import {
  SERVER_PORT, IDLE_WINDOW_MS, PROXY_TIMEOUT_MS, START_TIMEOUT_MS, RESPONSE_BODY_MAX, APP_DIR,
  cleanResponseHeaders, startCommandProblem, planAllowsServer, sanitizeAppEnv, serverNetworkPolicy,
} from './projectServerPolicy';
import { deriveProjectKey, signRequest, expectedProof, nonceOf, gatewaySecretProblem, CREDENTIAL_HEADER } from './projectServerAuth';
import { gateScript } from './projectGateRuntime';
import {
  STAGE_DIR, stagePrepareArgs, provisionArgs, freshCheckArgs, installArgs, writeHashArgs, gateStartArgs, appStartArgs, tailLogArgs, stopProcessesArgs,
} from './projectServerProvision';

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

/** Per-project signing key. Throws a clear, non-leaky error when the platform is not configured. */
function gatewayKey(projectId: string): string {
  const problem = gatewaySecretProblem(env.PROJECT_SERVER_GATEWAY_SECRET);
  if (problem) throw new ProjectServerError('Project servers are not available right now.', 503, problem);
  return deriveProjectKey(env.PROJECT_SERVER_GATEWAY_SECRET as string, projectId);
}

/** True only when the REAL gate answers with a valid proof (project code cannot forge it) and the app is listening behind it. */
async function isUp(sandbox: Sandbox, projectId: string): Promise<boolean> {
  try {
    const key = gatewayKey(projectId);
    const cred = signRequest({ keyHex: key, projectId, method: 'GET', url: '/__kx/health' });
    const res = await fetch(sandbox.domain(SERVER_PORT) + '/__kx/health', { headers: { [CREDENTIAL_HEADER]: cred }, signal: AbortSignal.timeout(3000), redirect: 'manual' });
    const body = (await res.json().catch(() => null)) as { gate?: boolean; upstream?: boolean } | null;
    return res.status === 200 && res.headers.get('x-kx-proof') === expectedProof(key, nonceOf(cred)) && body?.gate === true && body?.upstream === true;
  } catch { return false; }
}

const starting = new Map<string, Promise<Sandbox>>();
let startsInFlight = 0;
const MAX_STARTS_IN_FLIGHT = 3;

async function tail(sandbox: Sandbox): Promise<string> {
  try {
    const [cmd, ...args] = tailLogArgs();
    const r = await sandbox.runCommand({ cmd, args, sudo: true, timeoutMs: 10_000 });
    return (await r.stdout()).trim();
  } catch { return ''; }
}

async function startServer(ownerId: string, projectId: string): Promise<Sandbox> {
  const key = gatewayKey(projectId);
  const { Sandbox } = await loadSandboxModule();
  const sandbox = await Sandbox.getOrCreate({
    name: serverSandboxName(projectId),
    runtime: 'node24',
    timeout: IDLE_WINDOW_MS,
    ports: [SERVER_PORT],
    resources: { vcpus: 1 },
    persistent: true,
    networkPolicy: serverNetworkPolicy(),
    snapshotExpiration: SNAPSHOT_KEEP.expiration,
    keepLastSnapshots: SNAPSHOT_KEEP,
  });
  if (sandbox.status === 'running' && (await isUp(sandbox, projectId))) return sandbox;
  // A sandbox created before this policy existed (or restored from a snapshot) must still get it.
  await sandbox.updateNetworkPolicy(serverNetworkPolicy());

  const files = await listProjectFilesWithContent(ownerId, projectId);
  const pkg = files.find((f) => f.path === 'package.json');
  const problem = startCommandProblem(typeof pkg?.content === 'string' ? pkg.content : null);
  if (problem) throw new ProjectServerError(problem, 400);

  const run = async (argv: string[], opts: { sudo?: boolean; cwd?: string; timeoutMs: number }) => {
    const [cmd, ...args] = argv;
    return sandbox.runCommand({ cmd, args, sudo: opts.sudo, cwd: opts.cwd, timeoutMs: opts.timeoutMs });
  };

  // 1. Hand files to root through a private staging dir; root installs the gate+key root-only and gives the project to kxapp.
  await run(stagePrepareArgs(), { timeoutMs: 15_000 });
  await sandbox.writeFiles([
    { path: `${STAGE_DIR}/gate.cjs`, content: Buffer.from(gateScript(), 'utf8') },
    { path: `${STAGE_DIR}/key`, content: Buffer.from(key, 'utf8') },
    ...files.filter((f) => typeof f.content === 'string').map((f) => {
      const content = f.content ?? '';
      return { path: `${STAGE_DIR}/app/${f.path}`, content: content.startsWith(BINARY_PREFIX) ? Buffer.from(content.slice(BINARY_PREFIX.length), 'base64') : Buffer.from(content, 'utf8') };
    }),
  ]);
  const prov = await run(provisionArgs(), { sudo: true, timeoutMs: 60_000 });
  if (prov.exitCode !== 0) throw new ProjectServerError('Preparing your server failed.', 502, ((await prov.stderr()) || '').trim().slice(-1000));

  // 2. Dependencies, as kxapp with a clean environment.
  const userEnv = sanitizeAppEnv(await getProjectEnvVarsForRuntime(ownerId, projectId));
  const hash = crypto.createHash('sha256')
    .update(files.filter((f) => /^(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(f.path)).map((f) => `${f.path}\n${f.content ?? ''}`).join('\n'))
    .digest('hex').slice(0, 16);
  const fresh = await run(freshCheckArgs(userEnv, hash), { sudo: true, cwd: APP_DIR, timeoutMs: 15_000 });
  if (fresh.exitCode !== 0) {
    const install = await run(installArgs(userEnv), { sudo: true, cwd: APP_DIR, timeoutMs: 150_000 });
    if (install.exitCode !== 0) throw new ProjectServerError('Installing your dependencies failed.', 502, ((await install.stderr()) || '').trim().slice(-3000));
    await run(writeHashArgs(userEnv, hash), { sudo: true, cwd: APP_DIR, timeoutMs: 10_000 });
  }

  // 3. The gate first (it owns the public port), then project code on a loopback-only port, both detached.
  const [gcmd, ...gargs] = gateStartArgs(projectId);
  await sandbox.runCommand({ cmd: gcmd, args: gargs, sudo: true, detached: true });
  const [acmd, ...aargs] = appStartArgs(userEnv);
  await sandbox.runCommand({ cmd: acmd, args: aargs, sudo: true, cwd: APP_DIR, detached: true });

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isUp(sandbox, projectId)) return sandbox;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new ProjectServerError('Your server did not start listening on the port in time. Make sure it uses process.env.PORT.', 504, await tail(sandbox));
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
    const url = req.path + req.query;
    const credential = signRequest({ keyHex: gatewayKey(projectId), projectId, method: req.method, url, body: req.body });
    res = await fetch(sandbox.domain(SERVER_PORT) + url, {
      method: req.method, headers: { ...req.headers, [CREDENTIAL_HEADER]: credential }, body: req.body && req.body.length ? new Uint8Array(req.body) : undefined,
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
