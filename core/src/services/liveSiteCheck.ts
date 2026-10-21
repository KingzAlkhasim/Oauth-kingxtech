// Looks at a published site the way a visitor's browser would, without running its JavaScript:
// does the page load, do the files it points to exist and have the right type, and is there
// anything on it. Pure apart from the injected fetch, so it can be tested without a network.

export type FetchLike = (url: string, init?: { redirect?: 'manual' | 'follow'; signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Response>;

export interface ResourceRef { kind: 'script' | 'style' | 'image' | 'icon' | 'manifest'; ref: string }

export interface ResourceReport {
  kind: ResourceRef['kind'];
  ref: string;
  status: number | null;
  contentType: string | null;
  problem: string | null;
}

export interface LiveSiteReport {
  url: string;
  status: number | null;
  title: string | null;
  textPreview: string;
  resourcesChecked: number;
  externalHosts: string[];
  resources: ResourceReport[];
  problems: string[];
  notes: string[];
}

const MAX_RESOURCES = 15;
const MAX_HTML_CHARS = 500_000;

export function extractResources(html: string): ResourceRef[] {
  const found: ResourceRef[] = [];
  const seen = new Set<string>();
  const add = (kind: ResourceRef['kind'], ref: string | undefined) => {
    const value = (ref || '').trim();
    if (!value || /^(data:|blob:|javascript:|mailto:|tel:|#)/i.test(value)) return;
    const key = `${kind}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ kind, ref: value });
  };
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) add('script', m[1]);
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() ?? '';
    if (rel.includes('stylesheet')) add('style', href);
    else if (rel.includes('icon')) add('icon', href);
    else if (rel.includes('manifest')) add('manifest', href);
    else if (rel.includes('modulepreload')) add('script', href);
  }
  for (const m of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) add('image', m[1]);
  return found;
}

export function visibleText(html: string): string {
  return html
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expectedTypeProblem(kind: ResourceRef['kind'], contentType: string | null): string | null {
  const type = (contentType || '').toLowerCase();
  if (kind === 'script' && type && !/(javascript|ecmascript|wasm)/.test(type)) {
    return `served as "${type.split(';')[0]}" instead of JavaScript (usually a missing file answered by an HTML page)`;
  }
  if (kind === 'style' && type && !type.includes('css')) {
    return `served as "${type.split(';')[0]}" instead of CSS (usually a missing file)`;
  }
  return null;
}

async function getFollowingSameOrigin(fetchFn: FetchLike, url: string, origin: string): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 4; hop += 1) {
    const res = await fetchFn(current, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'KingxTech-SiteCheck/1.0' } });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      const next = location ? new URL(location, current) : null;
      if (!next || next.origin !== origin) return res;
      current = next.toString();
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects');
}

export async function inspectSite(pageUrl: string, fetchFn: FetchLike): Promise<LiveSiteReport> {
  const page = new URL(pageUrl);
  const report: LiveSiteReport = {
    url: pageUrl, status: null, title: null, textPreview: '', resourcesChecked: 0,
    externalHosts: [], resources: [], problems: [], notes: [],
  };

  let html = '';
  try {
    const res = await getFollowingSameOrigin(fetchFn, pageUrl, page.origin);
    report.status = res.status;
    if (res.status >= 400) report.problems.push(`The page itself returns HTTP ${res.status}.`);
    else if (res.status >= 300) report.problems.push(`The page redirects somewhere else (HTTP ${res.status}).`);
    html = (await res.text()).slice(0, MAX_HTML_CHARS);
  } catch (error) {
    report.problems.push(`The site could not be reached: ${error instanceof Error ? error.message : 'unknown error'}.`);
    return report;
  }
  if (report.status !== null && report.status >= 400) return report;

  report.title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim().slice(0, 150) || null;
  const text = visibleText(html);
  report.textPreview = text.slice(0, 500);

  const refs = extractResources(html);
  const external = new Set<string>();
  const toCheck: { ref: ResourceRef; url: URL }[] = [];
  for (const ref of refs) {
    let resolved: URL;
    try { resolved = new URL(ref.ref, page); } catch { report.problems.push(`A ${ref.kind} has an invalid address: ${ref.ref.slice(0, 120)}`); continue; }
    if (resolved.protocol === 'http:' && page.protocol === 'https:') {
      report.problems.push(`${ref.kind} "${ref.ref.slice(0, 120)}" uses http:// on an https site, so browsers will block it.`);
    }
    if (resolved.origin !== page.origin) { external.add(resolved.host); continue; }
    toCheck.push({ ref, url: resolved });
  }
  report.externalHosts = [...external].slice(0, 20);

  for (const { ref, url } of toCheck.slice(0, MAX_RESOURCES)) {
    const item: ResourceReport = { kind: ref.kind, ref: ref.ref, status: null, contentType: null, problem: null };
    try {
      const res = await getFollowingSameOrigin(fetchFn, url.toString(), page.origin);
      item.status = res.status;
      item.contentType = res.headers.get('content-type');
      await res.body?.cancel().catch(() => undefined);
      if (res.status >= 400) {
        item.problem = `returns HTTP ${res.status}`;
        if (ref.ref.startsWith('/') && !ref.ref.startsWith('//')) {
          item.problem += `. It starts with "/", so it is looked up at the site root instead of inside the project folder. For a Vite app set base: './' in vite.config`;
        }
      } else {
        item.problem = expectedTypeProblem(ref.kind, item.contentType);
      }
    } catch (error) {
      item.problem = `could not be loaded: ${error instanceof Error ? error.message : 'error'}`;
    }
    report.resources.push(item);
    if (item.problem) report.problems.push(`${ref.kind} "${ref.ref.slice(0, 120)}" ${item.problem}.`);
  }
  report.resourcesChecked = report.resources.length;
  if (toCheck.length > MAX_RESOURCES) report.notes.push(`Only the first ${MAX_RESOURCES} of ${toCheck.length} files on this site were checked.`);

  const hasScripts = refs.some((r) => r.kind === 'script') || /<script\b[^>]*>[\s\S]+?<\/script>/i.test(html);
  if (!text && !hasScripts) report.problems.push('The page has no visible text and no scripts, so visitors will see a blank page.');
  else if (!text && hasScripts) report.notes.push('The HTML has no visible text of its own, which is normal for a JavaScript app. Its content appears only after the scripts run, which this check cannot do, so verify the app itself in a browser.');
  if (!/<meta[^>]+name\s*=\s*["']viewport["']/i.test(html)) report.notes.push('No viewport meta tag, so the page may look zoomed out on phones.');
  if (report.externalHosts.length) report.notes.push(`Loads files from other sites: ${report.externalHosts.join(', ')} (not checked).`);
  return report;
}
