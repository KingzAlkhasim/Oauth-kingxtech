import type { Response, NextFunction } from 'express';
import type { AuthedRequest } from './auth';

/**
 * Minimal in-memory fixed-window rate limiter, keyed by authenticated user.
 * Good enough for a single-instance deployment. If you scale to multiple
 * Cloud Run instances, swap this for a shared store (e.g. Redis) since each
 * instance would otherwise track its own counts.
 */
const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;

const hits = new Map<string, { count: number; windowStart: number }>();

export function rateLimit(req: AuthedRequest, res: Response, next: NextFunction) {
  const key = req.user?.id ?? req.ip ?? 'anonymous';
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    hits.set(key, { count: 1, windowStart: now });
    next();
    return;
  }

  if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
    res.status(429).json({
      success: false,
      error: `Rate limit exceeded. Max ${MAX_REQUESTS_PER_WINDOW} requests per minute.`,
    });
    return;
  }

  entry.count += 1;
  next();
}
