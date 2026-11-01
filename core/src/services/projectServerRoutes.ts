import { Router, type Request, type Response } from 'express';
import { env } from '../config/env';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { assertProjectRole } from './projectCollaboration';
import { isAdminUser } from './abuseWarning';
import { getUserTier } from './credits';
import { planAllowsServer } from './projectServerPolicy';
import { buildUsageView, quotaRaw, setKillSwitch, setOwnerControls, claimStops } from './projectServerLifecycle';
import { reapServers, stopServer, stopClaimed } from './projectServer';

/** Lifecycle, usage, admin and cron endpoints for project servers (Pro). Mounted next to the billing router. */
const router = Router();
const NIL = '00000000-0000-0000-0000-000000000000';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (res: Response, status: number, message: string) => res.status(status).json({ success: false, error: message });
const oops = (res: Response, scope: string, e: unknown) => { console.error(`[project-servers] ${scope}`, e); fail(res, 500, 'Something went wrong. Try again.'); };

async function allocatedFor(ownerId: string, projectId: string | null) {
  let q = supabaseAdmin.from('project_server_sessions').select('vcpus, memory_mb').eq('owner_id', ownerId).order('started_at', { ascending: false }).limit(1);
  if (projectId) q = q.eq('project_id', projectId);
  const { data } = await q;
  const row = data?.[0];
  return row ? { vcpus: row.vcpus ?? null, memoryMb: row.memory_mb ?? null } : null;
}

// What this account has used and what is left, with measured and estimated figures kept apart.
router.get('/api/project-servers/usage', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const tier = await getUserTier(req.user!.id);
    if (!planAllowsServer(tier)) { fail(res, 402, 'Project servers are part of the Pro plan.'); return; }
    const quota = await quotaRaw(req.user!.id, NIL, tier);
    res.json({ success: true, usage: buildUsageView(quota, await allocatedFor(req.user!.id, null)) });
  } catch (e) { oops(res, 'usage', e); }
});

router.get('/api/projects/:projectId/server/usage', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    await assertProjectRole(req.user!.id, req.params.projectId, 'owner');
    const tier = await getUserTier(req.user!.id);
    if (!planAllowsServer(tier)) { fail(res, 402, 'Project servers are part of the Pro plan.'); return; }
    const quota = await quotaRaw(req.user!.id, req.params.projectId, tier);
    const { data: rt } = await supabaseAdmin.from('project_server_runtime').select('state, last_request_at, started_at, fail_count, last_error, next_attempt_at').eq('project_id', req.params.projectId).maybeSingle();
    res.json({
      success: true,
      server: { state: rt?.state ?? 'STOPPED', lastRequestAt: rt?.last_request_at ?? null, startedAt: rt?.started_at ?? null, failedStarts: rt?.fail_count ?? 0, retryAt: rt?.next_attempt_at ?? null },
      usage: buildUsageView(quota, await allocatedFor(req.user!.id, req.params.projectId)),
    });
  } catch (e) { const status = (e as { status?: number }).status; if (status === 403 || status === 404) fail(res, status, 'Not allowed.'); else oops(res, 'project usage', e); }
});

router.post('/api/projects/:projectId/server/stop', requireAuth, rateLimit, async (req: AuthedRequest, res: Response) => {
  try {
    await assertProjectRole(req.user!.id, req.params.projectId, 'owner');
    res.json({ success: true, stopped: await stopServer(req.params.projectId, { force: true }) });
  } catch (e) { const status = (e as { status?: number }).status; if (status === 403 || status === 404) fail(res, status, 'Not allowed.'); else oops(res, 'stop', e); }
});

// ---- Admin -----------------------------------------------------------------------------------------------------
async function admin(req: AuthedRequest, res: Response): Promise<string | null> {
  if (!(await isAdminUser(req.user!.id))) { fail(res, 403, 'Not allowed.'); return null; }
  return req.user!.id;
}
const text = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

router.get('/api/admin/project-servers', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    if (!(await admin(req, res))) return;
    const [{ data: platform }, { data: servers }, { data: events }] = await Promise.all([
      supabaseAdmin.from('project_server_platform').select('kill_switch, reason, updated_at').eq('id', 1).maybeSingle(),
      supabaseAdmin.from('project_server_runtime').select('project_id, owner_id, state, tier, last_request_at, fail_count, last_error, updated_at').neq('state', 'STOPPED').order('updated_at', { ascending: false }).limit(200),
      supabaseAdmin.from('project_server_events').select('project_id, owner_id, kind, detail, created_at').order('id', { ascending: false }).limit(100),
    ]);
    res.json({ success: true, platform, servers: servers ?? [], events: events ?? [] });
  } catch (e) { oops(res, 'admin list', e); }
});

// Emergency stop for the whole platform: no server can start, and every running one is shut down.
router.post('/api/admin/project-servers/kill-switch', requireAuth, rateLimit, async (req: AuthedRequest, res: Response) => {
  try {
    const adminId = await admin(req, res); if (!adminId) return;
    const engaged = req.body?.engaged === true;
    await setKillSwitch(engaged, text(req.body?.reason), adminId);
    const reaped = engaged ? await reapServers({ maxMs: 200_000 }) : null;
    res.json({ success: true, engaged, reaped });
  } catch (e) { oops(res, 'kill switch', e); }
});

// Suspend (or restore) one owner's servers and/or change their allowance multiplier (0 to 5). Suspension stops them at once.
router.post('/api/admin/project-servers/owners/:ownerId', requireAuth, rateLimit, async (req: AuthedRequest, res: Response) => {
  try {
    const adminId = await admin(req, res); if (!adminId) return;
    if (!UUID.test(req.params.ownerId)) { fail(res, 400, 'Invalid owner.'); return; }
    const suspended = typeof req.body?.suspended === 'boolean' ? req.body.suspended : null;
    const multiplier = req.body?.allowanceMultiplier === undefined ? null : Number(req.body.allowanceMultiplier);
    if (multiplier !== null && (!Number.isFinite(multiplier) || multiplier < 0 || multiplier > 5)) { fail(res, 400, 'The multiplier must be between 0 and 5.'); return; }
    await setOwnerControls(req.params.ownerId, suspended, text(req.body?.reason) || null, multiplier, adminId);
    let stopped = 0;
    if (suspended === true) for (const c of await claimStops({ ownerId: req.params.ownerId, limit: 50 })) if (await stopClaimed(c)) stopped += 1;
    res.json({ success: true, stopped });
  } catch (e) { oops(res, 'owner controls', e); }
});

router.post('/api/admin/project-servers/:projectId/stop', requireAuth, rateLimit, async (req: AuthedRequest, res: Response) => {
  try {
    if (!(await admin(req, res))) return;
    if (!UUID.test(req.params.projectId)) { fail(res, 400, 'Invalid project.'); return; }
    res.json({ success: true, stopped: await stopServer(req.params.projectId, { force: true }) });
  } catch (e) { oops(res, 'admin stop', e); }
});

// ---- Cron ------------------------------------------------------------------------------------------------------
// Safe to run from several places at once: claims use row locks and leases. Same bearer secret as the other cron job.
router.get('/api/internal/cron/project-servers-reap', async (req: Request, res: Response) => {
  const secret = env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) { fail(res, 401, 'Unauthorized.'); return; }
  try { res.json({ success: true, ...(await reapServers()) }); } catch (e) { oops(res, 'reaper', e); }
});

export default router;
