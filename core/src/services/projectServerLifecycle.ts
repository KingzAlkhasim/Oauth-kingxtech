import crypto from 'node:crypto';
import { supabaseAdmin } from '../lib/supabaseAdmin';

/**
 * Thin, typed access to the lifecycle / quota / usage functions of migration 048, plus the pure rules around them.
 * The database decides; this file never keeps authoritative state in process memory.
 */
export const HOLDER = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
export const START_LEASE_SECONDS = 150;
export const STOP_LEASE_SECONDS = 120;
export const MAX_GLOBAL_STARTS = 6;

export type BeginResult =
  | { action: 'ready' | 'wait' | 'start'; generation: number; state?: string }
  | { action: 'denied'; reason: string; retry_after?: number };

export interface StopClaim { project_id: string; owner_id: string; session_id: string | null; generation: number; reason: string }

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseAdmin.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data as T;
}

export const beginStart = (projectId: string, ownerId: string, tier: string) =>
  rpc<BeginResult>('ps_begin_start', { p_project: projectId, p_owner: ownerId, p_tier: tier, p_holder: HOLDER, p_lease_seconds: START_LEASE_SECONDS, p_max_global_starts: MAX_GLOBAL_STARTS, p_idle_seconds: 600 });
export const markReady = (projectId: string, generation: number, sessionId: string, vcpus: number | null, memoryMb: number | null, startedAt: Date | null) =>
  rpc<boolean>('ps_mark_ready', { p_project: projectId, p_generation: generation, p_session_id: sessionId, p_vcpus: vcpus, p_memory_mb: memoryMb, p_started_at: startedAt ? startedAt.toISOString() : null });
export const markFailed = (projectId: string, generation: number, error: string) => rpc<boolean>('ps_mark_failed', { p_project: projectId, p_generation: generation, p_error: error });
export const markStopped = (projectId: string, generation: number) => rpc<boolean>('ps_mark_stopped', { p_project: projectId, p_generation: generation });
export const stopFailed = (projectId: string, generation: number, error: string) => rpc<void>('ps_stop_failed', { p_project: projectId, p_generation: generation, p_error: error });
export const touch = (projectId: string) => rpc<void>('ps_touch', { p_project: projectId });
export const claimStops = (opts: { limit?: number; projectId?: string | null; ownerId?: string | null; force?: boolean } = {}) =>
  rpc<StopClaim[]>('ps_claim_stops', { p_holder: HOLDER, p_idle_seconds: 600, p_limit: opts.limit ?? 20, p_lease_seconds: STOP_LEASE_SECONDS, p_project: opts.projectId ?? null, p_owner: opts.ownerId ?? null, p_force: opts.force ?? false });
export const usageRaw = (ownerId: string, projectId: string | null = null, monthStartIso: string | null = null) => rpc<Record<string, any>>('ps_usage', { p_owner: ownerId, p_project: projectId, p_month: monthStartIso });

/** "2026-10" -> first instant of that UTC month, or null when the text is not a real past-or-current month. */
export function parseMonth(text: unknown, now: Date = new Date()): string | null {
  if (typeof text !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) return null;
  const start = new Date(`${text}-01T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || start.getUTCFullYear() < 2024 || start.getTime() > now.getTime()) return null;
  return start.toISOString();
}
export const quotaRaw = (ownerId: string, projectId: string, tier: string) => rpc<Record<string, any>>('ps_quota', { p_owner: ownerId, p_project: projectId, p_tier: tier });
export const orphanRuntimes = (limit = 20) => rpc<{ project_id: string; owner_id: string }[]>('ps_orphan_runtimes', { p_limit: limit });
export const forgetRuntime = (projectId: string) => rpc<boolean>('ps_forget_runtime', { p_project: projectId });
export const unmeasuredSessions = (limit = 50) => rpc<{ project_id: string; owner_id: string; session_id: string }[]>('ps_unmeasured_sessions', { p_limit: limit });
export const setKillSwitch = (engaged: boolean, reason: string, adminId: string) => rpc<void>('ps_admin_set_kill_switch', { p_engaged: engaged, p_reason: reason, p_admin: adminId });
export const setOwnerControls = (ownerId: string, suspended: boolean | null, reason: string | null, multiplier: number | null, adminId: string) =>
  rpc<void>('ps_admin_set_owner', { p_owner: ownerId, p_suspended: suspended, p_reason: reason, p_multiplier: multiplier, p_admin: adminId });

/** What a visitor or owner is told for each denial reason. Wording never reveals plan internals beyond what the owner needs. */
export function denialResponse(reason: string, retryAfter?: number): { status: number; message: string; retryAfter?: number; code?: string } {
  switch (reason) {
    case 'no_plan': return { status: 402, message: 'Project servers are part of the Pro plan.' };
    case 'disabled': return { status: 404, message: 'Not found.' };
    case 'not_owner': return { status: 403, message: 'Not allowed.' };
    case 'quota_owner_hours': case 'quota_project_hours': case 'quota_cpu': case 'quota_egress':
      return { status: 429, message: 'This server has reached its usage allowance for this month.', code: 'allowance_reached' };
    case 'enabled_cap': return { status: 429, message: 'You have reached the number of projects that can have a server on your plan.' };
    case 'owner_concurrency': return { status: 429, message: 'You have reached the number of servers that can run at once. Stop another one first.' };
    case 'backoff': return { status: 503, message: 'The server failed to start recently. Try again shortly.', retryAfter };
    case 'busy': return { status: 503, message: 'The platform is busy waking servers. Try again in a few seconds.', retryAfter: 5 };
    case 'owner_suspended': case 'account_suspended': case 'platform_stopped': return { status: 503, message: 'This server is not available right now.' };
    default: return { status: 503, message: 'This server is not available right now.' };
  }
}

/** Reasons that must also stop a server that is already running (used by the reaper and admin tools). */
export const HARD_STOP_REASONS = new Set(['owner_changed', 'owner_suspended', 'account_suspended', 'platform_stopped', 'quota_owner_hours', 'quota_project_hours', 'quota_cpu', 'quota_egress']);

/** Shape of one session as returned by Sandbox.listSessions (only the fields we use). */
export interface SdkSession { id: string; status: string; startedAt?: number; stoppedAt?: number; duration?: number; activeCpuDurationMs?: number; networkTransfer?: { ingress: number; egress: number }; vcpus?: number; memory?: number }

/**
 * Turns a platform session into a usage record, or null when it is not fully measured yet.
 * Only numbers the platform reported are used. Memory is the ALLOCATED size and is never multiplied into a "usage" figure.
 */
export function measuredRecord(s: SdkSession): null | { sessionId: string; startedAt: Date; stoppedAt: Date; wallMs: number; activeCpuMs: number; egressBytes: number; ingressBytes: number; vcpus: number | null; memoryMb: number | null } {
  if (s.status !== 'stopped' || !Number.isFinite(s.startedAt) || !Number.isFinite(s.stoppedAt) || !Number.isFinite(s.duration) || !Number.isFinite(s.activeCpuDurationMs)) return null;
  if ((s.duration as number) < 0 || (s.activeCpuDurationMs as number) < 0) return null;
  return {
    sessionId: s.id, startedAt: new Date(s.startedAt as number), stoppedAt: new Date(s.stoppedAt as number), wallMs: Math.round(s.duration as number),
    activeCpuMs: Math.round(s.activeCpuDurationMs as number), egressBytes: Math.max(0, Math.round(s.networkTransfer?.egress ?? 0)), ingressBytes: Math.max(0, Math.round(s.networkTransfer?.ingress ?? 0)),
    vcpus: Number.isFinite(s.vcpus) ? (s.vcpus as number) : null, memoryMb: Number.isFinite(s.memory) ? (s.memory as number) : null,
  };
}

export async function recordMeasured(projectId: string, ownerId: string, r: NonNullable<ReturnType<typeof measuredRecord>>): Promise<boolean> {
  return rpc<boolean>('ps_record_session_usage', {
    p_session_id: r.sessionId, p_project: projectId, p_owner: ownerId, p_started_at: r.startedAt.toISOString(), p_stopped_at: r.stoppedAt.toISOString(),
    p_wall_ms: r.wallMs, p_active_cpu_ms: r.activeCpuMs, p_egress: r.egressBytes, p_ingress: r.ingressBytes, p_vcpus: r.vcpus, p_memory_mb: r.memoryMb,
  });
}

/** Customer-facing usage view. Measured, estimated and allocated figures are separate fields on purpose. */
export function buildUsageView(quota: Record<string, any>, allocated?: { vcpus: number | null; memoryMb: number | null } | null) {
  const uo = quota.usage_owner ?? {}; const up = quota.usage_project ?? {}; const lim = quota.limits ?? {};
  const remaining = (limit: number | undefined, used: number | undefined) => (typeof limit === 'number' ? Math.max(0, limit - (used ?? 0)) : null);
  return {
    period: { startsAt: uo.period_start ?? null },
    allowed: quota.ok === true, blockedReason: quota.ok === true ? null : (quota.reason ?? null),
    measured: {
      source: 'Reported by the sandbox platform after each session stops',
      attribution: 'Whole-session totals are split across UTC months in proportion to wall-clock time in each month; the shares always add up to the reported total.',
      apportionedSessions: uo.apportioned_sessions ?? 0,
      activeCpuMs: uo.active_cpu_ms_measured ?? 0, networkEgressBytes: uo.egress_bytes_measured ?? 0, networkIngressBytes: uo.ingress_bytes_measured ?? 0,
      wallMs: uo.wall_ms_measured ?? 0,
    },
    estimated: {
      source: 'Our own clock for sessions the platform has not reported yet (running or just stopped)',
      wallMs: uo.wall_ms_estimated ?? 0, sessionsAwaitingMeasurement: uo.unmeasured_sessions ?? 0,
    },
    // Memory use is not reported by the platform; this is only the size reserved for the server.
    allocated: { note: 'Reserved size, not actual consumption', vcpus: allocated?.vcpus ?? null, memoryMbReserved: allocated?.memoryMb ?? null },
    thisProject: { wallMsTotal: up.wall_ms_total ?? 0 },
    allowance: {
      ownerWallMs: { used: uo.wall_ms_total ?? 0, limit: lim.owner_wall_ms ?? null, remaining: remaining(lim.owner_wall_ms, uo.wall_ms_total) },
      projectWallMs: { used: up.wall_ms_total ?? 0, limit: lim.project_wall_ms ?? null, remaining: remaining(lim.project_wall_ms, up.wall_ms_total) },
      activeCpuMs: { used: uo.active_cpu_ms_measured ?? 0, limit: lim.active_cpu_ms ?? null, remaining: remaining(lim.active_cpu_ms, uo.active_cpu_ms_measured), note: 'Counted once measured, so it can lag a finished session' },
      networkEgressBytes: { used: uo.egress_bytes_measured ?? 0, limit: lim.egress_bytes ?? null, remaining: remaining(lim.egress_bytes, uo.egress_bytes_measured), note: 'Counted once measured, so it can lag a finished session' },
      maxRunningServers: lim.max_running ?? null,
    },
    cost: 'Not shown: the platform bills the account as a whole and does not report a cost per project.',
  };
}


export interface OverviewMeter { used: number; limit: number | null; percent: number }
const overviewMeter = (used: unknown, limit: unknown): OverviewMeter => {
  const u = Number(used) || 0; const l = typeof limit === 'number' && limit > 0 ? limit : null;
  return { used: u, limit: l, percent: l ? Math.min(100, Math.floor((u / l) * 1000) / 10) : 0 };
};
export interface OverviewProject {
  projectId: string; name: string; state: string; quota: Record<string, any>;
  hits: { total: number; browser: number; bot: number; other: number; top: { path: string; hits: number; errors: number; bot: number }[] } | null;
}

/** The Usage page's Server card: account meters, per-project meters, warnings at 80% and 100%, and when it resets. */
export function buildServerOverview(tier: string, ownerQuota: Record<string, any>, projects: OverviewProject[]) {
  const uo = ownerQuota.usage_owner ?? {}; const lim = ownerQuota.limits ?? {};
  const meters = {
    hours: overviewMeter(uo.wall_ms_total, lim.owner_wall_ms),
    cpu: overviewMeter(uo.active_cpu_ms_measured, lim.active_cpu_ms),
    egress: overviewMeter(uo.egress_bytes_measured, lim.egress_bytes),
  };
  const ownerPaused = Math.max(meters.hours.percent, meters.cpu.percent, meters.egress.percent) >= 100;
  const rows = projects.map((p) => {
    const hours = overviewMeter(p.quota.usage_project?.wall_ms_total, p.quota.limits?.project_wall_ms);
    return { projectId: p.projectId, name: p.name, state: p.state, hours, paused: ownerPaused || hours.percent >= 100, hits: p.hits };
  });
  const worstPercent = Math.max(meters.hours.percent, meters.cpu.percent, meters.egress.percent, ...rows.map((r) => r.hours.percent), 0);
  const allPaused = ownerPaused || (rows.length > 0 && rows.every((r) => r.paused));
  const status: 'ok' | 'warning' | 'paused' = allPaused ? 'paused' : (worstPercent >= 80 || rows.some((r) => r.paused)) ? 'warning' : 'ok';
  return {
    tier, status, worstPercent,
    period: { startsAt: uo.period_start ?? null, resetsAt: uo.period_end ?? null },
    multiplier: typeof lim.multiplier === 'number' ? lim.multiplier : 1,
    maxRunningServers: lim.max_running ?? null,
    meters, projects: rows,
  };
}
