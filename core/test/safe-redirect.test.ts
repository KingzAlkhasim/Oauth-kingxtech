import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeInternalPath, safeSsoTarget } from '../../src/lib/safeRedirect.js';

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

test('safeSsoTarget accepts only the exact approved product hosts', () => {
  const hosts = [
    'kingxtech.name.ng',
    'kxpertai.kingxtech.name.ng',
    'synthcode.kingxtech.name.ng',
    'auth.kingxtech.name.ng',
  ];

  for (const host of hosts) {
    assert.equal(safeSsoTarget(host), \`https://\${host}/\`);
    assert.equal(safeSsoTarget(\`https://\${host}\`), \`https://\${host}/\`);
    assert.equal(safeSsoTarget(\`https://\${host}/some/path?x=1\`), \`https://\${host}/some/path?x=1\`);
  }
});

test('safeSsoTarget rejects non-allowlisted hosts and unsafe URLs', () => {
  for (const value of [
    'evil.com',
    'kingxtech.name.ng.evil.com',
    'evilkingxtech.name.ng',
    'https://kingxtech.name.ng@evil.com',
    'http://x.kingxtech.name.ng',
    'https://x.kingxtech.name.ng:8443',
    'javascript:alert(1)',
    'kingxtech.name.ng\\@evil.com',
    'kxpertai.kingxtech.name.ng\t/evil.com',
    'kxpertai.kingxtech.name.ng\n/evil.com',
    'site.kingxtech.name.ng',
    'https://site.kingxtech.name.ng/evil/',
    'anything.kingxtech.name.ng',
    'x.kxpertai.kingxtech.name.ng',
  ]) {
    assert.equal(safeSsoTarget(value), null, \`expected rejection for \${JSON.stringify(value)}\`);
  }
});
