import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
// These modules pull in the Supabase client, which validates env at import. Dummy values: no network call is made.
for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) process.env[k] ??= 'test-placeholder';
process.env.SUPABASE_URL ??= 'http://127.0.0.1:9';
const { normalizeHitPath, classifyAgent } = require('../src/services/projectServerHits') as typeof import('../src/services/projectServerHits');
const { buildServerOverview, denialResponse } = require('../src/services/projectServerLifecycle') as typeof import('../src/services/projectServerLifecycle');

test('hit paths collapse ids and numbers, drop queries, and stay short', () => {
  assert.equal(normalizeHitPath('/users/42?x=1'), '/users/:n');
  assert.equal(normalizeHitPath('/orders/3f2b8c1e-1111-4222-8333-444455556666/items'), '/orders/:id/items');
  assert.equal(normalizeHitPath('/a/0123456789abcdef0123'), '/a/:id');
  assert.equal(normalizeHitPath(''), '/');
  assert.ok(normalizeHitPath('/' + 'x'.repeat(500)).length <= 120);
  assert.equal(normalizeHitPath('/a/b/c/d/e/f/g/h/i/j'), '/a/b/c/d/e/f/g/h');
});

test('visitor type: browsers, bots and scripts are told apart', () => {
  assert.equal(classifyAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'), 'browser');
  assert.equal(classifyAgent('Mozilla/5.0 (compatible; Googlebot/2.1)'), 'bot');
  assert.equal(classifyAgent('UptimeRobot/2.0'), 'bot');
  assert.equal(classifyAgent('curl/8.4.0'), 'bot');
  assert.equal(classifyAgent(undefined), 'other');
});

const quota = (usedH: number, projH: number) => ({
  ok: true,
  usage_owner: { wall_ms_total: usedH * 3600_000, active_cpu_ms_measured: 0, egress_bytes_measured: 0, period_start: '2026-11-01T00:00:00Z', period_end: '2026-12-01T00:00:00Z' },
  usage_project: { wall_ms_total: projH * 3600_000 },
  limits: { owner_wall_ms: 50 * 3600_000, project_wall_ms: 25 * 3600_000, active_cpu_ms: 36_000_000, egress_bytes: 21_474_836_480, max_running: 2, multiplier: 1 },
});
const proj = (id: string, q: any) => ({ projectId: id, name: id, state: 'STOPPED', quota: q, hits: null });

test('overview: ok below 80%, warning from 80%, paused at 100%', () => {
  assert.equal(buildServerOverview('pro', quota(10, 10), [proj('a', quota(10, 10))]).status, 'ok');
  const warn = buildServerOverview('pro', quota(42, 21), [proj('a', quota(42, 21))]);
  assert.equal(warn.status, 'warning'); assert.equal(warn.meters.hours.percent, 84);
  const full = buildServerOverview('pro', quota(50, 25), [proj('a', quota(50, 25))]);
  assert.equal(full.status, 'paused'); assert.equal(full.projects[0].paused, true);
  assert.equal(full.period.resetsAt, '2026-12-01T00:00:00Z');
});

test('overview: one project at its own limit pauses only that project', () => {
  const o = buildServerOverview('pro', quota(30, 25), [proj('a', quota(30, 25)), proj('b', quota(30, 5))]);
  assert.equal(o.status, 'warning');
  assert.deepEqual(o.projects.map((p) => p.paused), [true, false]);
});

test('allowance denial carries a code so visitors get the paused page', () => {
  assert.equal(denialResponse('quota_project_hours').code, 'allowance_reached');
  assert.equal(denialResponse('quota_egress').code, 'allowance_reached');
  assert.equal(denialResponse('busy').code, undefined);
});

const sql = readFileSync(new URL('../../supabase/migrations/052_project_server_hits.sql', import.meta.url), 'utf8');
test('052: hit counter is service_role only, counts only, capped and pruned', () => {
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on function public\.ps_record_hit[^;]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.ps_hits_summary[^;]*to service_role/);
  assert.match(sql, />= 60/);
  assert.match(sql, /day < v_day - 35/);
  assert.doesNotMatch(sql, /\bip\b\s+(text|inet)/i);
});
