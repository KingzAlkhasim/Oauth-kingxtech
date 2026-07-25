import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

export interface AuthedRequest extends Request {
  user?: { id: string; email?: string };
}

/**
 * Verifies the caller's Supabase access token by asking Supabase itself
 * ("/auth/v1/user"). This avoids managing a JWT secret in this service —
 * Supabase already knows whether the token is valid, expired, or revoked.
 *
 * Expects: Authorization: Bearer <supabase_access_token>
 */
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing or malformed Authorization header.' });
    return;
  }

  const token = header.slice('Bearer '.length).trim();

  try {
    const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
    });

    if (!resp.ok) {
      res.status(401).json({ success: false, error: 'Invalid or expired session.' });
      return;
    }

    const user = (await resp.json()) as { id: string; email?: string };
    req.user = { id: user.id, email: user.email };
    next();
  } catch (err) {
    res.status(503).json({ success: false, error: 'Could not verify session (auth service unreachable).' });
  }
}
