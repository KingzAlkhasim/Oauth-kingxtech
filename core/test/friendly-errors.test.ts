import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-ignore plain JS module shared with the frontend
import { friendlyError } from '../../src/lib/errors.js';

test('network failures become a connection message', () => {
  for (const m of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed']) {
    assert.match(friendlyError(new TypeError(m)), /Could not reach KingxTech/);
  }
  assert.match(friendlyError({ name: 'AuthRetryableFetchError', message: 'x' }), /Could not reach/);
});

test('non-JSON gateway pages and expired sessions are explained', () => {
  assert.match(friendlyError(new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON")), /unexpected reply/);
  assert.match(friendlyError({ message: 'JWT expired' }), /session expired/);
});

test('database errors become plain sentences', () => {
  assert.match(friendlyError({ message: 'new row violates row-level security policy for table "projects"', code: '42501' }), /permission/);
  assert.match(friendlyError({ message: 'duplicate key value violates unique constraint "projects_slug_key"', code: '23505' }), /already taken/);
  assert.match(friendlyError({ message: 'relation "public.env_vars" does not exist' }), /not fully set up/);
});

test('readable messages pass through unchanged', () => {
  assert.equal(friendlyError({ message: 'Invalid login credentials' }), 'Invalid login credentials');
  assert.equal(friendlyError('That domain is already connected to another project.'), 'That domain is already connected to another project.');
});

test('empty, object-like or stack-trace messages use the fallback', () => {
  assert.equal(friendlyError({ message: '' }, 'Could not save.'), 'Could not save.');
  assert.equal(friendlyError({ message: '[object Object]' }), 'Something went wrong. Please try again.');
  assert.equal(friendlyError({ message: 'x'.repeat(400) }, 'Fallback'), 'Fallback');
  assert.equal(friendlyError({ message: 'Error at foo (/app/a.js:10:5)' }, 'Fallback'), 'Fallback');
});

test('runtime capacity errors are explained in plain words', () => {
  const msg = friendlyError(new Error('Status code 402 is not ok: Hobby plan usage limit exceeded for Snapshots Storage. Limit will be reset on 2026-11-01T00:00:00.000Z.'));
  assert.match(msg, /not a problem with your account/);
  assert.doesNotMatch(msg, /Hobby/);
});
