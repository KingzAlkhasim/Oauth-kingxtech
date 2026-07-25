import { supabase } from './supabase';

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomKeyBody(length = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, length);
}

export async function listApiKeys() {
  return supabase.from('api_keys').select('*').order('created_at', { ascending: false });
}

/**
 * Generates a new key, stores only its hash + a display prefix, and
 * returns the full key ONCE so the UI can show a "copy it now" dialog —
 * the same pattern Stripe/GitHub use, since the raw key is never stored.
 */
export async function createApiKey({ name, environment = 'live' }) {
  const { data: userData } = await supabase.auth.getUser();
  const body = randomKeyBody(32);
  const fullKey = `kx_${environment}_${body}`;
  const keyHash = await sha256Hex(fullKey);
  const keyPrefix = `kx_${environment}_${body.slice(0, 4)}`;

  const { data, error } = await supabase
    .from('api_keys')
    .insert({ user_id: userData.user.id, name, environment, key_prefix: keyPrefix, key_hash: keyHash })
    .select()
    .single();

  return { data: data ? { ...data, fullKey } : null, error };
}

export async function revokeApiKey(id) {
  return supabase.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id);
}

export async function deleteApiKey(id) {
  return supabase.from('api_keys').delete().eq('id', id);
}
