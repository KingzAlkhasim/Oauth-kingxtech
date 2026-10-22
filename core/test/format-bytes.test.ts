import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-ignore plain JS module shared with the frontend
import { formatBytes } from '../../src/lib/formatBytes.js';

test('formats sizes for people', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1024 * 1024), '1 MB');
  assert.equal(formatBytes(3.2 * 1024 * 1024), '3.2 MB');
  assert.equal(formatBytes(250 * 1024 * 1024), '250 MB');
});

test('bad input is zero', () => {
  assert.equal(formatBytes(undefined), '0 B');
  assert.equal(formatBytes(-5), '0 B');
  assert.equal(formatBytes('abc'), '0 B');
});
