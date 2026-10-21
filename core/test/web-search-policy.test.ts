import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanResults, dailySearchLimit, looksLikeSecret, normalizeQuery } from '../src/services/webSearchPolicy';

test('daily limits grow with the plan', () => {
  assert.equal(dailySearchLimit('free'), 5);
  assert.equal(dailySearchLimit('pro'), 30);
  assert.equal(dailySearchLimit('pro_plus'), 100);
  assert.equal(dailySearchLimit('anything-else'), 5);
});

test('queries that look like secrets are never sent', () => {
  for (const q of [
    'why does sk-proj-abcdefghijklmnop1234 fail',
    'error with key kx_live_abcdef123456',
    'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0 invalid',
    'AKIAABCDEFGHIJKLMNOP access denied',
    'ghp_abcdefghijklmnopqrstuvwxyz1234 token',
    '-----BEGIN RSA PRIVATE KEY----- fix',
  ]) assert.equal(looksLikeSecret(q), true, q);
  for (const q of ['vite 7 migration guide', 'how to rotate an API key safely', 'supabase row level security policy']) {
    assert.equal(looksLikeSecret(q), false, q);
  }
});

test('queries are trimmed, capped and must be real text', () => {
  assert.equal(normalizeQuery('  react   19  release  '), 'react 19 release');
  assert.equal(normalizeQuery('x'), null);
  assert.equal(normalizeQuery(42), null);
  assert.equal(normalizeQuery('a'.repeat(500))?.length, 200);
});

test('results keep only https links with short text', () => {
  const cleaned = cleanResults([
    { title: 'Vite docs', url: 'https://vite.dev/guide', content: 'x'.repeat(2000) },
    { title: 'Plain http', url: 'http://example.com', content: 'no' },
    { title: 'JS link', url: 'javascript:alert(1)', content: 'no' },
    { url: 'https://a.dev', content: 'no title' },
    null,
    'junk',
  ]);
  assert.deepEqual(cleaned.map((r) => r.url), ['https://vite.dev/guide', 'https://a.dev']);
  assert.equal(cleaned[0].snippet.length, 600);
  assert.equal(cleaned[1].title, 'https://a.dev');
});

test('at most five results are returned and bad input gives none', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ title: `t${i}`, url: `https://s${i}.dev`, content: 'c' }));
  assert.equal(cleanResults(many).length, 5);
  assert.deepEqual(cleanResults(undefined), []);
});
