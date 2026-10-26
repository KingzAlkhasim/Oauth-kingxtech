import type { Response, NextFunction } from 'express';
import type { AuthedRequest } from './auth';

/**
 * Rate limiter keyed by authenticated user (or IP when there is no user).
 *
 * Counters live in Postgres (public.take_rate_limit, migration 045) so every
 * serverless instance shares one count. If that function is missing or the
 * database is unreachable the limiter falls back to a per-instance in-memory
 * counter instead of failing open, so protection never disappears entirely.
 */
const WINDOW_SECONDS = 60;
const MAX_REQUESTS_PER_WINDOW = 10;

/** Returns true = allowed, false = limit hit, null = shared counter unavailable. */
export type TakeFn = (key: string, limit: number, windowSeconds: number) => Promise<boolean | null>;

const dbTake: TakeFn = async (key, limit, windowSeconds) => {
  try {
    // Imported lazily so this module can be unit-tested without Supabase credentials.
    const { supabaseAdmin } = await import('../lib/supabaseAdmin.js');
    const { data, error } = await supabaseAdmin.rpc('take_rate_limit', {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error || typeof data !== 'boolean') return null;
    return data;
  } catch {
    return null;
  }
};

export function createMemoryCounter(now: () => number = Date.now) {
  const hits = new Map<string, { count: number; windowStart: number }>();
  return (key: string, limit: number, windowSeconds: number): boolean => {
    const t = now();
    const windowMs = windowSeconds * 1000;

    // Keep memory bounded: drop expired entries once the map grows.
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (t - v.windowStart > windowMs) hits.delete(k);
    }

    const entry = hits.get(key);
    if (!entry || t - entry.windowStart > windowMs) {
      hits.set(key, { count: 1, windowStart: t });
      return true;
    }
    if (entry.count >= limit) return false;
    entry.count += 1;
    return true;
  };
}

export function createRateLimiter(take: TakeFn = dbTake, memory = createMemoryCounter()) {
  let warned = false;
  return async function rateLimit(req: AuthedRequest, res: Response, next: NextFunction) {
    const key = req.user?.id ?? req.ip ?? 'anonymous';

    let allowed = await take(key, MAX_REQUESTS_PER_WINDOW, WINDOW_SECONDS);
    if (allowed === null) {
      if (!warned) {
        warned = true;
        console.warn('[rateLimit] shared counter unavailable; using per-instance fallback. Apply migration 045.');
      }
      allowed = memory(key, MAX_REQUESTS_PER_WINDOW, WINDOW_SECONDS);
    }

    if (!allowed) {
      res.status(429).json({
        success: false,
        error: `Rate limit exceeded. Max ${MAX_REQUESTS_PER_WINDOW} requests per minute.`,
      });
      return;
    }
    next();
  };
}

export const rateLimit = createRateLimiter();
