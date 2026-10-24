// What an API key (kx_live_ / kx_test_) is allowed to call.
//
// Keys are for the public AI API only. They must never reach projects, files,
// the terminal, publishing, domains, billing or account settings, because keys
// are copied into other people's servers and can leak. Those need a real
// signed-in session. Exact matches only, so odd paths cannot sneak through.
const ALLOWED_FOR_API_KEYS = new Set(['/api/v1/models', '/api/v1/chat/completions']);

export function isAllowedForApiKey(path: string): boolean {
  const clean = String(path).split('?')[0].replace(/\/+$/, '');
  return ALLOWED_FOR_API_KEYS.has(clean);
}

export const API_KEY_SCOPE_MESSAGE =
  'API keys can only be used with the public AI API (/api/v1/models and /api/v1/chat/completions). Sign in to the app for anything else.';
