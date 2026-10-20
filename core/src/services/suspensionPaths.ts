// Suspended accounts may still read their status, download their data and contact support.
const ALLOWED_WHEN_SUSPENDED = ['/api/account/status', '/api/account/export'];

export function isAllowedWhenSuspended(path: string): boolean {
  const clean = path.split('?')[0].replace(/\/+$/, '');
  return ALLOWED_WHEN_SUSPENDED.includes(clean);
}
