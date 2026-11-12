import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const sql = readFileSync(new URL('../../supabase/migrations/050_ai_run_slots.sql', import.meta.url), 'utf8');
test('050: slot functions are service_role only and serialised per user', () => {
  assert.match(sql, /revoke all on function public\.ai_run_acquire[^;]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.ai_run_acquire[^;]*to service_role/);
  assert.match(sql, /grant execute on function public\.ai_run_release[^;]*to service_role/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /enable row level security/);
});
test('050: acquire frees expired leases before counting', () => {
  assert.ok(sql.indexOf('expires_at <= now()') < sql.indexOf('select count(*)'));
});
const sql51 = readFileSync(new URL('../../supabase/migrations/051_ai_run_lost_cost.sql', import.meta.url), 'utf8');
test('051: lost runs are billed before slots are counted, service_role only', () => {
  assert.ok(sql51.indexOf('ai_usage_record(p_user, v_lost') < sql51.indexOf('select count(*) into v_active'));
  assert.match(sql51, /grant execute on function public\.ai_run_acquire2[^;]*to service_role/);
  assert.match(sql51, /revoke all on function public\.ai_run_acquire2[^;]*from public, anon, authenticated/);
});
