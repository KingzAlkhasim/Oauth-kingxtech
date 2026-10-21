import assert from 'node:assert/strict';
import test from 'node:test';
import { extractResources, inspectSite, visibleText, type FetchLike } from '../src/services/liveSiteCheck';

const BASE = 'https://site.kingxtech.name.ng/demo/';

function fakeFetch(files: Record<string, { status?: number; type?: string; body?: string; location?: string }>): FetchLike {
  return async (url) => {
    const f = files[url];
    if (!f) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    const headers: Record<string, string> = { 'content-type': f.type ?? 'text/html' };
    if (f.location) headers.location = f.location;
    return new Response(f.body ?? '', { status: f.status ?? 200, headers });
  };
}

test('extracts scripts, styles, icons, manifests and images and skips data urls', () => {
  const html = '<link rel="stylesheet" href="a.css"><link rel="icon" href="/f.ico"><link rel="manifest" href="m.json"><script type="module" src="./app.js"></script><img src="data:image/png;base64,xx"><img src="pic.png"><script src="a.js"></script><script src="a.js"></script>';
  assert.deepEqual(extractResources(html).map((r) => `${r.kind}:${r.ref}`), ['script:./app.js', 'script:a.js', 'style:a.css', 'icon:/f.ico', 'manifest:m.json', 'image:pic.png']);
});

test('visible text ignores scripts, styles and tags', () => {
  assert.equal(visibleText('<style>p{}</style><h1>Hi</h1><script>x()</script><p>there&nbsp;you</p>'), 'Hi there you');
});

test('a healthy site reports no problems', async () => {
  const report = await inspectSite(BASE, fakeFetch({
    [BASE]: { body: '<html><head><title>Shop</title><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="./style.css"></head><body><h1>Welcome</h1><script src="./app.js"></script></body></html>' },
    [`${BASE}style.css`]: { type: 'text/css' },
    [`${BASE}app.js`]: { type: 'application/javascript' },
  }));
  assert.deepEqual(report.problems, []);
  assert.equal(report.title, 'Shop');
  assert.equal(report.resourcesChecked, 2);
});

test('absolute asset paths that 404 are reported with the Vite fix', async () => {
  const report = await inspectSite(BASE, fakeFetch({
    [BASE]: { body: '<title>x</title><div id="root"></div><script type="module" src="/assets/index.js"></script>' },
  }));
  assert.ok(report.problems.some((p) => p.includes('/assets/index.js') && p.includes("base: './'")));
});

test('a script answered by an HTML page is called out', async () => {
  const report = await inspectSite(BASE, fakeFetch({
    [BASE]: { body: '<p>hi</p><script src="app.js"></script>' },
    [`${BASE}app.js`]: { type: 'text/html', body: '<html>fallback</html>' },
  }));
  assert.ok(report.problems.some((p) => p.includes('instead of JavaScript')));
});

test('a blank page with no scripts is a problem but a JS app shell is only a note', async () => {
  const blank = await inspectSite(BASE, fakeFetch({ [BASE]: { body: '<html><head></head><body></body></html>' } }));
  assert.ok(blank.problems.some((p) => p.includes('blank page')));
  const spa = await inspectSite(BASE, fakeFetch({
    [BASE]: { body: '<div id="root"></div><script src="app.js"></script>' },
    [`${BASE}app.js`]: { type: 'text/javascript' },
  }));
  assert.deepEqual(spa.problems, []);
  assert.ok(spa.notes.some((n) => n.includes('normal for a JavaScript app')));
});

test('other sites are listed but never fetched, and http on https is flagged', async () => {
  const seen: string[] = [];
  const base = fakeFetch({ [BASE]: { body: '<h1>x</h1><script src="https://cdn.example.com/lib.js"></script><img src="http://insecure.example.com/a.png">' } });
  const report = await inspectSite(BASE, async (url, init) => { seen.push(url); return base(url, init); });
  assert.deepEqual(seen, [BASE]);
  assert.ok(report.externalHosts.includes('cdn.example.com'));
  assert.ok(report.problems.some((p) => p.includes('http://')));
});

test('a 404 page and an unreachable site stop early with a clear problem', async () => {
  const missing = await inspectSite(BASE, fakeFetch({ [BASE]: { status: 404 } }));
  assert.deepEqual(missing.problems, ['The page itself returns HTTP 404.']);
  const down = await inspectSite(BASE, async () => { throw new Error('ECONNREFUSED'); });
  assert.ok(down.problems[0].includes('could not be reached'));
});

test('redirects to another site are not followed', async () => {
  const seen: string[] = [];
  const base = fakeFetch({ [BASE]: { status: 302, location: 'https://evil.example.com/' } });
  const report = await inspectSite(BASE, async (url, init) => { seen.push(url); return base(url, init); });
  assert.deepEqual(seen, [BASE]);
  assert.ok(report.problems[0].includes('redirects somewhere else'));
});
