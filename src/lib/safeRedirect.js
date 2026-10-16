const AUTH_ORIGIN = 'https://auth.kingxtech.name.ng';
const UNSAFE_CHARACTERS = /[\\\u0000-\u001f\u007f\s]/;

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
      !(url.hostname === 'kingxtech.name.ng' || url.hostname.endsWith('.kingxtech.name.ng'))
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
