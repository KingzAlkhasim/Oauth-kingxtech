// Single API origin for the KingxTech frontend.
// Production should point this at the Vercel-hosted KX-NeuroCore service.
// Keep this as a Vite public value only: it must NEVER contain API secrets.
export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

// Public site origin for browser-facing previews and published sites.
export const PUBLIC_SITE_BASE = (
  import.meta.env.VITE_PUBLIC_SITE_BASE_URL || 'https://site.kingxtech.name.ng'
).replace(/\/+$/, '');

export function apiUrl(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${normalized}`;
}

export function siteUrl(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${PUBLIC_SITE_BASE}${normalized}`;
}
