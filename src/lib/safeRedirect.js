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
