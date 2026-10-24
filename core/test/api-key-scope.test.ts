import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAllowedForApiKey } from '../src/services/apiKeyScope';

test('API keys may call the public AI API', () => {
  assert.equal(isAllowedForApiKey('/api/v1/models'), true);
  assert.equal(isAllowedForApiKey('/api/v1/chat/completions'), true);
  assert.equal(isAllowedForApiKey('/api/v1/chat/completions/'), true);
  assert.equal(isAllowedForApiKey('/api/v1/models?x=1'), true);
});

test('API keys cannot reach anything else', () => {
  for (const p of [
    '/api/ai/generate',
    '/api/projects/abc/publish',
    '/api/projects/abc/terminal',
    '/api/projects/abc/file',
    '/api/projects/abc/env',
    '/api/domains',
    '/api/billing/paystack/topup',
    '/api/account/export',
    '/api/admin/flags/1/warn',
    '/api/github/token',
    '/api/v1/',
    '/api/v1/models/extra',
    '/api/v1/../projects/abc/file',
    '/api/v1/chat/completions%2f..%2f..',
    '',
  ]) assert.equal(isAllowedForApiKey(p), false, p);
});
