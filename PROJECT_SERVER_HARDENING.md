# Project Servers hardening (branch `feat/project-server`)

Pro-only, sleep-when-idle Node servers, one persistent Vercel Sandbox per project (`kx-srv-<projectId>`).
Status: **Phases 1-3 implemented on the branch, plus the Phase 3 review fixes below. Not merged, not deployed, no migration applied to any hosted database. Awaiting review before Phase 4.**

## Completed work

### Phase 1-2 (commits 69f2dec, e913449)
- Signed gateway credentials; root-owned gate (`/opt/kx/gate.cjs`) on public port 3000, key `/opt/kx/key` (root 600).
- Project code runs only as user `kxapp` (`env -i`, `setpriv --no-new-privs`) on loopback 3001.
- Egress deny policy for private/metadata IPv4 ranges (DNS kept working).
- Verified in a real Vercel Sandbox (Phase 2 report). Not re-run in Phase 3: Phase 3 did not change these files' behaviour; a source-scan test guards them.

### Phase 3 (6324d18) and review fixes
- `supabase/migrations/048_project_server_lifecycle.sql` - all lifecycle, quota and usage SQL. `047_project_server.sql` is back to the exact version pushed in 04384de (see finding 7).
- `supabase/ops/project_server_reaper_schedule.sql` - opt-in pg_cron schedule for the reaper (not a migration, no secrets).
- `core/src/services/projectServerLifecycle.ts` - typed RPC wrappers and pure rules (denial mapping, measured-record validation, usage view).
- `core/src/services/projectServer.ts` - start/stop/reap now driven by the database; Phase 2 restricted start flow retained.
- `core/src/services/projectServerRoutes.ts` - usage, stop, admin, and cron endpoints.
- `core/api/index.ts` - mounts the router.
- Tests: `test/project-server-sql.test.ts`, `test/project-server-lifecycle.test.ts`, `test/project-server-routes.test.ts`, `test/sql/project_server_fixture.sql`.

## Design
- Postgres is the single source of truth. All transitions are atomic SECURITY DEFINER functions (service_role only, RLS on, anon/authenticated revoked).
- Runtime state machine STOPPED/STARTING/READY/IDLE/STOPPING/FAILED with a generation counter and lease: a stale worker cannot mark ready or stopped.
- Duplicate provisioning prevented by `ps_begin_start` (row lock + per-owner advisory lock): exactly one caller gets `start`, others `wait`.
- Reaper (`ps_claim_stops`, `FOR UPDATE SKIP LOCKED`) claims idle, expired, suspended, over-quota, interrupted STARTING/STOPPING and failed-debris servers; parallel sweeps never claim the same server.
- Failed start: state FAILED, exponential backoff 10s x 2^n capped at 600s. Interrupted start/stop leases expire and are taken over.
- Quotas (server-side, hard stop): owner monthly wall time, per-project wall time, active CPU, egress, concurrent running per owner, enabled projects per plan. Free tier has no limits row, so it fails closed.
- Suspension: owner suspension, existing `account_status` suspension, admin multiplier 0-5, platform kill switch (stops everything via the reaper). All audited in `project_server_events`.
- Usage ledger `project_server_sessions` keyed by sandbox session id: idempotent; first measured write wins; UTC month accounting; cross-month sessions are apportioned (finding 1).

## Measured vs estimated
| Metric | Status | Source |
|---|---|---|
| Session wall time | Measured after session stops | SDK session `duration` |
| Active CPU time | Measured after stop only | `activeCpuDurationMs` |
| Network egress / ingress bytes | Measured after stop only | `networkTransfer` |
| vCPU count, memory | **Allocated**, not consumed | session `vcpus`, `memory` |
| Wall time of a running or unreported session | **Estimated** (until now while in use; capped at last request + 11 min once idle), replaced by measured once reported | derived |
| Actual memory used | **Not measured** | - |
| Dollar cost per project | **Not measured, not shown** | usage view `cost` states this |

Quota checks for CPU and egress use measured values only. Running sessions count toward wall time as estimates. Real-sandbox observation (2026-11-03, 20 s timeout probe, non-persistent sandbox): the platform stopped the session by itself 180 ms after the timeout and `duration`, `activeCpuDurationMs` and `networkTransfer` were all present within 45 s of the stop.

## Phase 3 review findings and fixes

### 1. Monthly accounting across billing months
Problem: CPU and network were counted only when a session *started* in the month, so a session that crossed a month boundary lost its measured usage from the later month, and past months could not be queried.
Policy now: the platform reports CPU, network and wall time only as whole-session totals after the stop. Each total is split across the UTC months the session touched in proportion to wall-clock time in each month (`ps_month_share`, cumulative floors), so the monthly shares **always add up to exactly the reported total** (property-tested on 400 random sessions over 1-5 months). The split is an attribution rule, not a measurement; the usage view labels it and reports `apportionedSessions`. A closed month can gain usage when a late report arrives. `ps_usage` takes an optional month; `GET /api/project-servers/usage?month=YYYY-MM` shows one past or current month.
Related fix: an unstopped estimate no longer grows forever when the reaper is late. It is charged to now while the server is in use, and stops at last request + 11 minutes (the 10 minute sleep timeout plus 1 minute margin) once idle. Measured numbers replace it as soon as they are reconciled.

### 2. Reaper scheduling
Verified: the only Vercel account reachable from here (`kingzalkhasim`) is on the **Hobby** plan. Vercel's cron documentation says Hobby cron runs at most once per day with imprecise timing (a daily job can run anywhere in its hour); a sub-daily expression on Hobby is reported to fail the deployment (official page could not be fetched for that line; secondary source). Pro documents 40 cron jobs per account and more precise timing; I could not fetch an official statement of the Pro minimum interval. I could not identify which Vercel project serves `core/` (the visible projects are auth-kingxtech, neurocore, niger-estate, zen-trusted), so **which plan applies to the API deployment must be confirmed by the owner.** `core/vercel.json` was deliberately left unchanged (adding `*/5` would break a Hobby deploy).
Supported options:
- Supabase pg_cron + pg_net (already enabled on the KingxTech Ecosystem project, which already runs `aria-dispatch` every 5 minutes): `supabase/ops/project_server_reaper_schedule.sql`, every minute, secret read from Vault. Opt-in, staging first, **not applied**.
- If the API is on Vercel Pro: add `{ "path": "/api/internal/cron/project-servers-reap", "schedule": "*/5 * * * *" }`.
What is and is not guaranteed:
- Idle shutdown is enforced by the sandbox's own timeout, not by the reaper. Every proxied request goes through `ps_begin_start`, so an owner who is suspended, over quota or blocked by the kill switch gets no request through and the sandbox's timeout is not extended: it stops by itself at most ~10 minutes after the last allowed request. Verified for a non-persistent sandbox only; **the persistent sandboxes used for project servers were not separately verified.**
- With a daily reaper (Hobby Vercel cron) nothing is claimed about 10-minute cleanup by the reaper. What the daily reaper still affects: how long DB state, measured usage and stale `READY` rows linger, and how quickly a quota breach by an idle server is recorded. Stale rows (idle > 20 min) no longer count against the concurrency cap, and idle estimates stop growing, so a late reaper cannot lock out or overcharge an owner.
- Admin kill switch and owner suspension stop servers synchronously in the admin request, independent of any schedule.
- With a per-minute schedule the reaper's own latency bound is about one minute plus the sweep time.

### 3. Session identity
`ps_mark_ready` no longer silently accepts `ON CONFLICT DO NOTHING`. A session id already recorded for another project or owner, already closed, or already measured fails the start (state FAILED with backoff, event `session_id_conflict`) and the caller stops its sandbox. Blank/oversized ids are rejected. Same-project idempotent retries are still accepted. `ps_record_session_usage` refuses mismatched project/owner (event `session_identity_mismatch`), requires stop >= start, and refuses unknown sessions for a project the owner does not own. `ps_begin_start` now checks ownership against `projects.user_id` itself (previously it trusted the caller), and a transferred project is stopped with reason `owner_changed` before the new owner can start it.

### 4. SECURITY DEFINER audit
All 18 `ps_*` functions: `SECURITY DEFINER` (except the pure arithmetic helper `ps_month_share`), `set search_path = pg_catalog, pg_temp` (was `public`), every owned object schema-qualified, EXECUTE revoked from PUBLIC/anon/authenticated. Entry points are granted to `service_role` only; internals (`ps_event`, `ps_block_reason`, `ps_month_share`, `ps_require_admin`) are not callable by any API role. Hosted-DB check (read-only catalog query): `anon`, `authenticated` and `service_role` cannot CREATE in `public` (only `postgres` can), so object shadowing in `public` is not possible from the API roles. Supabase's default privileges grant EXECUTE on new functions to API roles, which is why every function is revoked by name. Tests assert the config, the privileges of every `ps_%` function, and that a same-named temp table cannot capture a function's reads.

### 5. Admin authorization
Inspected `projectServerRoutes.ts` and `core/api/index.ts`. The administrator id was already taken from `req.user.id` (set by `requireAuth` from a verified Supabase session), never from the client, but the check was repeated per route. Now one guard is mounted on the whole `/api/admin/project-servers` prefix, so a future admin route cannot forget it: it requires a verified session (API keys are refused, and `apiKeyScope` already limits keys to `/api/v1/*`), looks the id up in `admin_users`, fails closed if that lookup errors, and passes `adminIdOf(req)` to the database. In addition `ps_admin_set_*` independently refuse any id not in `admin_users`. The cron endpoint compares the bearer secret in constant time and is closed when `CRON_SECRET` is unset.

### 6. Tests
See below. New or changed coverage: cross-month sessions, missing metrics, duplicate reconciliation (6 parallel reports), session-id collisions (including two projects racing for one id), reaper delays, concurrent starts (kept from Phase 3), administrative authorization over real HTTP, privilege audit.

### 7. Migration safety
Checked: `list_migrations` and `list_tables` on both hosted Supabase projects visible here (KingxTech Ecosystem and KingzAlkhasim's Project): no `047`/project-server migration and no `project_server_*` tables. **But** the original 047 was pushed to `origin/feat/project-server` (commit 04384de), i.e. it exists in shared history, and I cannot see staging or local databases. Treated as possibly applied: 047 was restored byte-for-byte (sha256 `fa8adb27...2859`, asserted by a test) and every Phase 3 change moved into the new `048_project_server_lifecycle.sql`. 048 is idempotent and builds on 047's table (`create table if not exists`).

## Test evidence
- `npm test` (core): **213 / 213 pass**, `tsc --noEmit` clean. Baseline before Phase 3 was 170.
- `project-server-sql.test.ts`: 33 tests on a throwaway local PostgreSQL 16 cluster (047 then 048 applied, 048 applied twice): idempotent re-apply, grants/RLS, 12-way concurrent start yields one start, owner cap under concurrency, quota bypass attempts, suspended accounts, kill switch, failed-startup backoff, interrupted start/stop takeover, reaper races, estimate-to-measured idempotency, hard stop, month boundary, enabled-cap race, audit trail, cross-month apportionment (+ 400-session property test), missing metrics, duplicate reconciliation, session-id collisions, ownership/transfer, reaper delays, admin DB guard, SECURITY DEFINER audit, 047 immutability.
- `project-server-routes.test.ts`: 5 tests over real HTTP against the real handlers with stubbed dependencies: admin routes reject anonymous, non-admin and API-key callers; forged admin ids in body, query and headers ignored; guard fails closed; cron secret; month parameter validation.
- `project-server-lifecycle.test.ts`: 5 unit tests (denial mapping, measured-record rules, usage-view separation, source guards).
- Real Vercel Sandbox, this round: one 20-second timeout probe only (see Measured vs estimated). **Not tested for real:** the Phase 3 lifecycle end to end against a real sandbox and hosted Supabase, persistent-sandbox timeout behaviour, the pg_cron schedule, Vercel cron.

## Outstanding risks
Security
- The default sandbox user `ubuntu` can read root-only files; only `kxapp` is isolated (unchanged from Phase 2).
- Egress policy is IPv4-only; the API rejects IPv6 CIDRs (sandbox has no IPv6 route).
- Admin access depends on `admin_users` and Supabase session validation; the route tests use stubs for both.
- The reaper secret in the optional pg_cron job lives in Supabase Vault; rotating `CRON_SECRET` requires updating the vault secret too.
Billing
- Plan allowance numbers are **placeholders** and must be approved before production.
- CPU/egress appear only after a session stops, so a continuously used server can exceed those allowances until it stops (wall time is enforced live).
- Cross-month CPU/network splits are an attribution rule, not a measurement; past months can change when late reports arrive.
- Idle-estimate capping and the stale-row concurrency rule assume the sandbox timeout is enforced for persistent sandboxes (verified for a non-persistent one only). If it were not, wall time would be undercounted until reconciliation and concurrency could briefly overshoot.
- No frequent reaper is scheduled by default; see finding 2. The owner must pick and apply one.
- Sessions that never report measured metrics stay estimated; `ps_unmeasured_sessions` lists them for reconciliation.
- Sandbox platform cost is not attributed per project in dollars.

## Staging test instructions
1. Create a Supabase branch/staging DB and apply `047_project_server.sql` then `048_project_server_lifecycle.sql` there (never production). Review and edit the seeded `project_server_plan_limits` rows.
2. Deploy the branch to a preview with staging env vars (`CRON_SECRET`, `PROJECT_SERVER_GATEWAY_SECRET`).
3. As a Pro test user enable a server and send a request: expect a start, then READY at `GET /api/projects/:id/server/usage`.
4. Fire ~10 concurrent requests at a stopped server: exactly one `start_begin` event in `project_server_events`.
5. Apply `supabase/ops/project_server_reaper_schedule.sql` to staging (after creating the two vault secrets) or call the endpoint by hand with `Authorization: Bearer $CRON_SECRET`. Confirm in `net._http_response` that calls return 200.
6. Stop sending traffic: the sandbox should be `stopped` within ~10 minutes with the reaper disabled (this checks the platform timeout on a *persistent* sandbox); then enable the reaper and confirm `usage_measured` events and estimated to measured transitions.
7. Lower a limit (e.g. `monthly_wall_seconds`) below current use: next request returns 429 and the reaper stops a running server.
8. Admin (signed in with a session, not an API key): engage the kill switch, suspend an owner, set a multiplier; verify stops and audit rows. A non-admin session and a forged `adminId` in the body must get 403. Free user: `no_plan`.
9. Kill the app mid-start and mid-stop; verify recovery after the lease expires.
10. Cross-month: insert a stopped test session spanning a month boundary through `ps_record_session_usage`, then compare `GET /api/project-servers/usage?month=` for both months; the shares must sum to the reported totals.
11. Re-run the Phase 2 sandbox checks (kxapp isolation, `env -i`, deny policy).
