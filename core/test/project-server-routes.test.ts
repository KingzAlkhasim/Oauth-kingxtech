// Runs the REAL route handlers (createProjectServerRouter) against stubbed dependencies over real HTTP.
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, before, after } from 'node:test';
import type { RequestHandler } from 'express';

for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) process.env[k] ??= 'test-placeholder';
process.env.SUPABASE_URL ??= 'http://127.0.0.1:9';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const express = require('express') as typeof import('express');
const { createProjectServerRouter, bearerMatches, realDeps } = require('../src/services/projectServerRoutes') as typeof import('../src/services/projectServerRoutes');
const { parseMonth } = require('../src/services/projectServerLifecycle') as typeof import('../src/services/projectServerLifecycle');

const ADMIN = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const VICTIM = '33333333-3333-4333-8333-333333333333';
const calls: { fn: string; args: unknown[] }[] = [];
const log = (fn: string) => (...args: unknown[]) => { calls.push({ fn, args }); };
let server: http.Server; let base = '';

// Stand-in for requireAuth: "Authorization: Bearer session:<id>" is a verified session, "Bearer key:<id>" an API key, anything else is rejected.
const fakeAuth: RequestHandler = (req, res, next) => {
  const m = /^Bearer (session|key):(.+)$/.exec(req.headers.authorization ?? '');
  if (!m) { res.status(401).json({ success: false }); return; }
  (req as any).user = { id: m[2] }; (req as any).authMethod = m[1] === 'key' ? 'api_key' : 'session';
  next();
};
const noLimit: RequestHandler = (_req, _res, next) => next();

before(async () => {
  const router = createProjectServerRouter({
    ...realDeps,
    requireAuth: fakeAuth, rateLimit: noLimit,
    isAdminUser: async (id) => id === ADMIN,
    getUserTier: async () => 'pro',
    assertProjectRole: async () => undefined,
    quotaRaw: (async () => ({ ok: true, usage_owner: {}, usage_project: {}, limits: {} })) as any,
    usageRaw: (async (...a: unknown[]) => { log('usageRaw')(...a); return { period_start: 'a', period_end: 'b' }; }) as any,
    claimStops: (async (...a: unknown[]) => { log('claimStops')(...a); return []; }) as any,
    setKillSwitch: (async (...a: unknown[]) => { log('setKillSwitch')(...a); }) as any,
    setOwnerControls: (async (...a: unknown[]) => { log('setOwnerControls')(...a); }) as any,
    reapServers: (async (...a: unknown[]) => { log('reapServers')(...a); return { claimed: 0, stopped: 0, reasons: {}, usageRecorded: 0 }; }) as any,
    stopServer: (async (...a: unknown[]) => { log('stopServer')(...a); return 1; }) as any,
    stopClaimed: async () => true,
    hitsSummary: (async () => ({ total: 0, browser: 0, bot: 0, other: 0, top: [] })) as any,
    db: { from: () => { const q: any = { select: () => q, eq: () => q, neq: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: null }), then: (r: any) => r({ data: [] }) }; return q; } } as any,
    cronSecret: () => 'cron-secret-value',
  });
  const app = express(); app.use(express.json()); app.use(router);
  server = http.createServer(app); await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server?.close(); });

const call = async (method: string, path: string, auth?: string, body?: unknown) => {
  calls.length = 0;
  const res = await fetch(base + path, { method, headers: { ...(auth ? { authorization: auth } : {}), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
};
const ADMIN_ROUTES: [string, string, unknown?][] = [
  ['GET', '/api/admin/project-servers'],
  ['POST', '/api/admin/project-servers/kill-switch', { engaged: true }],
  ['POST', `/api/admin/project-servers/owners/${VICTIM}`, { suspended: true }],
  ['POST', `/api/admin/project-servers/${VICTIM}/stop`, {}],
  ['GET', '/api/admin/project-servers/anything-new-added-later'],
];
const MUTATIONS = ['setKillSwitch', 'setOwnerControls', 'reapServers', 'stopServer', 'claimStops'];

test('admin routes reject missing, invalid, non-admin and API-key callers before any handler runs', async () => {
  for (const [m, path, body] of ADMIN_ROUTES) {
    for (const auth of [undefined, 'Bearer nonsense', `Bearer session:${USER}`, `Bearer key:${ADMIN}`]) {
      const r = await call(m, path, auth, body);
      assert.ok(r.status === 401 || r.status === 403, `${m} ${path} ${auth} -> ${r.status}`);
      assert.equal(calls.filter((c) => MUTATIONS.includes(c.fn)).length, 0, `${m} ${path} ${auth} reached a handler`);
    }
  }
});

test('client-supplied admin ids are ignored: a non-admin cannot borrow one, and an admin is recorded by their own session', async () => {
  const forged = { engaged: true, adminId: ADMIN, admin: ADMIN, userId: ADMIN, user_id: ADMIN, updated_by: ADMIN };
  const bad = await call('POST', '/api/admin/project-servers/kill-switch', `Bearer session:${USER}`, forged);
  assert.equal(bad.status, 403); assert.equal(calls.length, 0);
  const viaQuery = await call('POST', `/api/admin/project-servers/kill-switch?adminId=${ADMIN}&user=${ADMIN}`, `Bearer session:${USER}`, forged);
  assert.equal(viaQuery.status, 403);
  const withHeaders = await fetch(base + '/api/admin/project-servers/kill-switch', { method: 'POST', headers: { authorization: `Bearer session:${USER}`, 'x-admin-id': ADMIN, 'x-user-id': ADMIN, 'content-type': 'application/json' }, body: JSON.stringify(forged) });
  assert.equal(withHeaders.status, 403);
  const ok = await call('POST', '/api/admin/project-servers/kill-switch', `Bearer session:${ADMIN}`, { engaged: true, adminId: VICTIM, admin: VICTIM });
  assert.equal(ok.status, 200);
  assert.equal(calls.find((c) => c.fn === 'setKillSwitch')!.args[2], ADMIN); // the id passed on is the authenticated one, not the body's
  const owners = await call('POST', `/api/admin/project-servers/owners/${VICTIM}`, `Bearer session:${ADMIN}`, { suspended: true, adminId: VICTIM });
  assert.equal(owners.status, 200);
  assert.deepEqual(calls.find((c) => c.fn === 'setOwnerControls')!.args, [VICTIM, true, null, null, ADMIN]);
});

test('admin input is validated and the guard fails closed when the admin lookup breaks', async () => {
  assert.equal((await call('POST', '/api/admin/project-servers/owners/not-a-uuid', `Bearer session:${ADMIN}`, { suspended: true })).status, 400);
  assert.equal((await call('POST', `/api/admin/project-servers/owners/${VICTIM}`, `Bearer session:${ADMIN}`, { allowanceMultiplier: 99 })).status, 400);
  assert.equal((await call('POST', '/api/admin/project-servers/not-a-uuid/stop', `Bearer session:${ADMIN}`, {})).status, 400);
  const broken = express(); broken.use(express.json());
  broken.use(createProjectServerRouter({ ...realDeps, requireAuth: fakeAuth, rateLimit: noLimit, isAdminUser: async () => { throw new Error('db down'); }, setKillSwitch: (async () => { throw new Error('must not run'); }) as any }));
  const s2 = http.createServer(broken); await new Promise<void>((r) => s2.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${(s2.address() as AddressInfo).port}/api/admin/project-servers/kill-switch`, { method: 'POST', headers: { authorization: `Bearer session:${ADMIN}`, 'content-type': 'application/json' }, body: '{"engaged":true}' });
    assert.equal(res.status, 403);
  } finally { s2.close(); }
});

test('cron endpoint requires the exact bearer secret (constant-time) and is closed when no secret is configured', async () => {
  assert.equal((await call('GET', '/api/internal/cron/project-servers-reap')).status, 401);
  assert.equal((await call('GET', '/api/internal/cron/project-servers-reap', 'Bearer wrong')).status, 401);
  assert.equal((await call('GET', '/api/internal/cron/project-servers-reap', `Bearer session:${ADMIN}`)).status, 401);
  assert.equal(calls.filter((c) => c.fn === 'reapServers').length, 0);
  const good = await call('GET', '/api/internal/cron/project-servers-reap', 'Bearer cron-secret-value');
  assert.equal(good.status, 200); assert.equal(calls.filter((c) => c.fn === 'reapServers').length, 1);
  assert.equal(bearerMatches('Bearer x', undefined), false); assert.equal(bearerMatches('Bearer ', ''), false); assert.equal(bearerMatches(undefined, 's'), false);
  assert.equal(bearerMatches('Bearer s', 's'), true);
});

test('usage endpoint: month parameter is validated and never reads another user\'s data', async () => {
  for (const bad of ['2026-13', '2026-1', 'abc', '2099-01', '2023-12', '2026-10-01']) assert.equal((await call('GET', `/api/project-servers/usage?month=${encodeURIComponent(bad)}`, `Bearer session:${USER}`)).status, 400, bad);
  assert.equal(parseMonth('2026-10', new Date('2026-11-02T00:00:00Z')), '2026-10-01T00:00:00.000Z');
  assert.equal(parseMonth('2026-11', new Date('2026-11-02T00:00:00Z')), '2026-11-01T00:00:00.000Z');
  const ok = await call('GET', '/api/project-servers/usage?month=2026-10&owner=' + VICTIM + '&ownerId=' + VICTIM, `Bearer session:${USER}`);
  assert.equal(ok.status, 200);
  assert.equal(calls.find((c) => c.fn === 'usageRaw')!.args[0], USER);
  assert.equal(ok.json.usage.measured.attribution.includes('add up'), true);
});
