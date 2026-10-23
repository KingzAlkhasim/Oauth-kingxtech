import assert from 'node:assert/strict';
import test from 'node:test';
import { canWrite, formatMb, isCountedPath, storageFullMessage, storageLimitFor, STORAGE_LIMIT_BYTES } from '../src/services/storageQuota';

const MB = 1024 * 1024;

test('limits grow with the plan', () => {
  assert.ok(storageLimitFor('free') < storageLimitFor('pro'));
  assert.ok(storageLimitFor('pro') < storageLimitFor('pro_plus'));
  assert.equal(storageLimitFor('free'), STORAGE_LIMIT_BYTES.free);
});

test('writes that fit are allowed, writes that overflow are not', () => {
  const limit = 10 * MB;
  assert.equal(canWrite({ limit, usedBytes: 5 * MB, existingBytes: 0, newBytes: 4 * MB }), true);
  assert.equal(canWrite({ limit, usedBytes: 9 * MB, existingBytes: 0, newBytes: 2 * MB }), false);
  assert.equal(canWrite({ limit, usedBytes: 10 * MB, existingBytes: 0, newBytes: 1 }), false);
});

test('replacing a file only counts the growth', () => {
  const limit = 10 * MB;
  assert.equal(canWrite({ limit, usedBytes: 10 * MB, existingBytes: 3 * MB, newBytes: 3 * MB }), true);
  assert.equal(canWrite({ limit, usedBytes: 9 * MB, existingBytes: 3 * MB, newBytes: 4 * MB }), true);
  assert.equal(canWrite({ limit, usedBytes: 10 * MB, existingBytes: 3 * MB, newBytes: 3 * MB + 1 }), false);
});

test('people who are over the limit can always shrink or edit down', () => {
  assert.equal(canWrite({ limit: 10 * MB, usedBytes: 30 * MB, existingBytes: 5 * MB, newBytes: 2 * MB }), true);
  assert.equal(canWrite({ limit: 10 * MB, usedBytes: 30 * MB, existingBytes: 0, newBytes: 1 }), false);
});

test('builds and verification folders do not count', () => {
  assert.equal(isCountedPath('src/App.jsx'), true);
  assert.equal(isCountedPath('.kingxtech-dist/index.html'), false);
  assert.equal(isCountedPath('.kx-verify-dist/a.js'), false);
});

test('messages are plain and mention the plan and upgrade path', () => {
  assert.match(storageFullMessage('free', 25 * MB), /Free plan includes 25 MB/);
  assert.match(storageFullMessage('free', 25 * MB), /upgrade/);
  assert.doesNotMatch(storageFullMessage('pro_plus', 1024 * MB), /upgrade/);
  assert.equal(formatMb(1024 * MB), '1 GB');
  assert.equal(formatMb(250 * MB), '250 MB');
});
