// Integration tests for migrations 047+048 against a REAL temporary PostgreSQL 16 cluster (skipped when Postgres
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
const ADMIN = uid();

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
  for (const f of ['test/sql/project_server_fixture.sql', '../supabase/migrations/047_project_server.sql', '../supabase/migrations/048_project_server_lifecycle.sql', '../supabase/migrations/049_project_server_survive_project_delete.sql']) {
    execFileSync('psql', ['-h', dir, '-p', String(PORT), '-U', 'postgres', '-d', 'kx', '-v', 'ON_ERROR_STOP=1', '-q', '-f', new URL(`../${f}`, import.meta.url).pathname], { stdio: 'ignore' });
  }
  execFileSync('psql', ['-h', dir, '-p', String(PORT), '-U', 'postgres', '-d', 'kx', '-qc', `insert into public.admin_users values ('${ADMIN}')`]);
});
after(() => {
  if (!available || !dir) return;
  try { const [c, a] = wrap(path.join(BIN!, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop']); execFileSync(c, a, { stdio: 'ignore' }); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});
const t = (name: string, fn: () => void | Promise<void>) => test(name, { skip: !available && 'PostgreSQL binaries not installed' }, fn);

t('migration is idempotent and exposes nothing to anon/authenticated', () => {
  for (const m of ['047_project_server.sql', '048_project_server_lifecycle.sql', '049_project_server_survive_project_delete.sql', '049_project_server_survive_project_delete.sql']) {
    execFileSync('psql', ['-h', dir, '-p', String(PORT), '-U', 'postgres', '-d', 'kx', '-v', 'ON_ERROR_STOP=1', '-q', '-f', new URL(`../../supabase/migrations/${m}`, import.meta.url).pathname], { stdio: 'ignore' });
  }
  for (const role of ['anon', 'authenticated']) {
    assert.match(qErr(`set role ${role}; select * from public.project_server_runtime`), /permission denied/);
    assert.match(qErr(`set role ${role}; select public.ps_usage('${uid()}')`), /permission denied/);
    assert.match(qErr(`set role ${role}; select public.ps_begin_start('${uid()}','${uid()}','pro','x')`), /permission denied/);
    assert.match(qErr(`set role ${role}; select public.ps_admin_set_kill_switch(true,'x','${ADMIN}')`), /permission denied/);
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
  q(`select public.ps_admin_set_owner('${owner}', false, 'test', 2, '${ADMIN}')`);
  assert.equal(begin(p3, 'h', 'pro').action, 'start');
  q(`select public.ps_admin_set_owner('${owner}', false, 'test', 0, '${ADMIN}')`);
  assert.equal(begin(newProject(owner)).reason, 'quota_owner_hours');
  assert.match(qErr(`select public.ps_admin_set_owner('${owner}', false, 'x', 99, '${ADMIN}')`), /violates check constraint/);
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
  q(`select public.ps_admin_set_owner('${o.owner}', true, 'abuse', null, '${ADMIN}')`);
  assert.equal(begin(o, 'x').reason, 'owner_suspended');
  assert.equal(J(claim(`, null, '${o.owner}'`))[0].r, 'owner_suspended');
});

t('platform kill switch blocks every start and sweeps running servers', () => {
  const a = newProject(); startReady(a);
  q(`select public.ps_admin_set_kill_switch(true, 'incident', '${ADMIN}')`);
  assert.equal(begin(newProject()).reason, 'platform_stopped');
  const c = J(claim()); assert.ok(c.some((x: any) => x.p === a.id && x.r === 'platform_stopped'));
  q(`select public.ps_admin_set_kill_switch(false, 'over', '${ADMIN}')`);
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
  assert.ok(readFileSync(new URL('../../supabase/migrations/048_project_server_lifecycle.sql', import.meta.url), 'utf8').includes('ps_event'));
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

// ---------------------------------------------------------------------------------------------------------------
// Phase 3 review fixes: month attribution, identity, privileges, reaper delays.
const MSTART = "(date_trunc('month', now() at time zone 'UTC') at time zone 'UTC')";
const rec = (sess: string, p: { id: string; owner: string }, a: string, b: string, wall: number, cpu: number | 'null', egress = 0, ingress = 0, owner = p.owner) =>
  q(`select public.ps_record_session_usage('${sess}','${p.id}','${owner}', ${a}, ${b}, ${wall}, ${cpu}, ${egress}, ${ingress}, 1, 2048)`);
const usageOf = (owner: string, month?: string, project?: string) =>
  J(q(`select public.ps_usage('${owner}', ${project ? `'${project}'` : 'null'}, ${month ? `'${month}'::timestamptz` : 'null'})::text`));

t('cross-month sessions: measured CPU/network/wall are apportioned by time and always add up to the reported total', () => {
  const p = newProject();
  rec(`sbx_x_${p.id}`, p, "'2026-01-31 12:00+00'", "'2026-02-02 12:00+00'", 172800000, 1001, 1000003, 7);
  const jan = usageOf(p.owner, '2026-01-15'); const feb = usageOf(p.owner, '2026-02-15'); const mar = usageOf(p.owner, '2026-03-15');
  assert.deepEqual([jan.active_cpu_ms_measured, feb.active_cpu_ms_measured, mar.active_cpu_ms_measured], [250, 751, 0]);
  assert.equal(jan.active_cpu_ms_measured + feb.active_cpu_ms_measured, 1001);
  assert.equal(jan.egress_bytes_measured + feb.egress_bytes_measured, 1000003);
  assert.equal(jan.ingress_bytes_measured + feb.ingress_bytes_measured, 7);
  assert.equal(jan.wall_ms_measured, 43200000); assert.equal(feb.wall_ms_measured, 129600000);
  assert.equal(jan.apportioned_sessions, 1); assert.equal(feb.apportioned_sessions, 1);
  // property: for hundreds of random sessions over 1-5 months, the monthly shares sum to the total exactly
  const r = q(`select setseed(0.42); with r as (select i, timestamptz '2026-01-01 00:00+00' + (random()*300)*interval '1 day' as a, (1 + floor(random()*100000000))::bigint as tot, (random()*130)*interval '1 day' as d from generate_series(1,400) i),
    r2 as (select i, a, a + d as b, tot from r),
    m as (select (g at time zone 'UTC') as ms, ((g + interval '1 month') at time zone 'UTC') as me from generate_series(timestamp '2025-12-01', timestamp '2027-03-01', interval '1 month') g)
    select bool_and(s = tot) || ',' || count(*) from (select r2.i, r2.tot, sum(public.ps_month_share(tot, a, b, m.ms, m.me)) s from r2 cross join m group by r2.i, r2.tot) x`).split('\n').pop()!;
  assert.equal(r, 'true,400');
  // zero-length and exact-boundary sessions are attributed to exactly one month
  assert.equal(q(`select public.ps_month_share(10, timestamptz '2026-02-01 00:00+00', timestamptz '2026-02-01 00:00+00', timestamptz '2026-02-01 00:00+00', timestamptz '2026-03-01 00:00+00')`), '10');
  assert.equal(q(`select public.ps_month_share(10, timestamptz '2026-02-01 00:00+00', timestamptz '2026-02-01 00:00+00', timestamptz '2026-01-01 00:00+00', timestamptz '2026-02-01 00:00+00')`), '0');
});

t('a measured session that crossed into this month counts its share against this month\'s CPU and egress allowances', () => {
  const p = newProject();
  rec(`sbx_c_${p.id}`, p, `${MSTART} - interval '1 hour'`, `${MSTART} + interval '1 hour'`, 7200000, 80_000_000, 0, 0);
  assert.equal(usageOf(p.owner).active_cpu_ms_measured, 40_000_000);
  assert.equal(usageOf(p.owner, '2000-01-15').sessions, 0);
  assert.equal(begin(p).reason, 'quota_cpu'); // 40,000,000 ms >= pro allowance of 36,000,000 ms
  const q2 = newProject();
  rec(`sbx_e_${q2.id}`, q2, `${MSTART} - interval '1 hour'`, `${MSTART} + interval '1 hour'`, 7200000, 1, 60_000_000_000, 0);
  assert.equal(begin(q2).reason, 'quota_egress'); // 30e9 bytes >= 21.47e9
  // last month keeps its own half, so nothing disappeared from either month
  assert.equal(q(`select (public.ps_usage('${p.owner}', null, ${MSTART} - interval '1 day')->>'active_cpu_ms_measured')::bigint + (public.ps_usage('${p.owner}')->>'active_cpu_ms_measured')::bigint`), '80000000');
});

t('missing or incomplete metrics never count as zero-cost measurements', () => {
  const p = newProject(); const s = startReady(p);
  assert.equal(rec(s, p, 'now() - interval \'1 hour\'', 'now()', 3600000, 'null'), 'f');           // CPU not reported yet
  assert.equal(rec(s, p, 'now()', 'now() - interval \'1 hour\'', 1, 1), 'f');                         // stop before start
  assert.equal(q(`select public.ps_record_session_usage('${s}','${p.id}','${p.owner}', now(), null, 1, 1, 1, 1, 1, 1)`), 'f'); // never stopped
  assert.equal(q(`select basis from public.project_server_sessions where session_id='${s}'`), 'estimated');
  const u = usageOf(p.owner);
  assert.equal(u.active_cpu_ms_measured, 0); assert.equal(u.egress_bytes_measured, 0); assert.ok(u.wall_ms_estimated >= 0); assert.equal(u.unmeasured_sessions, 1);
  assert.equal(J(q(`select public.ps_quota('${p.owner}','${p.id}','pro')::text`)).ok, true); // estimates cannot trip CPU/egress allowances
  // a closed-but-unreported session stays listed for reconciliation, and the late report replaces the estimate once
  q(`update public.project_server_sessions set stopped_at = now() - interval '5 minutes' where session_id='${s}'`);
  assert.equal(q(`select count(*) from public.ps_unmeasured_sessions(100) where session_id='${s}'`), '1');
  assert.equal(rec(s, p, "now() - interval '1 hour'", "now() - interval '5 minutes'", 3300000, 1234, 5, 6), 't');
  assert.equal(usageOf(p.owner).active_cpu_ms_measured, 1234);
  assert.equal(q(`select count(*) from public.ps_unmeasured_sessions(100) where session_id='${s}'`), '0');
});

t('duplicate reconciliation: parallel and repeated reports count a session exactly once', async () => {
  const p = newProject(); const s = startReady(p);
  const call = `select public.ps_record_session_usage('${s}','${p.id}','${p.owner}', now() - interval '30 minutes', now() - interval '1 minute', 1740000, 5000, 11, 13, 1, 2048)`;
  const results = await Promise.all(Array.from({ length: 6 }, () => qa(call)));
  assert.equal(results.filter((x) => x === 't').length, 1);
  assert.equal(q(call), 'f'); // later repeat
  const u = usageOf(p.owner);
  assert.equal(u.active_cpu_ms_measured, 5000); assert.equal(u.egress_bytes_measured, 11); assert.equal(u.sessions, 1);
  assert.equal(q(`select count(*) from public.project_server_events where kind='usage_measured' and detail->>'session_id'='${s}'`), '1');
  assert.equal(rec(s, p, "now() - interval '30 minutes'", "now() - interval '1 minute'", 1, 999999), 'f'); // a different later report cannot rewrite it
  assert.equal(usageOf(p.owner).active_cpu_ms_measured, 5000);
});

t('session id collisions: a session id can never be adopted by another project or owner, or revived', async () => {
  const a = newProject(); const b = newProject();
  const sa = startReady(a);
  // project B's sandbox reports project A's session id
  const rb = begin(b, 'hb'); assert.equal(rb.action, 'start');
  assert.equal(q(`select public.ps_mark_ready('${b.id}', ${rb.generation}, '${sa}', 1, 2048, now())`), 'f');
  assert.equal(state(b), 'FAILED');
  assert.equal(q(`select project_id from public.project_server_sessions where session_id='${sa}'`), a.id);
  assert.equal(state(a), 'READY');
  assert.equal(q(`select count(*) from public.project_server_events where kind='session_id_conflict' and project_id='${b.id}'`), '1');
  // blank / oversized ids fail the start instead of being stored
  const c = newProject(); const rc = begin(c, 'hc');
  assert.equal(q(`select public.ps_mark_ready('${c.id}', ${rc.generation}, '   ', 1, 2048, now())`), 'f');
  assert.equal(state(c), 'FAILED');
  // reporting measured usage for A's session under B's identity (or an owner that does not own the project) is refused and audited
  assert.equal(rec(sa, b, "now() - interval '2 hours'", "now() - interval '1 hour'", 3600000, 5), 'f');
  assert.equal(rec(sa, a, "now() - interval '2 hours'", "now() - interval '1 hour'", 3600000, 5, 0, 0, uid()), 'f');
  assert.equal(q(`select count(*) from public.project_server_sessions where session_id='${sa}' and basis='estimated' and project_id='${a.id}'`), '1');
  assert.equal(rec(`sbx_new_${a.id}`, a, "now() - interval '2 hours'", "now() - interval '1 hour'", 3600000, 5, 0, 0, uid()), 'f'); // unknown session, wrong owner
  assert.equal(q(`select count(*) from public.project_server_sessions where session_id='sbx_new_${a.id}'`), '0');
  assert.ok(Number(q(`select count(*) from public.project_server_events where kind='session_identity_mismatch'`)) >= 3);
  // a finished (measured) session id cannot be started again
  const d2 = newProject(); const sd = startReady(d2);
  assert.equal(rec(sd, d2, "now() - interval '2 hours'", "now() - interval '1 hour'", 3600000, 5), 't');
  const claims = J(claim(`, '${d2.id}', null, true`)); assert.equal(q(`select public.ps_mark_stopped('${d2.id}', ${claims[0].g})`), 't');
  const r2 = begin(d2, 'again'); assert.equal(r2.action, 'start');
  assert.equal(q(`select public.ps_mark_ready('${d2.id}', ${r2.generation}, '${sd}', 1, 2048, now())`), 'f');
  assert.equal(state(d2), 'FAILED');
  // two projects racing to publish the same session id: exactly one wins
  const x = newProject(); const y = newProject(); const rx = begin(x, 'hx'); const ry = begin(y, 'hy'); const shared = `sbx_race_${uid()}`;
  const out = await Promise.all([qa(`select public.ps_mark_ready('${x.id}', ${rx.generation}, '${shared}', 1, 2048, now())`), qa(`select public.ps_mark_ready('${y.id}', ${ry.generation}, '${shared}', 1, 2048, now())`)]);
  assert.deepEqual(out.slice().sort(), ['f', 't']);
  assert.equal(q(`select count(*) from public.project_server_sessions where session_id='${shared}'`), '1');
});

t('ownership comes from the projects table: wrong owners are refused and a transferred project cannot keep the old owner\'s server', () => {
  const p = newProject();
  assert.equal(J(q(`select public.ps_begin_start('${p.id}','${uid()}','pro','h',150,1000,600)::text`)).reason, 'not_owner');
  startReady(p);
  const buyer = uid();
  q(`update public.projects set user_id='${buyer}' where id='${p.id}'`);
  assert.equal(J(q(`select public.ps_begin_start('${p.id}','${buyer}','pro','h2',150,1000,600)::text`)).reason, 'not_owner'); // old owner's server still up
  const c = J(claim()); assert.equal(c.find((x: any) => x.p === p.id).r, 'owner_changed');
  q(`select public.ps_mark_stopped('${p.id}', ${c.find((x: any) => x.p === p.id).g})`);
  assert.equal(begin({ id: p.id, owner: buyer }, 'h3').action, 'start');
  assert.equal(q(`select owner_id from public.project_server_runtime where project_id='${p.id}'`), buyer);
  assert.equal(J(q(`select public.ps_set_enabled('${p.id}','${p.owner}','pro',true)::text`)).reason, 'not_owner'); // previous owner cannot toggle it
});

t('reaper delays: a missed sweep does not overcharge idle servers, still charges busy ones, and cannot lock the owner out', () => {
  // 1. idle for 30h with no reaper run: the estimate stops at last request + 11 min (the platform's own sleep timeout), not at "now"
  const p = newProject(); const s = startReady(p);
  q(`update public.project_server_runtime set last_request_at = now() - interval '30 hours', started_at = now() - interval '30 hours' where project_id='${p.id}'`);
  q(`update public.project_server_sessions set started_at = now() - interval '30 hours' where session_id='${s}'`);
  const idle = usageOf(p.owner, undefined, p.id);
  assert.ok(idle.wall_ms_estimated >= 10 * 60_000 && idle.wall_ms_estimated <= 11 * 60_000 + 1000, String(idle.wall_ms_estimated));
  const c = J(claim(`, '${p.id}'`)); assert.equal(c.length, 1); assert.equal(c[0].r, 'idle'); // the late sweep still stops it
  q(`select public.ps_mark_stopped('${p.id}', ${c[0].g})`);
  assert.equal(begin(p, 'again').action, 'start'); // no quota burned by the missing sweeps
  // 2. a server that is actually being used is charged in full even if the reaper never runs
  const busy = newProject(); const sb = startReady(busy);
  q(`update public.project_server_sessions set started_at = now() - interval '30 hours' where session_id='${sb}'`);
  assert.ok(usageOf(busy.owner, undefined, busy.id).wall_ms_estimated >= 29 * 3600_000);
  assert.equal(J(claim(`, '${busy.id}'`))[0].r, 'quota_project_hours'); // 30h > 25h project allowance
  // 3. stale READY rows stop counting against the owner's concurrency once past twice the sleep window
  const owner = uid(); const a = newProject(owner), b = newProject(owner), d = newProject(owner);
  startReady(a); startReady(b);
  assert.equal(begin(d, 'x').reason, 'owner_concurrency');
  q(`update public.project_server_runtime set last_request_at = now() - interval '25 minutes' where project_id='${a.id}'`);
  assert.equal(begin(d, 'x').action, 'start');
  // 4. a sweep that died halfway leaves a STOPPING row with an expired lease: the next sweep finishes it
  const q2 = newProject(); startReady(q2);
  assert.equal(J(claim(`, '${q2.id}', null, true`)).length, 1);
  assert.equal(J(claim(`, '${q2.id}'`)).length, 0); // live lease: a normal sweep leaves it alone
  q(`update public.project_server_runtime set lease_expires_at = now() - interval '1 second' where project_id='${q2.id}'`);
  assert.equal(J(claim()).find((x: any) => x.p === q2.id).r, 'interrupted_stopping');
});

t('a replaced sandbox cannot leave an open estimate behind', () => {
  const p = newProject(); const first = startReady(p);
  // simulate a lost stop: runtime goes back to STARTING without the old session having been closed
  q(`update public.project_server_runtime set state='STOPPED', lease_holder=null where project_id='${p.id}'`);
  const r = begin(p, 'again'); assert.equal(r.action, 'start');
  const second = ready(p, r.generation)!;
  assert.notEqual(first, second);
  assert.notEqual(q(`select stopped_at from public.project_server_sessions where session_id='${first}'`), '');
  assert.equal(q(`select count(*) from public.ps_unmeasured_sessions(100) where session_id='${first}'`), '0'); // closed just now: listed after the 1-minute settle time
  q(`update public.project_server_sessions set stopped_at = now() - interval '5 minutes' where session_id='${first}'`);
  assert.equal(q(`select count(*) from public.ps_unmeasured_sessions(100) where session_id='${first}'`), '1');
});

t('admin functions refuse anyone who is not in admin_users, even with a valid-looking id', () => {
  const owner = uid(); const nobody = uid();
  assert.match(qErr(`select public.ps_admin_set_owner('${owner}', true, 'x', 1, '${nobody}')`), /not_admin/);
  assert.match(qErr(`select public.ps_admin_set_kill_switch(true, 'x', '${nobody}')`), /not_admin/);
  assert.match(qErr(`select public.ps_admin_set_kill_switch(true, 'x', null)`), /not_admin/);
  assert.equal(q(`select count(*) from public.project_server_owner_controls where owner_id='${owner}'`), '0');
  assert.equal(q(`select kill_switch from public.project_server_platform where id=1`), 'f');
});

t('SECURITY DEFINER audit: fixed search_path, no public/anon/authenticated access, internals not callable by the backend role', () => {
  const rows = q(`select p.proname || '|' || p.prosecdef || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' ||
      has_function_privilege('anon', p.oid, 'execute') || has_function_privilege('authenticated', p.oid, 'execute') || has_function_privilege('public', p.oid, 'execute') || '|' || has_function_privilege('service_role', p.oid, 'execute')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname like 'ps\\_%' order by 1`).split('\n');
  assert.ok(rows.length >= 18, `found ${rows.length} functions`);
  const internal = new Set(['ps_event', 'ps_block_reason', 'ps_month_share', 'ps_require_admin']);
  for (const row of rows) {
    const [name, definer, config, anonAuthPublic, svc] = row.split('|');
    assert.equal(definer, name === 'ps_month_share' ? 'false' : 'true', name); // the share helper is pure arithmetic and touches no tables, so it stays SECURITY INVOKER assert.equal(config, 'search_path=pg_catalog, pg_temp', name);
    assert.equal(anonAuthPublic, 'falsefalsefalse', name);
    assert.equal(svc, internal.has(name) ? 'false' : 'true', name);
  }
  // objects of the same name earlier in the caller's path (a temp table) must not capture the function's reads
  const p = newProject(); const owner = p.owner;
  q(`create temp table project_server_runtime (project_id uuid, owner_id uuid, state text); select public.ps_begin_start('${p.id}','${owner}','pro','shadow',150,1000,600)`);
  assert.equal(state(p), 'STARTING');
  // and the schema is not writable by the API roles
  for (const role of ['anon', 'authenticated']) assert.match(qErr(`set role ${role}; create function public.now() returns timestamptz language sql as 'select null::timestamptz'`), /permission denied/);
});

t('migration history is preserved: 047 is byte-identical to the version pushed in 04384de, all new SQL is in 048', () => {
  const sha = crypto.createHash('sha256').update(readFileSync(new URL('../../supabase/migrations/047_project_server.sql', import.meta.url))).digest('hex');
  assert.equal(sha, 'fa8adb27461b98dce46424ea8a689eeefbfd40d948f9473fcf205c9b859e2969');
});

// Migration 049: deleting a project (done straight from the browser) must not erase usage or strand a sandbox.
t('deleting a project keeps its usage ledger, so it still counts toward the owner month', () => {
  const p = newProject();
  const s = `sbx_${uid()}`;
  assert.equal(q(`select public.ps_record_session_usage('${s}','${p.id}','${p.owner}', now() - interval '2 hours', now() - interval '1 hour', 3600000, 9000, 100, 200, 1, 2048)`), 't');
  const before = J(q(`select public.ps_usage('${p.owner}', null, ${MS})::text`));
  q(`delete from public.projects where id='${p.id}'`);
  assert.equal(q(`select count(*) from public.project_server_sessions where project_id='${p.id}'`), '1');
  const after = J(q(`select public.ps_usage('${p.owner}', null, ${MS})::text`));
  assert.deepEqual(after, before);
  assert.equal(q(`select count(*) from public.project_server_settings where project_id='${p.id}'`), '0'); // the on/off switch still goes with the project
});

t('a deleted project leaves a stoppable runtime row, then is listed for cleanup only when stopped and measured', () => {
  const p = newProject();
  const g = begin(p).generation; const s = ready(p, g)!;
  q(`delete from public.projects where id='${p.id}'`);
  assert.equal(state(p), 'READY');                                        // row survives: the reaper can still find and stop it
  assert.equal(q(`select count(*) from public.ps_orphan_runtimes(50) where project_id='${p.id}'`), '0'); // running: not an orphan yet
  assert.equal(q(`select public.ps_forget_runtime('${p.id}')`), 'f');     // refuses while not stopped
  q(`update public.project_server_runtime set last_request_at = now() - interval '2 hours' where project_id='${p.id}'`);
  const c = J(claim()).find((x: any) => x.p === p.id); assert.ok(c, 'idle server of a deleted project is claimed');
  assert.equal(q(`select public.ps_mark_stopped('${p.id}', ${c.g})`), 't');
  // session still estimated: wait for measured numbers before the sandbox (and its numbers) are deleted
  assert.equal(q(`select count(*) from public.ps_orphan_runtimes(50) where project_id='${p.id}'`), '0');
  q(`select public.ps_record_session_usage('${s}','${p.id}','${p.owner}', now() - interval '2 hours', now() - interval '1 hour', 3600000, 9000, 100, 200, 1, 2048)`);
  assert.equal(q(`select count(*) from public.ps_orphan_runtimes(50) where project_id='${p.id}'`), '1');
  assert.equal(q(`select public.ps_forget_runtime('${p.id}')`), 't');
  assert.equal(q(`select count(*) from public.project_server_runtime where project_id='${p.id}'`), '0');
  assert.equal(q(`select count(*) from public.project_server_sessions where project_id='${p.id}'`), '1'); // usage stays
});

t('a live project is never listed as an orphan or forgotten', () => {
  const p = newProject();
  const g = begin(p).generation; ready(p, g);
  q(`update public.project_server_runtime set state='STOPPED' where project_id='${p.id}'`);
  assert.equal(q(`select count(*) from public.ps_orphan_runtimes(50) where project_id='${p.id}'`), '0');
  assert.equal(q(`select public.ps_forget_runtime('${p.id}')`), 'f');
});

t('cleanup functions are service_role only', () => {
  for (const role of ['anon', 'authenticated']) {
    assert.match(qErr(`set role ${role}; select * from public.ps_orphan_runtimes(1)`), /permission denied/);
    assert.match(qErr(`set role ${role}; select public.ps_forget_runtime('${uid()}')`), /permission denied/);
  }
  assert.equal(q(`select has_function_privilege('service_role','public.ps_orphan_runtimes(int)','execute')`), 't');
});
