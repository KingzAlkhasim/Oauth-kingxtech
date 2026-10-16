import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeInternalPath } from '../../src/lib/safeRedirect.js';

test('safeInternalPath rejects unsafe redirects', () => {
  assert.equal(safeInternalPath('//evil.com'), null);
  assert.equal(safeInternalPath('/\\evil.com'), null);
  assert.equal(safeInternalPath('/\t/evil.com'), null);
  assert.equal(safeInternalPath('https://evil.com'), null);
  assert.equal(safeInternalPath('javascript:alert(1)'), null);
});

test('safeInternalPath accepts valid internal paths', () => {
  assert.equal(safeInternalPath('/invite/abc%2F123'), '/invite/abc%2F123');
  assert.equal(safeInternalPath('/projects'), '/projects');
});
