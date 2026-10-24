import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { KINGXTECH_API_KNOWLEDGE } from '../src/services/kingxtechApiKnowledge';

test('AI knowledge lists exactly the endpoints API keys may use', () => {
  const scope = readFileSync(new URL('../src/services/apiKeyScope.ts', import.meta.url), 'utf8');
  for (const path of scope.match(/\/api\/v1\/[a-z/]+/g) ?? []) {
    assert.ok(KINGXTECH_API_KNOWLEDGE.includes(path), `${path} missing from AI knowledge`);
  }
});

test('docs, AI knowledge and llms.txt agree on the base URL and rate limit', () => {
  const docs = readFileSync(new URL('../../src/docs/11-api.md', import.meta.url), 'utf8');
  const llms = readFileSync(new URL('../../public/llms.txt', import.meta.url), 'utf8');
  for (const text of [KINGXTECH_API_KNOWLEDGE, docs, llms]) {
    assert.ok(text.includes('https://site.kingxtech.name.ng'));
    assert.ok(/10 requests/.test(text));
  }
});
