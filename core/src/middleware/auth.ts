import type { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { env } from '../config/env';
import { supabaseAdmin } from '../lib/supabaseAdmin';

export interface AuthedRequest extends Request {
  user?: { id: string; email?: string };
  authMethod?: 'session' | 'api_key';
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Validates a kx_live_/kx_test_ API key generated from AI Lab's Key Vault
 * (src/lib/apiKeys.js). The key itself is never stored — only its SHA-256
 * hash — so we hash the incoming key the same way and look up the match.
 * Uses supabaseAdmin (service role) deliberately: at this point we don't
 * yet know which user the key belongs to, so there's no auth.uid() for
 * api_keys' RLS policies to compare against — a normal client can only
 * ever see rows it already knows are its own.
 */
async function tryApiKeyAuth(req: AuthedRequest, token: string): Promise<boolean> {
  if (!token.startsWith('kx_live_') && !token.startsWith('kx_test_')) return false;

  const keyHash = sha256Hex(token);
  const { data: key, error } = await supabaseAdmin
    .from('api_keys')
    .select('id, user_id, revoked_at')
    .eq('key_hash', keyHash)
    .maybeSingle();

  if (error || !key || key.revoked_at) return false;

  req.user = { id: key.user_id };
  req.authMethod = 'api_key';

  // Fire-and-forget — a slow/failed write here shouldn't block the request
  // this key is actually trying to make.
  supabaseAdmin.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', key.id).then(
    () => {},
    () => {}
  );

  return true;
}

/**
 * Verifies the caller's Supabase access token by asking Supabase itself
 * ("/auth/v1/user"). This avoids managing a JWT secret in this service —
 * Supabase already knows whether the token is valid, expired, or revoked.
 *
 * Also accepts a kx_live_/kx_test_ API key in the same header — checked
 * first since it's a fast local hash lookup, before falling back to a
 * network round-trip to Supabase for a real session token.
 *
 * Expects: Authorization: Bearer <supabase_access_token | kx_live_/kx_test_ API key>
 */
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing or malformed Authorization header.' });
    return;
  }

  const token = header.slice('Bearer '.length).trim();

  try {
    if (await tryApiKeyAuth(req, token)) {
      next();
      return;
    }

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
    req.authMethod = 'session';
    next();
  } catch (err) {
    res.status(503).json({ success: false, error: 'Could not verify session (auth service unreachable).' });
  }
}