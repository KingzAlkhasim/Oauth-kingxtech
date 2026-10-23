// Pure rules for deciding whether a request to a published site is a real page view.
// No cookies, no IP addresses and no user identifiers are used or stored.

const BOT_PATTERN = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|aiohttp|go-http-client|node-fetch|axios|okhttp|java\/|libwww|httpclient|kingxtech-sitecheck|vercel-|scrapy|postman/i;

export function isBotUserAgent(userAgent: string | undefined): boolean {
  if (!userAgent || userAgent.trim().length < 8) return true; // real browsers always send a proper UA
  return BOT_PATTERN.test(userAgent);
}

export interface ViewRequest {
  method: string;
  accept?: string;
  userAgent?: string;
  secFetchDest?: string;
  path: string; // path inside the site, e.g. '', 'about', 'index.html', 'assets/app.js'
}

function looksLikePage(path: string): boolean {
  const clean = path.split('?')[0].replace(/^\/+/, '');
  if (clean === '' || clean.endsWith('/')) return true;
  const last = clean.split('/').pop() || '';
  if (!last.includes('.')) return true; // client-side route
  return /\.html?$/i.test(last);
}

/** True only for a person's browser loading an HTML page (not images, scripts, bots, or prefetches). */
export function shouldCountView(req: ViewRequest): boolean {
  if (req.method !== 'GET') return false;
  if (!(req.accept || '').includes('text/html')) return false;
  if (req.secFetchDest && req.secFetchDest !== 'document') return false;
  if (isBotUserAgent(req.userAgent)) return false;
  return looksLikePage(req.path);
}
