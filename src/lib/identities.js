import { supabase } from './supabase';

/** Returns the list of OAuth identities actually linked to the current user. */
export async function getLinkedIdentities() {
  return supabase.auth.getUserIdentities();
}

export function findIdentity(identities, provider) {
  return identities?.find((i) => i.provider === provider) || null;
}

/**
 * Starts linking a new OAuth provider to the currently signed-in account.
 * Requires "manual linking" to be enabled in Supabase Dashboard →
 * Authentication → Providers (off by default) and the provider itself to be
 * configured — if it's not, this will surface a real Supabase error rather
 * than pretending to succeed.
 */
export async function linkProvider(provider, redirectTo) {
  return supabase.auth.linkIdentity({ provider, options: { redirectTo } });
}

export async function unlinkProvider(identity) {
  return supabase.auth.unlinkIdentity(identity);
}
