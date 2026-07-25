import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';

/**
 * Server-side Supabase client using the SERVICE ROLE key. This bypasses
 * Row Level Security entirely, so every query in this file MUST include an
 * explicit `.eq('user_id', userId)` filter — there is no RLS safety net
 * backing you up here like there is on the frontend's anon-key client.
 *
 * NEVER import this file, or send SUPABASE_SERVICE_ROLE_KEY, to the
 * frontend/browser bundle. It grants full read/write access to every
 * table regardless of ownership.
 */
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
