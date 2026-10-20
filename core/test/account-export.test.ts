import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { isAllowedWhenSuspended } from '../src/services/suspensionPaths';
import { projectFilesToZippable, safeName } from '../src/services/accountExportPure';
import { BINARY_PREFIX } from '../src/services/binaryFiles';

test('suspended accounts may only reach status and export', () => {
  assert.equal(isAllowedWhenSuspended('/api/account/status'), true);
  assert.equal(isAllowedWhenSuspended('/api/account/export'), true);
  assert.equal(isAllowedWhenSuspended('/api/account/export/'), true);
  assert.equal(isAllowedWhenSuspended('/api/account/export?x=1'), true);
  assert.equal(isAllowedWhenSuspended('/api/projects'), false);
  assert.equal(isAllowedWhenSuspended('/api/ai/chat'), false);
  assert.equal(isAllowedWhenSuspended('/api/account/status/../projects'), false);
});

test('safeName makes zip-safe names', () => {
  assert.equal(safeName('My Cool App!', 'x'), 'my-cool-app');
  assert.equal(safeName('../../etc', 'x'), 'etc');
  assert.equal(safeName('???', 'project'), 'project');
});

test('project files keep text and binary content and skip unsafe paths', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const zippable = projectFilesToZippable([
    { path: 'src/App.jsx', content: 'export default 1;' },
    { path: 'logo.png', content: BINARY_PREFIX + png.toString('base64') },
    { path: '../evil.txt', content: 'x' },
    { path: '/abs.txt', content: 'x' },
  ]);
  assert.deepEqual(Object.keys(zippable).sort(), ['logo.png', 'src/App.jsx']);
  const roundTrip = unzipSync(zipSync(zippable));
  assert.equal(strFromU8(roundTrip['src/App.jsx']), 'export default 1;');
  assert.deepEqual(Buffer.from(roundTrip['logo.png']), png);
});

test('each project zip nests inside the big zip', () => {
  const inner = zipSync({ 'a.txt': strToU8('hello') });
  const outer = zipSync({ 'projects/demo.zip': [inner, { level: 0 }] });
  const opened = unzipSync(unzipSync(outer)['projects/demo.zip']);
  assert.equal(strFromU8(opened['a.txt']), 'hello');
});
