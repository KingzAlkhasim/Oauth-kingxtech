import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-ignore plain JS module shared with the frontend
import { friendlyPublishError } from '../../src/lib/publishErrors.js';

test('network failures get a connection message, never the raw text', () => {
  const r = friendlyPublishError({ message: 'Failed to fetch', network: true });
  assert.match(r.title, /Could not reach/);
  assert.equal(r.details, '');
});

test('gateway timeouts explain that the first publish can be slow', () => {
  assert.match(friendlyPublishError({ message: 'Publish failed (504)', status: 504 }).hint, /few minutes/);
});

test('missing index.html tells people what to add', () => {
  const r = friendlyPublishError({ message: 'Static publishing requires an index.html file.' });
  assert.match(r.hint, /index\.html/);
});

test('install and build failures keep technical details, truncated', () => {
  const r = friendlyPublishError({ message: `Dependency install failed: ${'x'.repeat(2000)}` });
  assert.match(r.title, /packages/);
  assert.ok(r.details.length <= 601);
});

test('permission and session errors', () => {
  assert.match(friendlyPublishError({ message: 'no', status: 401 }).title, /session/);
  assert.match(friendlyPublishError({ message: 'Account suspended', status: 403 }).title, /turned off/);
});
