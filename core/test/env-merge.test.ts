import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeRuntimeEnv, isUsableEnvKey } from '../src/services/envMerge';

test('project variables win over account variables', () => {
  assert.deepEqual(
    mergeRuntimeEnv({ API_URL: 'account', ONLY_ACCOUNT: '1' }, { API_URL: 'project', ONLY_PROJECT: '2' }),
    { API_URL: 'project', ONLY_ACCOUNT: '1', ONLY_PROJECT: '2' },
  );
});

test('variables that change the shell or Node are dropped', () => {
  assert.deepEqual(mergeRuntimeEnv({ PATH: '/evil', node_options: '--require x', OK_KEY: 'v' }, { LD_PRELOAD: 'x' }), { OK_KEY: 'v' });
});

test('invalid names are dropped', () => {
  assert.equal(isUsableEnvKey('1BAD'), false);
  assert.equal(isUsableEnvKey('HAS SPACE'), false);
  assert.equal(isUsableEnvKey('VITE_API_URL'), true);
});
