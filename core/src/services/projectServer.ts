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
  SERVER_PORT, IDLE_WINDOW_MS, PROXY_TIMEOUT_MS, START_TIMEOUT_MS, RESPONSE_BODY_MAX, APP_DIR, NODE_RUNTIME,
  cleanResponseHeaders, startCommandProblem, planAllowsServer, sanitizeAppEnv, serverNetworkPolicy,
} from './projectServerPolicy';
import { deriveProjectKey, signRequest, expectedProof, nonceOf, gatewaySecretProblem, CREDENTIAL_HEADER } from './projectServerAuth';
import { gateScript } from './projectGateRuntime';
import {
  beginStart, markReady, markFailed, markStopped, stopFailed, touch, claimStops, denialResponse, measuredRecord, recordMeasured, unmeasuredSessions,
  type StopClaim, type SdkSession,
} from './projectServerLifecycle';
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
  const { data, error } = await supabaseAdmin.rpc('ps_set_enabled', { p_project: projectId, p_owner: userId, p_tier: await getUserTier(userId), p_enabled: enabled });
  if (error) throw new Error(`Server settings save failed: ${error.message}`);
  if (!(data as { ok?: boolean })?.ok) { const r = denialResponse(String((data as { reason?: string })?.reason ?? 'disabled')); throw new ProjectServerError(r.message, r.status); }
  if (!enabled) await stopServer(projectId);
  return { enabled };
}

/**
 * Stops one claimed server. The claim (generation + lease) was taken in the database, so two workers can never stop
 * the same server, and a start that happens afterwards is never clobbered (mark_stopped checks the generation).
 */
export async function stopClaimed(claim: StopClaim): Promise<boolean> {
  try {
    const { Sandbox } = await loadSandboxModule();
    let sandbox: Sandbox | null = null;
    try { sandbox = await Sandbox.get({ name: serverSandboxName(claim.project_id), resume: false }); } catch { sandbox = null; /* never created or already gone */ }
    if (sandbox && sandbox.status === 'running') await sandbox.stop();
    const ok = await markStopped(claim.project_id, claim.generation);
    if (ok) await reconcileProject(claim.project_id, claim.owner_id).catch(() => undefined);
    return ok;
  } catch (e) {
    await stopFailed(claim.project_id, claim.generation, (e as Error).message).catch(() => undefined);
    return false;
  }
}

/** Stops a project's server now (owner turned it off, admin action, or a dead sandbox being replaced). Safe to call any time. */
export async function stopServer(projectId: string, opts: { force?: boolean } = { force: true }): Promise<number> {
  const claims = await claimStops({ projectId, force: opts.force ?? true, limit: 1 });
  let stopped = 0;
  for (const c of claims) if (await stopClaimed(c)) stopped += 1;
  return stopped;
}

/**
 * Asks the platform for the measured numbers of sessions that ended, and records them once (idempotent by session id).
 * Sessions the platform has not finished reporting stay "estimated" and are retried by the next sweep.
 */
export async function reconcileProject(projectId: string, ownerId: string): Promise<number> {
  const { Sandbox } = await loadSandboxModule();
  let sandbox: Sandbox;
  try { sandbox = await Sandbox.get({ name: serverSandboxName(projectId), resume: false }); } catch { return 0; }
  const page = await sandbox.listSessions({ limit: 20, sortOrder: 'desc' });
  let recorded = 0;
  for (const s of page.sessions as unknown as SdkSession[]) {
    const rec = measuredRecord(s);
    if (rec && (await recordMeasured(projectId, ownerId, rec))) recorded += 1;
  }
  return recorded;
}

/** One reaper pass: stop what must stop, then finalize usage. Concurrency-safe: claims use SKIP LOCKED + leases. */
export async function reapServers(opts: { limit?: number; maxMs?: number } = {}): Promise<{ claimed: number; stopped: number; reasons: Record<string, number>; usageRecorded: number }> {
  const deadline = Date.now() + (opts.maxMs ?? 240_000);
  const reasons: Record<string, number> = {};
  let claimed = 0; let stopped = 0; let usageRecorded = 0;
  for (;;) {
    if (Date.now() > deadline) break;
    const claims = await claimStops({ limit: opts.limit ?? 10 });
    if (claims.length === 0) break;
    claimed += claims.length;
    const results = await Promise.all(claims.map(async (c) => { const ok = await stopClaimed(c); reasons[c.reason] = (reasons[c.reason] ?? 0) + 1; return ok; }));
    stopped += results.filter(Boolean).length;
  }
  const open = await unmeasuredSessions(50);
  const seen = new Set<string>();
  for (const row of open) {
    if (Date.now() > deadline) break;
    if (seen.has(row.project_id)) continue;
    seen.add(row.project_id);
    usageRecorded += await reconcileProject(row.project_id, row.owner_id).catch(() => 0);
  }
  return { claimed, stopped, reasons, usageRecorded };
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

async function tail(sandbox: Sandbox): Promise<string> {
  try {
    const [cmd, ...args] = tailLogArgs();
    const r = await sandbox.runCommand({ cmd, args, sudo: true, timeoutMs: 10_000 });
    return (await r.stdout()).trim();
  } catch { return ''; }
}

async function startServer(ownerId: string, projectId: string): Promise<Sandbox> {
  // Callers hold a database lease for this project (see ensureServerRunning), so only one worker is here at a time.
  const key = gatewayKey(projectId);
  const { Sandbox } = await loadSandboxModule();
  const sandbox = await Sandbox.getOrCreate({
    name: serverSandboxName(projectId),
    runtime: NODE_RUNTIME,
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

const inflight = new Map<string, Promise<Sandbox>>(); // coalesces callers inside ONE instance; the database lease coordinates across instances

async function sandboxIfUp(projectId: string): Promise<Sandbox | null> {
  try {
    const { Sandbox } = await loadSandboxModule();
    const sandbox = await Sandbox.get({ name: serverSandboxName(projectId), resume: false });
    return sandbox.status === 'running' && (await isUp(sandbox, projectId)) ? sandbox : null;
  } catch { return null; }
}

/**
 * Makes sure the project's server is awake. The database decides who may start it (plan, allowance, suspension,
 * kill switch, concurrency, backoff) and serialises starts with a lease + generation, so duplicate requests and
 * parallel serverless instances can never provision twice. Failed or interrupted starts are recoverable.
 */
export async function ensureServerRunning(ownerId: string, projectId: string): Promise<Sandbox> {
  const pending = inflight.get(projectId);
  if (pending) return pending;
  const p = ensureOnce(ownerId, projectId).finally(() => inflight.delete(projectId));
  inflight.set(projectId, p);
  return p;
}

async function ensureOnce(ownerId: string, projectId: string): Promise<Sandbox> {
  const tier = await getUserTier(ownerId);
  const deadline = Date.now() + START_TIMEOUT_MS + 15_000;
  for (let round = 0; round < 12 && Date.now() < deadline; round += 1) {
    const d = await beginStart(projectId, ownerId, tier);
    if (d.action === 'denied') { const r = denialResponse(d.reason, d.retry_after); throw new ProjectServerError(r.message, r.status); }

    if (d.action === 'ready') {
      const up = await sandboxIfUp(projectId);
      if (up) return up;
      // The database says it is running but the sandbox is gone (expired or crashed): reclaim and start fresh.
      await stopServer(projectId, { force: true });
      continue;
    }
    if (d.action === 'wait') { await new Promise((r) => setTimeout(r, 1500)); const up = await sandboxIfUp(projectId); if (up) return up; continue; }

    // action === 'start': we own generation d.generation.
    let sandbox: Sandbox | null = null;
    let superseded = false;
    try {
      sandbox = await startServer(ownerId, projectId);
      const s = sandbox.currentSession();
      const ok = await markReady(projectId, d.generation, s.sessionId, s.vcpus ?? null, s.memory ?? null, s.startedAt ?? new Date());
      if (!ok) { // we were superseded (lease expired and the reaper or another worker took over): do not leave an orphan running
        superseded = true;
        await sandbox.stop().catch(() => undefined);
        throw new ProjectServerError('The server was restarted by the platform. Try again.', 503);
      }
      return sandbox;
    } catch (e) {
      if (!superseded) {
        await markFailed(projectId, d.generation, e instanceof Error ? e.message : 'start failed').catch(() => undefined);
        if (sandbox) await sandbox.stop().catch(() => undefined);
      }
      throw e;
    }
  }
  throw new ProjectServerError('The server did not become ready in time. Try again.', 504);
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
  void touch(projectId).catch(() => undefined);
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
