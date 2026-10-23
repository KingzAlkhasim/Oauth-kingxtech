import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldCountView, isBotUserAgent } from '../src/services/siteViewsPolicy';
import { buildStats } from '../src/services/siteViewStats';

const chrome = 'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const page = { method: 'GET', accept: 'text/html,application/xhtml+xml', userAgent: chrome, secFetchDest: 'document', path: '' };

test('a normal browser page load counts', () => {
  assert.equal(shouldCountView(page), true);
  assert.equal(shouldCountView({ ...page, path: 'about' }), true); // client-side route
  assert.equal(shouldCountView({ ...page, path: 'index.html' }), true);
  assert.equal(shouldCountView({ ...page, secFetchDest: undefined }), true); // older browsers
});

test('assets, prefetches, non-GET and iframes do not count', () => {
  assert.equal(shouldCountView({ ...page, path: 'assets/app.js', accept: '*/*', secFetchDest: 'script' }), false);
  assert.equal(shouldCountView({ ...page, path: 'logo.png' }), false);
  assert.equal(shouldCountView({ ...page, method: 'HEAD' }), false);
  assert.equal(shouldCountView({ ...page, method: 'POST' }), false);
  assert.equal(shouldCountView({ ...page, secFetchDest: 'iframe' }), false);
  assert.equal(shouldCountView({ ...page, accept: 'application/json' }), false);
});

test('bots, tools and our own site checker do not count', () => {
  for (const ua of ['Googlebot/2.1', 'facebookexternalhit/1.1', 'curl/8.4.0', 'KingxTech-SiteCheck/1.0', 'WhatsApp link preview', 'python-requests/2.31', '']) {
    assert.equal(isBotUserAgent(ua), true, ua);
    assert.equal(shouldCountView({ ...page, userAgent: ua }), false, ua);
  }
  assert.equal(isBotUserAgent(chrome), false);
});

test('stats add up today, 7 days, 30 days and fill missing days with zero', () => {
  const now = new Date('2026-10-23T12:00:00Z');
  const stats = buildStats([
    { day: '2026-10-23', views: 5 },
    { day: '2026-10-20', views: 3 },
    { day: '2026-10-10', views: 10 },
    { day: '2026-08-01', views: 100 },
  ], now);
  assert.equal(stats.today, 5);
  assert.equal(stats.last7, 8);
  assert.equal(stats.last30, 18);
  assert.equal(stats.total, 118);
  assert.equal(stats.daily.length, 14);
  assert.deepEqual(stats.daily[13], { day: '2026-10-23', views: 5 });
  assert.deepEqual(stats.daily[12], { day: '2026-10-22', views: 0 });
});
