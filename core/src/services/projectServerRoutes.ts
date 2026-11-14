import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { env } from '../config/env';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { assertProjectRole } from './projectCollaboration';
import { isAdminUser } from './abuseWarning';
import { getUserTier } from './credits';
import { planAllowsServer } from './projectServerPolicy';
import { hitsSummary } from './projectServerHits';
import { buildUsageView, buildServerOverview, quotaRaw, usageRaw, parseMonth, setKillSwitch, setOwnerControls, claimStops, type StopClaim } from './projectServerLifecycle';
import { reapServers, stopServer, stopClaimed } from './projectServer';

/** Everything the routes touch, so tests can run the real handlers against stubs. Production uses `realDeps`. */
export interface RouteDeps {
  requireAuth: RequestHandler;
  rateLimit: RequestHandler;
  isAdminUser: (userId: string) => Promise<boolean>;
  getUserTier: (userId: string) => Promise<string>;
  assertProjectRole: (userId: string, projectId: string, role: 'owner') => Promise<unknown>;
  quotaRaw: typeof quotaRaw;
  usageRaw: typeof usageRaw;
  claimStops: typeof claimStops;
  setKillSwitch: typeof setKillSwitch;
  setOwnerControls: typeof setOwnerControls;
  reapServers: typeof reapServers;
  stopServer: typeof stopServer;
  stopClaimed: (c: StopClaim) => Promise<boolean>;
  hitsSummary: typeof hitsSummary;
  db: typeof supabaseAdmin;
  cronSecret: () => string | undefined;
}

export const realDeps: RouteDeps = {
  requireAuth: requireAuth as unknown as RequestHandler, rateLimit: rateLimit as unknown as RequestHandler, isAdminUser,
  getUserTier: getUserTier as RouteDeps['getUserTier'], assertProjectRole: assertProjectRole as RouteDeps['assertProjectRole'],
  quotaRaw, usageRaw, claimStops, setKillSwitch, setOwnerControls, reapServers, stopServer, stopClaimed, hitsSummary, db: supabaseAdmin, cronSecret: () => env.CRON_SECRET,
};

const NIL = '00000000-0000-0000-0000-000000000000';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (res: Response, status: number, message: string) => res.status(status).json({ success: false, error: message });
const oops = (res: Response, scope: string, e: unknown) => { console.error(`[project-servers] ${scope}`, e); fail(res, 500, 'Something went wrong. Try again.'); };
const text = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Constant-time comparison so the cron secret cannot be guessed byte by byte. */
export function bearerMatches(header: string | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const a = crypto.createHash('sha256').update(header).digest();
  const b = crypto.createHash('sha256').update(`Bearer ${secret}`).digest();
  return crypto.timingSafeEqual(a, b);
}

/** The administrator is whoever the server-side authentication says is signed in. Nothing the client sends is consulted. */
export const ADMIN_ID = Symbol('adminId');
type AdminRequest = AuthedRequest & { [ADMIN_ID]?: string };
export const adminIdOf = (req: Request): string => (req as AdminRequest)[ADMIN_ID] as string;

export function createProjectServerRouter(d: RouteDeps = realDeps): Router {
  const router = Router();

  async function allocatedFor(ownerId: string, projectId: string | null) {
    let q = d.db.from('project_server_sessions').select('vcpus, memory_mb').eq('owner_id', ownerId).order('started_at', { ascending: false }).limit(1);
    if (projectId) q = q.eq('project_id', projectId);
    const { data } = await q;
    const row = data?.[0];
    return row ? { vcpus: row.vcpus ?? null, memoryMb: row.memory_mb ?? null } : null;
  }
  const httpStatus = (e: unknown) => (e as { status?: number }).status;

  // What this account has used and what is left, with measured and estimated figures kept apart.
  // ?month=YYYY-MM shows one past or current UTC month (measured and estimated figures only).
  router.get('/api/project-servers/usage', d.requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const tier = await d.getUserTier(req.user!.id);
      if (!planAllowsServer(tier)) { fail(res, 402, 'Project servers are part of the Pro plan.'); return; }
      if (req.query.month !== undefined) {
        const month = parseMonth(req.query.month);
        if (!month) { fail(res, 400, 'Use a month like 2026-10.'); return; }
        const u = await d.usageRaw(req.user!.id, null, month);
        const v = buildUsageView({ ok: true, usage_owner: u, limits: {} }, null);
        res.json({ success: true, usage: { period: { startsAt: u.period_start, endsAt: u.period_end }, measured: v.measured, estimated: v.estimated } });
        return;
      }
      const quota = await d.quotaRaw(req.user!.id, NIL, tier);
      res.json({ success: true, usage: buildUsageView(quota, await allocatedFor(req.user!.id, null)) });
    } catch (e) { oops(res, 'usage', e); }
  });

  // The Usage page's Server card: account meters, one row per project with a server, and what each one was asked for.
  router.get('/api/project-servers/overview', d.requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const ownerId = req.user!.id;
      const tier = await d.getUserTier(ownerId);
      if (!planAllowsServer(tier)) { fail(res, 402, 'Project servers are part of the Pro plan.'); return; }
      const { data: enabled } = await d.db.from('project_server_settings').select('project_id').eq('enabled', true).limit(50);
      const ids = (enabled ?? []).map((r: { project_id: string }) => r.project_id);
      let owned: { id: string; name: string }[] = [];
      if (ids.length) {
        const { data } = await d.db.from('projects').select('id, name').eq('user_id', ownerId).in('id', ids).limit(10);
        owned = (data ?? []) as { id: string; name: string }[];
      }
      const projects = await Promise.all(owned.map(async (p) => {
        const [quota, rt, hits] = await Promise.all([
          d.quotaRaw(ownerId, p.id, tier),
          d.db.from('project_server_runtime').select('state').eq('project_id', p.id).maybeSingle(),
          d.hitsSummary(ownerId, p.id).catch(() => null),
        ]);
        return { projectId: p.id, name: p.name, state: (rt as { data?: { state?: string } | null }).data?.state ?? 'STOPPED', quota, hits };
      }));
      const ownerQuota = projects[0]?.quota ?? await d.quotaRaw(ownerId, NIL, tier);
      res.json({ success: true, overview: buildServerOverview(tier, ownerQuota, projects) });
    } catch (e) { oops(res, 'overview', e); }
  });

  router.get('/api/projects/:projectId/server/usage', d.requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      await d.assertProjectRole(req.user!.id, req.params.projectId, 'owner');
      const tier = await d.getUserTier(req.user!.id);
      if (!planAllowsServer(tier)) { fail(res, 402, 'Project servers are part of the Pro plan.'); return; }
      const quota = await d.quotaRaw(req.user!.id, req.params.projectId, tier);
      const { data: rt } = await d.db.from('project_server_runtime').select('state, last_request_at, started_at, fail_count, last_error, next_attempt_at').eq('project_id', req.params.projectId).maybeSingle();
      res.json({
        success: true,
        server: { state: rt?.state ?? 'STOPPED', lastRequestAt: rt?.last_request_at ?? null, startedAt: rt?.started_at ?? null, failedStarts: rt?.fail_count ?? 0, retryAt: rt?.next_attempt_at ?? null },
        usage: buildUsageView(quota, await allocatedFor(req.user!.id, req.params.projectId)),
      });
    } catch (e) { const status = httpStatus(e); if (status === 403 || status === 404) fail(res, status, 'Not allowed.'); else oops(res, 'project usage', e); }
  });

  router.post('/api/projects/:projectId/server/stop', d.requireAuth, d.rateLimit, async (req: AuthedRequest, res: Response) => {
    try {
      await d.assertProjectRole(req.user!.id, req.params.projectId, 'owner');
      res.json({ success: true, stopped: await d.stopServer(req.params.projectId, { force: true }) });
    } catch (e) { const status = httpStatus(e); if (status === 403 || status === 404) fail(res, status, 'Not allowed.'); else oops(res, 'stop', e); }
  });

  // ---- Admin -------------------------------------------------------------------------------------------------
  // One guard for the whole prefix, so no admin route can be added without it. Authentication (a verified session)
  // runs first and sets req.user; the guard then looks that id up in admin_users. API keys are never accepted here.
  const adminGuard = async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const id = req.user?.id;
      if (!id || req.authMethod === 'api_key' || !(await d.isAdminUser(id))) { fail(res, 403, 'Not allowed.'); return; }
      (req as AdminRequest)[ADMIN_ID] = id;
      next();
    } catch { fail(res, 403, 'Not allowed.'); }
  };
  router.use('/api/admin/project-servers', d.requireAuth, adminGuard as unknown as RequestHandler);

  router.get('/api/admin/project-servers', async (_req: Request, res: Response) => {
    try {
      const [{ data: platform }, { data: servers }, { data: events }] = await Promise.all([
        d.db.from('project_server_platform').select('kill_switch, reason, updated_at').eq('id', 1).maybeSingle(),
        d.db.from('project_server_runtime').select('project_id, owner_id, state, tier, last_request_at, fail_count, last_error, updated_at').neq('state', 'STOPPED').order('updated_at', { ascending: false }).limit(200),
        d.db.from('project_server_events').select('project_id, owner_id, kind, detail, created_at').order('id', { ascending: false }).limit(100),
      ]);
      res.json({ success: true, platform, servers: servers ?? [], events: events ?? [] });
    } catch (e) { oops(res, 'admin list', e); }
  });

  // Emergency stop for the whole platform: no server can start, and every running one is shut down.
  router.post('/api/admin/project-servers/kill-switch', d.rateLimit, async (req: Request, res: Response) => {
    try {
      const engaged = req.body?.engaged === true;
      await d.setKillSwitch(engaged, text(req.body?.reason), adminIdOf(req));
      const reaped = engaged ? await d.reapServers({ maxMs: 200_000 }) : null;
      res.json({ success: true, engaged, reaped });
    } catch (e) { oops(res, 'kill switch', e); }
  });

  // One owner's allowance multiplier, suspension and this month's usage, so an admin can see what they are changing.
  router.get('/api/admin/project-servers/owners/:ownerId', async (req: Request, res: Response) => {
    try {
      if (!UUID.test(req.params.ownerId)) { fail(res, 400, 'Invalid owner.'); return; }
      const tier = await d.getUserTier(req.params.ownerId);
      const { data: controls } = await d.db.from('project_server_owner_controls').select('suspended, reason, allowance_multiplier').eq('owner_id', req.params.ownerId).maybeSingle();
      const quota = planAllowsServer(tier) ? await d.quotaRaw(req.params.ownerId, NIL, tier) : null;
      res.json({
        success: true, tier,
        controls: { suspended: controls?.suspended ?? false, reason: controls?.reason ?? null, multiplier: Number(controls?.allowance_multiplier ?? 1) },
        overview: quota ? buildServerOverview(tier, quota, []) : null,
      });
    } catch (e) { oops(res, 'admin owner', e); }
  });

  // Suspend (or restore) one owner's servers and/or change their allowance multiplier (0 to 5). Suspension stops them at once.
  router.post('/api/admin/project-servers/owners/:ownerId', d.rateLimit, async (req: Request, res: Response) => {
    try {
      if (!UUID.test(req.params.ownerId)) { fail(res, 400, 'Invalid owner.'); return; }
      const suspended = typeof req.body?.suspended === 'boolean' ? req.body.suspended : null;
      const multiplier = req.body?.allowanceMultiplier === undefined ? null : Number(req.body.allowanceMultiplier);
      if (multiplier !== null && (!Number.isFinite(multiplier) || multiplier < 0 || multiplier > 5)) { fail(res, 400, 'The multiplier must be between 0 and 5.'); return; }
      await d.setOwnerControls(req.params.ownerId, suspended, text(req.body?.reason) || null, multiplier, adminIdOf(req));
      let stopped = 0;
      if (suspended === true) for (const c of await d.claimStops({ ownerId: req.params.ownerId, limit: 50 })) if (await d.stopClaimed(c)) stopped += 1;
      res.json({ success: true, stopped });
    } catch (e) { oops(res, 'owner controls', e); }
  });

  router.post('/api/admin/project-servers/:projectId/stop', d.rateLimit, async (req: Request, res: Response) => {
    try {
      if (!UUID.test(req.params.projectId)) { fail(res, 400, 'Invalid project.'); return; }
      res.json({ success: true, stopped: await d.stopServer(req.params.projectId, { force: true }) });
    } catch (e) { oops(res, 'admin stop', e); }
  });

  // ---- Cron --------------------------------------------------------------------------------------------------
  // Safe to run from several places at once: claims use row locks and leases. Same bearer secret as the other cron job.
  router.get('/api/internal/cron/project-servers-reap', async (req: Request, res: Response) => {
    if (!bearerMatches(req.headers.authorization, d.cronSecret())) { fail(res, 401, 'Unauthorized.'); return; }
    try { res.json({ success: true, ...(await d.reapServers()) }); } catch (e) { oops(res, 'reaper', e); }
  });

  return router;
}

export default createProjectServerRouter();
