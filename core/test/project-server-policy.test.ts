import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildForwardHeaders, cleanServerPath, cleanQueryString, cleanResponseHeaders, startCommandProblem, planAllowsServer } from '../src/services/projectServerPolicy.js';

test('paths cannot climb out or smuggle', () => {
  assert.equal(cleanServerPath('/hello/world'), '/hello/world');
  assert.equal(cleanServerPath(''), '/');
  assert.equal(cleanServerPath('//a///b/'), '/a/b');
  for (const bad of ['/../etc/passwd', '/a/%2e%2e/b', '/a/./b', '/a\\b', '/a%00b', '/%zz', '/' + 'x'.repeat(1100)]) assert.equal(cleanServerPath(bad), null, bad);
  assert.equal(cleanServerPath('/a b'), '/a%20b');
});

test('query strings pass through but control characters are dropped', () => {
  assert.equal(cleanQueryString('/x?a=1&b=2'), '?a=1&b=2');
  assert.equal(cleanQueryString('/x'), '');
  assert.equal(cleanQueryString('/x?a=1\r\nHost: evil'), '');
});

test('cookies and internal headers are never forwarded', () => {
  const h = buildForwardHeaders({ cookie: 'sb=secret', 'content-type': 'application/json', authorization: 'Bearer t', host: 'x', 'x-vercel-id': '1' }, '1.2.3.4');
  assert.equal(h.cookie, undefined); assert.equal(h.host, undefined); assert.equal(h['x-vercel-id'], undefined);
  assert.equal(h['content-type'], 'application/json'); assert.equal(h.authorization, 'Bearer t'); assert.equal(h['x-forwarded-for'], '1.2.3.4');
});

test('responses lose cookies and redirects and are sandboxed', () => {
  const out = cleanResponseHeaders([['Set-Cookie', 'a=b'], ['Location', 'https://evil'], ['Content-Type', 'text/html'], ['Access-Control-Allow-Origin', 'https://x'], ['X-Custom', 'ok']]);
  assert.equal(out['set-cookie'], undefined); assert.equal(out.location, undefined); assert.equal(out['access-control-allow-origin'], undefined);
  assert.equal(out['content-type'], 'text/html'); assert.equal(out['x-custom'], 'ok');
  assert.match(out['content-security-policy'], /^sandbox/); assert.equal(out['x-content-type-options'], 'nosniff');
});

test('start script and plan checks', () => {
  assert.equal(startCommandProblem('{"scripts":{"start":"node server.js"}}'), null);
  assert.ok(startCommandProblem(null)); assert.ok(startCommandProblem('{')); assert.ok(startCommandProblem('{"scripts":{"dev":"x"}}'));
  assert.equal(planAllowsServer('pro'), true); assert.equal(planAllowsServer('pro_plus'), true);
  assert.equal(planAllowsServer('free'), false); assert.equal(planAllowsServer(undefined), false);
});
