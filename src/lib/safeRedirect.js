const AUTH_ORIGIN = 'https://auth.kingxtech.name.ng';
const UNSAFE_CHARACTERS = /[\\\\\u0000-\u001f\u007f\s]/;
const SSO_HOSTS = new Set([
  'kingxtech.name.ng',
  'kxpertai.kingxtech.name.ng',
  'synthcode.kingxtech.name.ng',
  'auth.kingxtech.name.ng',
]);

export function safeInternalPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  if (UNSAFE_CHARACTERS.test(value)) return null;

  try {
    return new URL(value, AUTH_ORIGIN).origin === AUTH_ORIGIN ? value : null;
  } catch {
    return null;
  }
}

export function safeSsoTarget(value) {
  if (typeof value !== 'string' || UNSAFE_CHARACTERS.test(value)) return null;

  const normalized = value.startsWith('http') ? value : `https://${value}`;
  try {
    const url = new URL(normalized);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !SSO_HOSTS.has(url.hostname)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
