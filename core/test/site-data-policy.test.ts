import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanCollectionName, cleanRow, cleanRules, cleanLimit, MAX_FIELDS } from '../src/services/siteDataPolicy.js';

test('collection names are strict', () => {
  assert.equal(cleanCollectionName('messages'), 'messages');
  assert.equal(cleanCollectionName('order-2'), 'order-2');
  for (const bad of ['', 'Messages', '1abc', 'a b', 'a/b', '../x', 'a'.repeat(41), 5, null]) assert.equal(cleanCollectionName(bad as any), null, String(bad));
});

test('records accept flat plain values only', () => {
  const ok = cleanRow({ name: 'Ada', age: 30, subscribed: true, note: null });
  assert.equal(ok.ok, true);
  assert.equal(cleanRow({ a: { b: 1 } }).ok, false);
  assert.equal(cleanRow({ a: [1] }).ok, false);
  assert.equal(cleanRow({ 'bad key': 1 }).ok, false);
  assert.equal(cleanRow({ __proto__x: 1 } as any).ok, false);
  assert.equal(cleanRow([1, 2]).ok, false);
  assert.equal(cleanRow(null).ok, false);
  assert.equal(cleanRow({}).ok, false);
  assert.equal(cleanRow({ n: Infinity }).ok, false);
});

test('size limits', () => {
  assert.equal(cleanRow({ big: 'x'.repeat(17000) }).ok, false);
  const many: Record<string, number> = {}; for (let i = 0; i <= MAX_FIELDS; i += 1) many[`f${i}`] = i;
  assert.equal(cleanRow(many).ok, false);
});

test('honeypot marks spam and is never stored', () => {
  const r = cleanRow({ name: 'bot', _hp: 'gotcha' });
  assert.equal(r.ok && r.spam, true);
  assert.equal(r.ok && '_hp' in r.data, false);
  const real = cleanRow({ name: 'Ada', _hp: '' });
  assert.equal(real.ok && real.spam, false);
});

test('rules default to closed and limit is clamped', () => {
  assert.deepEqual(cleanRules({}), { publicCreate: false, publicRead: false });
  assert.deepEqual(cleanRules({ publicCreate: 'yes', publicRead: 1 }), { publicCreate: false, publicRead: false });
  assert.deepEqual(cleanRules({ publicCreate: true }), { publicCreate: true, publicRead: false });
  assert.equal(cleanLimit(9999), 50); assert.equal(cleanLimit(-3), 1); assert.equal(cleanLimit('abc'), 20);
});
