// Integration tests for migration 047 against a REAL temporary PostgreSQL 16 cluster (skipped when Postgres
// binaries are not installed). They exercise the atomic lifecycle/quota/usage functions, including concurrency.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, chownSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test, before, after } from 'node:test';
import crypto from 'node:crypto';

const run = promisify(execFile);
const BIN = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/lib/postgresql/17/bin', '/usr/local/pgsql/bin'].find((d) => existsSync(path.join(d, 'initdb')));
const available = !!BIN;
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const PORT = 54000 + Math.floor(Math.random() * 900);
let dir = '';
const wrap = (cmd: string, args: string[]): [string, string[]] => (asRoot ? ['runuser', ['-u', 'postgres', '--', cmd, ...args]] : [cmd, args]);
const psqlArgs = (sql: string) => ['-h', dir, '-p', String(PORT), '-U', 'postgres', '-d', 'kx', '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', sql];
const q = (sql: string) => execFileSync('psql', psqlArgs(sql), { encoding: 'utf8' }).trim();
const qa = async (sql: string) => (await run('psql', psqlArgs(sql), { encoding: 'utf8' })).stdout.trim();
const qErr = (sql: string): string => { try { execFileSync('psql', psqlArgs(sql), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return ''; } catch (e: any) { return String(e.stderr || e.message); } };
const MS = "(date_trunc('month', now() at time zone 'UTC') at time zone 'UTC' + interval '1 second')";
const uid = () => crypto.randomUUID();
const J = (s: string) => JSON.parse(s);

function newProject(owner = uid(), enabled = true) {
  const id = uid();
  q(`insert into public.projects (id, user_id) values ('${id}', '${owner}')`);
  if (enabled) q(`insert into public.project_server_settings (project_id, enabled) values ('${id}', true)`);
  return { id, owner };
}
const begin = (p: { id: string; owner: string }, holder = 'h1', tier = 'pro', lease = 150) =>
  J(q(`select public.ps_begin_start('${p.id}','${p.owner}','${tier}','${holder}',${lease}, 1000, 600)::text`));
const beginA = async (p: { id: string; owner: string }, holder: string, tier = 'pro') =>
  J(await qa(`select public.ps_begin_start('${p.id}','${p.owner}','${tier}','${holder}',150, 1000, 600)::text`));
const ready = (p: { id: string }, gen: number, session = `sbx_${uid()}`) =>
  q(`select public.ps_mark_ready('${p.id}', ${gen}, '${session}', 1, 2048, now())`) === 't' ? session : null;
const state = (p: { id: string }) => q(`select state from public.project_server_runtime where project_id='${p.id}'`);
const startReady = (p: { id: string; owner: string }, tier = 'pro') => { const r = begin(p, 'h', tier); assert.equal(r.action, 'start'); return ready(p, r.generation)!; };
const claim = (extra = '') => q(`select coalesce(json_agg(json_build_object('p', project_id, 'g', generation, 'r', reason)), '[]'::json)::text from public.ps_claim_stops('reaper', 600, 50, 120${extra})`);

before(() => {
  if (!available) return;
  dir = mkdtempSync(path.join(tmpdir(), 'kxpg-'));
  if (asRoot) chownSync(dir, Number(execFileSync('id', ['-u', 'postgres'], { encoding: 'utf8' }).trim()), -1);
  const run1 = (cmd: string, args: string[]) => { const [c, a] = wrap(cmd, args); execFileSync(c, a, { stdio: 'ignore' }); };
  run1(path.join(BIN!, 'initdb'), ['-D', path.join(dir, 'data'), '-A', 'trust']);
  run1(path.join(BIN!, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-o', `-p ${PORT} -k ${dir} -c listen_addresses=''`, '-l', path.join(dir, 'log'), '-w', 'start']);
  execFileSync('psql', ['-h', dir, '-p', String(PORT), '-U', 'postgres', '-qc', 'create database kx']);
  for (const f of ['test/sql/project_server_fixture.sql', '../supabase/migrations/047_project_server.sql']) {
    execFileSync('psql', ['-h', dir, '-p', String(PORT), '-U', 'postgres', '-d', 'kx', '-v', 'ON_ERROR_STOP=1', '-q', '-f', new URL(`../${f}`, import.meta.url).pathname], { stdio: 'ignore' });
  }
});
after(() => {
  if (!available || !dir) return;
  try { const [c, a] = wrap(path.join(BIN!, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop']); execFileSync(c, a, { stdio: 'ignore' }); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});
const t = (name: string, fn: () => void | Promise<void>) => test(name, { skip: !available && 'PostgreSQL binaries not installed' }, fn);

t('migration is idempotent and exposes nothing to anon/authenticated', () => {
  execFileSync('psql', ['-h', dir, '-p', String(PORT), '-U', 'postgres', '-d', 'kx', '-q', '-f', new URL('../../supabase/migrations/047_project_server.sql', import.meta.url).pathname], { stdio: 'ignore' });
  for (const role of ['anon', 'authenticated']) {
    assert.match(qErr(`set role ${role}; select * from public.project_server_runtime`), /permission denied/);
    assert.match(qErr(`set role ${role}; select public.ps_usage('${uid()}')`), /permission denied/);
    assert.match(qErr(`set role ${role}; select public.ps_begin_start('${uid()}','${uid()}','pro','x')`), /permission denied/);
    assert.match(qErr(`set role ${role}; select public.ps_admin_set_kill_switch(true,'x','${uid()}')`), /permission denied/);
  }
  assert.equal(q(`select count(*) from pg_tables where schemaname='public' and tablename like 'project_server_%' and not rowsecurity`), '0');
  assert.equal(qErr(`set role service_role; select public.ps_usage('${uid()}')`), '');
});

t('basic lifecycle: disabled, start, wait, stale generation, ready', () => {
  const off = newProject(uid(), false);
  assert.equal(begin(off).reason, 'disabled');
  const p = newProject();
  const a = begin(p, 'A');
  assert.equal(a.action, 'start');
  assert.equal(begin(p, 'B').action, 'wait');
  assert.equal(q(`select public.ps_mark_ready('${p.id}', ${a.generation + 5}, 'sbx_stale', 1, 2048, now())`), 'f');
  assert.equal(state(p), 'STARTING');
  assert.ok(ready(p, a.generation));
  assert.equal(state(p), 'READY');
  assert.equal(begin(p, 'C').action, 'ready');
});

t('free tier and spoofed plan names get no access (fails closed)', () => {
  const p = newProject();
  for (const tier of ['free', 'enterprise', 'PRO', '', 'pro; drop table x']) assert.equal(begin(p, 'h', tier).reason, 'no_plan', tier);
  assert.ok(['', 'STOPPED'].includes(state(p)));
});

t('duplicate provisioning: 12 simultaneous requests produce exactly one start', async () => {
  const p = newProject();
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => beginA(p, `w${i}`)));
  assert.equal(results.filter((r) => r.action === 'start').length, 1);
  assert.equal(results.filter((r) => r.action === 'wait').length, 11);
  assert.equal(q(`select generation from public.project_server_runtime where project_id='${p.id}'`), '1');
});

t('owner running cap holds under concurrent starts across projects', async () => {
  const owner = uid();
  const ps = Array.from({ length: 6 }, () => newProject(owner));
  const results = await Promise.all(ps.map((p, i) => beginA(p, `w${i}`)));
  assert.equal(results.filter((r) => r.action === 'start').length, 2); // pro: max_running_per_owner = 2
  assert.equal(results.filter((r) => r.reason === 'owner_concurrency').length, 4);
});

t('global start cap protects the platform from stampedes', () => {
  const n = Number(q(`select count(*) from public.project_server_runtime where state='STARTING' and lease_expires_at > now()`));
  const p = newProject();
  const r = J(q(`select public.ps_begin_start('${p.id}','${p.owner}','pro','h',150, ${n}, 600)::text`));
  assert.equal(r.reason, 'busy');
  assert.equal(begin(p).action, 'start');
});

t('quota bypass attempts: project cap, owner cap, multiplier, retries', () => {
  const owner = uid();
  const p1 = newProject(owner); const p2 = newProject(owner);
  // 25h used on p1 (measured), project cap is 25h for pro (90000 s)
  q(`insert into public.project_server_sessions (session_id, project_id, owner_id, started_at, stopped_at, wall_ms, active_cpu_ms, egress_bytes, ingress_bytes, basis, finalized_at)
     values ('sbx_big1','${p1.id}','${owner}', ${MS}, ${MS} + interval '1 second', 90000000, 1000, 10, 10, 'measured', now())`);
  assert.equal(begin(p1).reason, 'quota_project_hours');
  assert.equal(begin(p1).reason, 'quota_project_hours'); // retrying changes nothing
  assert.equal(begin(p2).action, 'start'); // other project of the same owner still has room
  // owner total cap (180000 s): add a second big session on p2
  q(`insert into public.project_server_sessions (session_id, project_id, owner_id, started_at, stopped_at, wall_ms, active_cpu_ms, egress_bytes, ingress_bytes, basis, finalized_at)
     values ('sbx_big2','${p2.id}','${owner}', ${MS}, ${MS} + interval '1 second', 90000000, 1000, 10, 10, 'measured', now())`);
  const p3 = newProject(owner);
  assert.equal(begin(p3).reason, 'quota_owner_hours');
  // admin multiplier raises the allowance; zero removes it; out-of-range is rejected by the database
  q(`select public.ps_admin_set_owner('${owner}', false, 'test', 2, '${uid()}')`);
  assert.equal(begin(p3, 'h', 'pro').action, 'start');
  q(`select public.ps_admin_set_owner('${owner}', false, 'test', 0, '${uid()}')`);
  assert.equal(begin(newProject(owner)).reason, 'quota_owner_hours');
  assert.match(qErr(`select public.ps_admin_set_owner('${owner}', false, 'x', 99, '${uid()}')`), /violates check constraint/);
});

t('cpu and egress allowances are enforced from measured numbers only', () => {
  const owner = uid(); const p = newProject(owner);
  q(`insert into public.project_server_sessions (session_id, project_id, owner_id, started_at, stopped_at, wall_ms, active_cpu_ms, egress_bytes, ingress_bytes, basis, finalized_at)
     values ('sbx_cpu_${uid()}','${p.id}','${owner}', ${MS}, ${MS} + interval '1 second', 1000, 36000000, 0, 0, 'measured', now())`);
  assert.equal(begin(p).reason, 'quota_cpu');
  const o2 = uid(); const p2 = newProject(o2);
  q(`insert into public.project_server_sessions (session_id, project_id, owner_id, started_at, stopped_at, wall_ms, active_cpu_ms, egress_bytes, ingress_bytes, basis, finalized_at)
     values ('sbx_eg_${uid()}','${p2.id}','${o2}', ${MS}, ${MS} + interval '1 second', 1000, 1, 21474836480, 0, 'measured', now())`);
  assert.equal(begin(p2).reason, 'quota_egress');
});

t('suspended accounts cannot start, and running servers are claimed for shutdown', () => {
  const p = newProject(); startReady(p);
  q(`insert into public.account_status (user_id, suspended) values ('${p.owner}', true)`);
  assert.equal(begin(p, 'x').reason, 'account_suspended');
  const c = J(claim(`, null, '${p.owner}'`));
  assert.equal(c.length, 1); assert.equal(c[0].r, 'account_suspended'); assert.equal(state(p), 'STOPPING');
  const o = newProject(); startReady(o);
  q(`select public.ps_admin_set_owner('${o.owner}', true, 'abuse', null, '${uid()}')`);
  assert.equal(begin(o, 'x').reason, 'owner_suspended');
  assert.equal(J(claim(`, null, '${o.owner}'`))[0].r, 'owner_suspended');
});

t('platform kill switch blocks every start and sweeps running servers', () => {
  const a = newProject(); startReady(a);
  q(`select public.ps_admin_set_kill_switch(true, 'incident', '${uid()}')`);
  assert.equal(begin(newProject()).reason, 'platform_stopped');
  const c = J(claim()); assert.ok(c.some((x: any) => x.p === a.id && x.r === 'platform_stopped'));
  q(`select public.ps_admin_set_kill_switch(false, 'over', '${uid()}')`);
  assert.equal(begin(newProject()).action, 'start');
});

t('failed startup: backoff grows, stale reports ignored, recovery works', () => {
  const p = newProject(); const a = begin(p, 'A');
  assert.equal(q(`select public.ps_mark_failed('${p.id}', ${a.generation + 1}, 'stale')`), 'f');
  assert.equal(q(`select public.ps_mark_failed('${p.id}', ${a.generation}, 'npm install failed')`), 't');
  assert.equal(state(p), 'FAILED');
  const d1 = begin(p, 'B'); assert.equal(d1.reason, 'backoff'); assert.ok(d1.retry_after > 0 && d1.retry_after <= 10);
  q(`update public.project_server_runtime set next_attempt_at = now() - interval '1 second' where project_id='${p.id}'`);
  const b = begin(p, 'B'); assert.equal(b.action, 'start'); assert.equal(b.generation, a.generation + 1);
  q(`select public.ps_mark_failed('${p.id}', ${b.generation}, 'again')`);
  const d2 = begin(p, 'C'); assert.ok(d2.retry_after > 10 && d2.retry_after <= 20, `retry_after ${d2.retry_after}`);
  assert.equal(q(`select fail_count from public.project_server_runtime where project_id='${p.id}'`), '2');
  q(`update public.project_server_runtime set next_attempt_at = null where project_id='${p.id}'`);
  const c = begin(p, 'D'); assert.ok(ready(p, c.generation));
  assert.equal(q(`select fail_count from public.project_server_runtime where project_id='${p.id}'`), '0');
});

t('interrupted start: another worker takes over, the dead worker cannot publish', () => {
  const p = newProject(); const a = begin(p, 'dead');
  q(`update public.project_server_runtime set lease_expires_at = now() - interval '1 second' where project_id='${p.id}'`);
  const reaped = J(claim(`, '${p.id}'`)); // lease expired -> reaper cleans debris first
  assert.equal(reaped[0].r, 'interrupted_starting');
  assert.equal(q(`select public.ps_mark_ready('${p.id}', ${a.generation}, 'sbx_dead', 1, 2048, now())`), 'f');
  assert.equal(q(`select public.ps_mark_stopped('${p.id}', ${reaped[0].g})`), 't');
  const b = begin(p, 'alive'); assert.equal(b.action, 'start');
  assert.ok(b.generation > a.generation);
});

t('reaper race: two simultaneous sweeps never claim the same server', async () => {
  const ps = Array.from({ length: 8 }, () => newProject());
  for (const p of ps) { startReady(p, 'pro_plus'); }
  q(`update public.project_server_runtime set last_request_at = now() - interval '1 hour' where project_id in (${ps.map((p) => `'${p.id}'`).join(',')})`);
  const sql = `select coalesce(json_agg(project_id), '[]'::json)::text from public.ps_claim_stops('r', 600, 3, 120, null, null, false)`;
  const [r1, r2, r3] = (await Promise.all([qa(sql), qa(sql), qa(sql)])).map(J) as string[][];
  const all = [...r1, ...r2, ...r3];
  assert.equal(new Set(all).size, all.length, 'no project claimed twice');
  const mine = all.filter((id) => ps.some((p) => p.id === id));
  assert.ok(mine.length >= 1 && mine.length <= 8);
  // wrong generation cannot mark stopped; right one can; a later start is then allowed
  const p = ps.find((x) => state(x) === 'STOPPING')!;
  assert.equal(q(`select public.ps_mark_stopped('${p.id}', 999)`), 'f');
  const gen = Number(q(`select generation from public.project_server_runtime where project_id='${p.id}'`));
  assert.equal(q(`select public.ps_mark_stopped('${p.id}', ${gen})`), 't');
  assert.equal(state(p), 'STOPPED');
  assert.equal(begin(p, 'again', 'pro_plus').action, 'start');
});

t('idle and expired servers are reaped; active ones are not; a request mid-claim keeps state consistent', () => {
  const idle = newProject(); startReady(idle); const live = newProject(); startReady(live);
  q(`update public.project_server_runtime set last_request_at = now() - interval '11 minutes' where project_id='${idle.id}'`);
  q(`update public.project_server_runtime set last_request_at = now() - interval '1 minute' where project_id='${live.id}'`);
  const c = J(claim());
  assert.ok(c.some((x: any) => x.p === idle.id && x.r === 'idle'));
  assert.ok(!c.some((x: any) => x.p === live.id));
  // a request arriving while shutdown is in progress waits instead of starting a second sandbox
  assert.equal(begin(idle, 'late').action, 'wait');
  q(`select public.ps_touch('${live.id}')`); assert.equal(state(live), 'READY');
});

t('interrupted shutdown is recoverable and a failed stop retries soon', () => {
  const p = newProject(); startReady(p);
  const c = J(claim(`, '${p.id}', null, true`)); assert.equal(c[0].r, 'forced');
  q(`select public.ps_stop_failed('${p.id}', ${c[0].g}, 'api error')`);
  assert.equal(state(p), 'STOPPING');
  q(`update public.project_server_runtime set lease_expires_at = now() - interval '1 second' where project_id='${p.id}'`);
  const again = J(claim(`, '${p.id}'`)); assert.equal(again[0].r, 'interrupted_stopping');
  assert.equal(q(`select public.ps_mark_stopped('${p.id}', ${c[0].g})`), 'f'); // old claimant is stale
  assert.equal(q(`select public.ps_mark_stopped('${p.id}', ${again[0].g})`), 't');
});

t('usage accounting: estimates, measured replacement, idempotency, separation of metrics', () => {
  const owner = uid(); const p = newProject(owner);
  const s = startReady(p);
  q(`update public.project_server_sessions set started_at = now() - interval '30 minutes' where session_id='${s}'`);
  let u = J(q(`select public.ps_usage('${owner}')::text`));
  assert.equal(u.unmeasured_sessions, 1);
  assert.ok(u.wall_ms_estimated >= 29 * 60 * 1000 && u.wall_ms_measured === 0);
  assert.equal(u.active_cpu_ms_measured, 0); assert.equal(u.egress_bytes_measured, 0); // never invented while running
  // stop, then the platform reports measured numbers
  const c = J(claim(`, '${p.id}', null, true`)); q(`select public.ps_mark_stopped('${p.id}', ${c[0].g})`);
  const rec = `select public.ps_record_session_usage('${s}','${p.id}','${owner}', now() - interval '30 minutes', now(), 1500000, 42000, 5000, 7000, 1, 2048)`;
  assert.equal(q(rec), 't');
  assert.equal(q(rec), 'f'); assert.equal(q(rec), 'f'); // retries: no change
  u = J(q(`select public.ps_usage('${owner}')::text`));
  assert.equal(u.wall_ms_measured, 1500000); assert.equal(u.wall_ms_estimated, 0);
  assert.equal(u.active_cpu_ms_measured, 42000); assert.equal(u.egress_bytes_measured, 5000); assert.equal(u.ingress_bytes_measured, 7000);
  assert.equal(u.unmeasured_sessions, 0); assert.equal(u.sessions, 1);
  assert.equal(q(`select count(*) from public.project_server_events where kind='usage_measured' and detail->>'session_id'='${s}'`), '1');
  // a conflicting later report cannot rewrite the measured row, nor can another owner claim the session
  assert.equal(q(`select public.ps_record_session_usage('${s}','${p.id}','${owner}', now(), now(), 9, 9, 9, 9, 1, 2048)`), 'f');
  assert.equal(J(q(`select public.ps_usage('${owner}')::text`)).wall_ms_measured, 1500000);
  assert.equal(q(`select public.ps_record_session_usage('${s}','${p.id}','${uid()}', now(), now(), 9, 9, 9, 9, 1, 2048)`), 'f');
});

t('usage accounting rejects bad data and scopes by month, owner and project', () => {
  const owner = uid(); const p = newProject(owner); const other = newProject();
  assert.equal(q(`select public.ps_record_session_usage('sbx_neg','${p.id}','${owner}', now(), now(), -1, 1, 1, 1, 1, 2048)`), 'f');
  assert.equal(q(`select public.ps_record_session_usage('sbx_null','${p.id}','${owner}', now(), now(), null, 1, 1, 1, 1, 2048)`), 'f');
  assert.equal(q(`select count(*) from public.project_server_sessions where session_id in ('sbx_neg','sbx_null')`), '0');
  q(`select public.ps_record_session_usage('sbx_old_${p.id}','${p.id}','${owner}', now() - interval '40 days', now() - interval '40 days' + interval '1 hour', 3600000, 1, 1, 1, 1, 2048)`);
  q(`select public.ps_record_session_usage('sbx_now_${p.id}','${p.id}','${owner}', ${MS}, ${MS} + interval '1 second', 3000000, 1, 1, 1, 1, 2048)`);
  q(`select public.ps_record_session_usage('sbx_oth_${other.id}','${other.id}','${other.owner}', ${MS}, ${MS} + interval '1 second', 7000000, 1, 1, 1, 1, 2048)`);
  const u = J(q(`select public.ps_usage('${owner}')::text`));
  assert.equal(u.wall_ms_measured, 3000000); // last month and other owners excluded
  assert.equal(J(q(`select public.ps_usage('${owner}', '${other.id}')::text`)).sessions, 0);
});

t('hard stop: a running server that reaches its allowance is claimed for shutdown', () => {
  q(`update public.project_server_plan_limits set project_wall_seconds = 1 where tier = 'pro_plus'`);
  try {
    const p = newProject(); startReady(p, 'pro_plus');
    q(`update public.project_server_sessions set started_at = now() - interval '1 hour' where project_id = '${p.id}'`);
    const c = J(claim(`, '${p.id}'`));
    assert.equal(c[0].r, 'quota_project_hours'); assert.equal(state(p), 'STOPPING');
  } finally { q(`update public.project_server_plan_limits set project_wall_seconds = 270000 where tier = 'pro_plus'`); }
});

t('a session running across the month boundary is still counted against the new month', () => {
  const owner = uid(); const p = newProject(owner);
  q(`insert into public.project_server_sessions (session_id, project_id, owner_id, started_at, basis)
     values ('sbx_span_${p.id}','${p.id}','${owner}', date_trunc('month', now() at time zone 'UTC') at time zone 'UTC' - interval '10 days', 'estimated')`);
  const u = J(q(`select public.ps_usage('${owner}')::text`));
  const expected = Number(q(`select (extract(epoch from (now() - (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'))) * 1000)::bigint`));
  assert.ok(Math.abs(u.wall_ms_total - expected) < 5000, `${u.wall_ms_total} vs ${expected}`);
});

t('unmeasured sessions are listed for reconciliation only after they stopped', () => {
  const owner = uid(); const p = newProject(owner); const s = startReady(p);
  assert.equal(q(`select count(*) from public.ps_unmeasured_sessions(100) where session_id='${s}'`), '0'); // still running
  q(`update public.project_server_sessions set stopped_at = now() - interval '5 minutes' where session_id='${s}'`);
  assert.equal(q(`select count(*) from public.ps_unmeasured_sessions(100) where session_id='${s}'`), '1');
});

t('audit trail records decisions', () => {
  const p = newProject(); begin(p, 'x'); const kinds = q(`select string_agg(kind, ',' order by id) from public.project_server_events where project_id='${p.id}'`);
  assert.match(kinds, /start_begin/);
  assert.ok(readFileSync(new URL('../../supabase/migrations/047_project_server.sql', import.meta.url), 'utf8').includes('ps_event'));
});

t('enabling servers is capped per plan, atomically, and only for the real owner', async () => {
  const owner = uid();
  const ps = Array.from({ length: 6 }, () => newProject(owner, false));
  const en = (p: { id: string }, tier = 'pro', on = true) => `select public.ps_set_enabled('${p.id}','${owner}','${tier}',${on})::text`;
  const results = (await Promise.all(ps.map((p) => qa(en(p))))).map(J);
  assert.equal(results.filter((r) => r.ok).length, 3); // pro: max_enabled_projects = 3
  assert.equal(results.filter((r) => r.reason === 'enabled_cap').length, 3);
  const off = ps.find((p) => q(`select enabled from public.project_server_settings where project_id='${p.id}'`) === 't')!;
  assert.equal(J(q(en(off, 'pro', false))).ok, true);
  assert.equal(J(q(en(ps.find((p) => p !== off && q(`select count(*) from public.project_server_settings where project_id='${p.id}' and enabled`) === '0')!))).ok, true);
  assert.equal(J(q(`select public.ps_set_enabled('${ps[0].id}','${uid()}','pro',true)::text`)).reason, 'not_owner');
  assert.equal(J(q(en(ps[0], 'free'))).reason, 'no_plan');
  assert.equal(J(q(en(off, 'free', false))).ok, true); // turning OFF always works, even after a downgrade
});
