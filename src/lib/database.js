import { supabase } from './supabase';

export const KNOWN_TABLES = ['projects', 'api_keys', 'webhooks', 'support_tickets', 'activity_log', 'billing_profile', 'usage_log', 'custom_domains', 'env_vars'];

export async function runReadonlyQuery(query) {
  return supabase.rpc('run_readonly_query', { query });
}
