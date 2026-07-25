/**
 * KingxTech SSO client kit
 * ------------------------
 * Drop this into any KingxTech product (K-XpertAI, SynthCode IDE, KX Cloud, …)
 * that uses Supabase for auth. It handles both directions of the SSO flow:
 *
 *   1. completeSsoHandoff(supabase)
 *      Call once on app load. If the user just arrived from
 *      auth.kingxtech.name.ng with tokens in the URL fragment, this turns
 *      them into a real local Supabase session and cleans the URL.
 *
 *   2. requireAuth(supabase)
 *      Call to gate a page/route. If there's no session (and the handoff
 *      above didn't produce one), sends the user to
 *      auth.kingxtech.name.ng/login?redirect=<this app>, and back again
 *      once they've signed in.
 *
 * Requires zero dependencies beyond an already-configured @supabase/supabase-js
 * client using the SAME Supabase project as auth.kingxtech.name.ng.
 */

const AUTH_HOST = 'auth.kingxtech.name.ng';

/**
 * Pick up an access/refresh token pair from the URL fragment (if present),
 * establish a local Supabase session from it, and strip the fragment so the
 * tokens don't linger in the address bar or browser history.
 *
 * Returns true if a handoff was completed, false if there was nothing to do.
 */
export async function completeSsoHandoff(supabase) {
  const hash = window.location.hash;
  if (!hash || !hash.includes('access_token')) return false;

  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) return false;

  const { error } = await supabase.auth.setSession({ access_token, refresh_token });

  // Clean the fragment regardless of outcome — never leave tokens in the URL.
  window.history.replaceState({}, document.title, window.location.pathname + window.location.search);

  return !error;
}

/**
 * Ensure there's an active session, redirecting to the centralized login
 * if not. Call this after completeSsoHandoff() has had a chance to run.
 */
export async function requireAuth(supabase, { path = window.location.pathname } = {}) {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;

  const here = `${window.location.host}${path}`;
  window.location.href = `https://${AUTH_HOST}/login?redirect=${encodeURIComponent(here)}`;
  return null;
}

/**
 * Send the user to another KingxTech product, carrying the current session
 * with them the same way auth.kingxtech.name.ng does. Use this for any
 * in-app "switch to SynthCode" / "open K-XpertAI" links.
 */
export async function handoffTo(supabase, targetHost, path = '/') {
  const { data } = await supabase.auth.getSession();
  const session = data.session;

  const url = new URL(`https://${targetHost}${path}`);
  if (session) {
    url.hash =
      `access_token=${session.access_token}` +
      `&refresh_token=${session.refresh_token}` +
      `&expires_in=${session.expires_in}` +
      `&token_type=bearer`;
  }
  window.location.href = url.toString();
}

/**
 * Typical bootstrap for a KingxTech product's entrypoint:
 *
 *   import { supabase } from './lib/supabase';
 *   import { bootstrapSso } from './kingxtech-sso';
 *
 *   bootstrapSso(supabase).then((session) => {
 *     if (session) renderApp(session);
 *   });
 *
 * Resolves to the session if the user ends up authenticated, or null if
 * they were redirected to the login page (in which case nothing else
 * should render — the browser is navigating away).
 */
export async function bootstrapSso(supabase, opts) {
  await completeSsoHandoff(supabase);
  return requireAuth(supabase, opts);
}
