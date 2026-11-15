import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isExpectedAccessError } from '../src/lib/expectedErrors';

test('permission refusals are expected, so Sentry skips them', () => {
  assert.equal(isExpectedAccessError(Object.assign(new Error('x'), { code: 'project_role_forbidden' })), true);
  assert.equal(isExpectedAccessError(new Error('You need viewer access to this project.')), true);
  assert.equal(isExpectedAccessError(new Error('You need editor access to this project.')), true);
  assert.equal(isExpectedAccessError(new Error('You are not a member of this project.')), true);
});

test('real failures are still reported', () => {
  assert.equal(isExpectedAccessError(new Error('listProjects failed: connection refused')), false);
  assert.equal(isExpectedAccessError(new Error('Internal error.')), false);
  assert.equal(isExpectedAccessError(null), false);
  assert.equal(isExpectedAccessError('You need viewer access to this project.'), false);
});
