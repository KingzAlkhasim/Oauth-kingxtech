import { supabase } from './supabase';
import { safeSsoTarget } from './safeRedirect';

/**
 * Redirects the browser to another KingxTech product, handing off the current
 * Supabase session via the URL fragment (never sent to servers, same pattern
 * Supabase itself uses for magic-link / OAuth implicit flow).
 *
 * `target` is whatever the `redirect` query param carries — usually just a
 * host (e.g. "synthcode.kingxtech.name.ng") but a host+path also works.
 *
 * The receiving app must call `completeSsoHandoff()` (see
 * public/sso-client-kit/kingxtech-sso.js) on load to pick the tokens up and
 * turn them into its own local session.
 */
export async function redirectWithSession(target) {
  const safeTarget = safeSsoTarget(target);
  if (!safeTarget) return;

  const { data } = await supabase.auth.getSession();
  const session = data.session;

  const url = new URL(safeTarget);
  if (session) {
    url.hash =
      `access_token=${session.access_token}` +
      `&refresh_token=${session.refresh_token}` +
      `&expires_in=${session.expires_in}` +
      `&token_type=bearer`;
  }
  window.location.href = url.toString();
}
