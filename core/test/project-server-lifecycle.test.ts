import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
// The module pulls in the Supabase client, which validates env at import. Dummy values: no network call is ever made here.
for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) process.env[k] ??= 'test-placeholder';
process.env.SUPABASE_URL ??= 'http://127.0.0.1:9';
const { denialResponse, measuredRecord, buildUsageView, HARD_STOP_REASONS } = require('../src/services/projectServerLifecycle') as typeof import('../src/services/projectServerLifecycle');

test('every denial reason maps to a status and a message that leaks no internals', () => {
  for (const r of ['no_plan', 'disabled', 'not_owner', 'quota_owner_hours', 'quota_project_hours', 'quota_cpu', 'quota_egress', 'owner_concurrency', 'enabled_cap', 'backoff', 'busy', 'owner_suspended', 'account_suspended', 'platform_stopped', 'something_new']) {
    const d = denialResponse(r, 7);
    assert.ok(d.status >= 400 && d.status < 600, r);
    assert.ok(!/postgres|sql|lease|generation|sandbox/i.test(d.message), `${r}: ${d.message}`);
  }
  assert.equal(denialResponse('quota_cpu').status, 429);
  assert.equal(denialResponse('account_suspended').status, 503);
  assert.equal(denialResponse('backoff', 12).retryAfter, 12);
  assert.equal(denialResponse('suspended-by-anything-else').status, 503); // unknown reasons fail closed
  for (const r of ['quota_owner_hours', 'account_suspended', 'platform_stopped']) assert.ok(HARD_STOP_REASONS.has(r));
});

const base = { id: 'sbx_1', status: 'stopped', startedAt: 1000, stoppedAt: 61000, duration: 60000, activeCpuDurationMs: 1234, networkTransfer: { ingress: 5, egress: 9 }, vcpus: 1, memory: 2048 };
test('only fully reported, stopped sessions become measured records', () => {
  const r = measuredRecord(base)!;
  assert.deepEqual([r.wallMs, r.activeCpuMs, r.egressBytes, r.ingressBytes, r.vcpus, r.memoryMb], [60000, 1234, 9, 5, 1, 2048]);
  assert.equal(measuredRecord({ ...base, status: 'running' }), null);
  assert.equal(measuredRecord({ ...base, activeCpuDurationMs: undefined }), null); // CPU is reported after stop: until then it stays an estimate
  assert.equal(measuredRecord({ ...base, duration: undefined }), null);
  assert.equal(measuredRecord({ ...base, duration: -1 }), null);
  assert.equal(measuredRecord({ ...base, stoppedAt: undefined }), null);
  assert.equal(measuredRecord({ ...base, networkTransfer: undefined })!.egressBytes, 0);
});

test('usage view keeps measured, estimated and allocated separate and invents nothing', () => {
  const v = buildUsageView({
    ok: true, reason: null,
    usage_owner: { period_start: '2026-11-01T00:00:00Z', wall_ms_measured: 100, wall_ms_estimated: 50, wall_ms_total: 150, active_cpu_ms_measured: 20, egress_bytes_measured: 7, ingress_bytes_measured: 3, unmeasured_sessions: 1 },
    usage_project: { wall_ms_total: 80 }, limits: { owner_wall_ms: 1000, project_wall_ms: 500, active_cpu_ms: 100, egress_bytes: 70, max_running: 2 },
  }, { vcpus: 1, memoryMb: 2048 });
  assert.equal(v.measured.wallMs, 100); assert.equal(v.estimated.wallMs, 50); assert.equal(v.estimated.sessionsAwaitingMeasurement, 1);
  assert.equal(v.allowance.ownerWallMs.remaining, 850); assert.equal(v.allowance.activeCpuMs.remaining, 80);
  assert.match(v.allocated.note, /not actual consumption/i);
  assert.ok(!('memoryUsed' in v.allocated) && !('memoryMbUsed' in v.measured));
  assert.match(v.cost, /not shown/i); // no invented per-project dollar figure
  assert.equal(buildUsageView({ ok: false, reason: 'quota_cpu' }).blockedReason, 'quota_cpu');
});

test('no authoritative state lives in process memory, and usage never multiplies allocated memory', () => {
  const server = fs.readFileSync(require('node:path').join(__dirname, '../src/services/projectServer.ts'), 'utf8');
  assert.ok(!/MAX_STARTS_IN_FLIGHT|startsInFlight/.test(server));
  assert.ok(/beginStart\(/.test(server) && /markReady\(/.test(server) && /markFailed\(/.test(server));
  const life = fs.readFileSync(require('node:path').join(__dirname, '../src/services/projectServerLifecycle.ts'), 'utf8');
  assert.ok(!/memory\s*\*|\*\s*memory|memoryMb\s*\*/.test(life.replace(/\/\*[\s\S]*?\*\//g, '')));
});

test('hard stop paths exist: reaper, admin and cron all use database claims', () => {
  const routes = fs.readFileSync(require('node:path').join(__dirname, '../src/services/projectServerRoutes.ts'), 'utf8');
  for (const needle of ['/api/internal/cron/project-servers-reap', '/api/admin/project-servers/kill-switch', '/api/admin/project-servers/owners/:ownerId', 'isAdminUser', 'CRON_SECRET']) assert.ok(routes.includes(needle), needle);
  const server = fs.readFileSync(require('node:path').join(__dirname, '../src/services/projectServer.ts'), 'utf8');
  assert.ok(/ps_set_enabled/.test(server));
  assert.ok(/stopClaimed/.test(server) && /reapServers/.test(server));
});
