# Project Servers hardening (branch `feat/project-server`)

Pro-only, sleep-when-idle Node servers, one persistent Vercel Sandbox per project (`kx-srv-<projectId>`).
Status: **Phases 1-3 implemented on the branch. Not merged, not deployed, no migration applied to any hosted database.**

## Completed work

### Phase 1-2 (commits 69f2dec, e913449)
- Signed gateway credentials; root-owned gate (`/opt/kx/gate.cjs`) on public port 3000, key `/opt/kx/key` (root 600).
- Project code runs only as user `kxapp` (`env -i`, `setpriv --no-new-privs`) on loopback 3001.
- Egress deny policy for private/metadata IPv4 ranges (DNS kept working).
- Verified in a real Vercel Sandbox (Phase 2 report). Not re-run in Phase 3: Phase 3 did not change these files' behaviour; a source-scan test guards them.

### Phase 3 (uncommitted until the commit that adds this file)
- `supabase/migrations/047_project_server.sql` (rewritten; the committed version was only `project_server_settings`).
- `core/src/services/projectServerLifecycle.ts` - typed RPC wrappers and pure rules (denial mapping, measured-record validation, usage view).
- `core/src/services/projectServer.ts` - start/stop/reap now driven by the database; Phase 2 restricted start flow retained.
- `core/src/services/projectServerRoutes.ts` - usage, stop, admin, and cron endpoints.
- `core/api/index.ts` - mounts the router.
- Tests: `test/project-server-sql.test.ts`, `test/project-server-lifecycle.test.ts`, `test/sql/project_server_fixture.sql`.

## Design
- Postgres is the single source of truth. All transitions are atomic SECURITY DEFINER functions (service_role only, RLS on, anon/authenticated revoked).
- Runtime state machine STOPPED/STARTING/READY/IDLE/STOPPING/FAILED with a generation counter and lease: a stale worker cannot mark ready or stopped.
- Duplicate provisioning prevented by `ps_begin_start` (row lock + per-owner advisory lock): exactly one caller gets `start`, others `wait`.
- Reaper (`ps_claim_stops`, `FOR UPDATE SKIP LOCKED`) claims idle, expired, suspended, over-quota, interrupted STARTING/STOPPING and failed-debris servers; parallel sweeps never claim the same server.
- Failed start: state FAILED, exponential backoff 10s x 2^n capped at 600s. Interrupted start/stop leases expire and are taken over.
- Quotas (server-side, hard stop): owner monthly wall time, per-project wall time, active CPU, egress, concurrent running per owner, enabled projects per plan. Free tier has no limits row, so it fails closed.
- Suspension: owner suspension, existing `account_status` suspension, admin multiplier 0-5, platform kill switch (stops everything via the reaper). All audited in `project_server_events`.
- Usage ledger `project_server_sessions` keyed by sandbox session id: idempotent; first measured write wins; UTC month accounting with month-boundary clipping.

## Measured vs estimated
| Metric | Status | Source |
|---|---|---|
| Session wall time | Measured after session stops | SDK session `duration` |
| Active CPU time | Measured after stop only | `activeCpuDurationMs` |
| Network egress / ingress bytes | Measured after stop only | `networkTransfer` |
| vCPU count, memory | **Allocated**, not consumed | session `vcpus`, `memory` |
| Wall time of a running or unreported session | **Estimated** (now - start), replaced by measured once reported | derived |
| Actual memory used | **Not measured** | - |
| Dollar cost per project | **Not measured, not shown** | usage view `cost` states this |

Quota checks for CPU and egress use measured values only. Running sessions count toward wall time as estimates.

## Test evidence
- `npm test` (core): **197 / 197 pass**, `tsc --noEmit` clean. Baseline before Phase 3 was 170.
- 22 SQL tests run against a throwaway local PostgreSQL 16 cluster: idempotent re-apply, grants/RLS, 12-way concurrent start yields one start, owner cap under concurrency, quota bypass attempts, suspended accounts, kill switch, failed-startup backoff, interrupted start/stop takeover, reaper races, estimate-to-measured idempotency, hard stop, month boundary, enabled-cap race, audit trail.
- 5 unit tests cover denial mapping, measured-record rules, usage-view separation, and source guards.
- **Not tested for real:** the Phase 3 lifecycle against a real Vercel Sandbox and hosted Supabase. Only local PostgreSQL and pure logic were exercised. See staging steps.

## Outstanding risks
Security
- The default sandbox user `ubuntu` can read root-only files; only `kxapp` is isolated (unchanged from Phase 2).
- Egress policy is IPv4-only; the API rejects IPv6 CIDRs (sandbox has no IPv6 route).
- Lifecycle SDK calls (`listSessions` fields, post-stop metric availability) are verified against types, not against production behaviour.
Billing
- Plan allowance numbers are **placeholders** and must be approved before production.
- CPU/egress are reported only after a session stops; a long-running session can exceed those allowances until it stops. Wall-time bound: sandbox idle timeout (10 min) plus reaper interval.
- No sub-daily cron is configured (`vercel.json` has only the daily 03:00 job). Without a frequent reaper, hard stops rely on sandbox timeouts. Add a `*/5` schedule on a plan that allows it.
- Sessions that never report measured metrics stay estimated forever; `ps_unmeasured_sessions` lists them for reconciliation.
- Sandbox platform cost is not attributed per project in dollars.

## Staging test instructions
1. Create a Supabase branch/staging DB and apply `047_project_server.sql` there (never production). Review the seeded `project_server_plan_limits` rows and edit them.
2. Deploy the branch to a preview with staging env vars; set `CRON_SECRET`.
3. As a Pro test user enable a server, send a request: expect a start, then a READY state at `GET /api/projects/:id/server/usage`.
4. Fire ~10 concurrent requests at a stopped server: exactly one `start` event in `project_server_events`.
5. Wait past the idle window and call `GET /api/internal/cron/project-servers-reap` with `Authorization: Bearer $CRON_SECRET`: server stops; session row appears, usage moves estimated to measured.
6. Lower a limit (e.g. `monthly_wall_seconds`) below current use: next start returns 429 and the reaper stops a running server.
7. Admin: engage the kill switch, suspend an owner, set a multiplier; verify stops and audit rows. Free user: expect `no_plan` denial.
8. Kill the app mid-start and mid-stop; verify recovery after the lease expires.
9. Re-run the Phase 2 sandbox checks (kxapp isolation, `env -i`, deny policy).
