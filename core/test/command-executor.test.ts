import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildChildEnv, isPathInsideRoot, validateCommand } from '../src/services/commandExecutor.js';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kx-exec-')));
fs.mkdirSync(path.join(root, 'src'));
fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'x');
fs.writeFileSync(path.join(root, '.env'), 'SECRET=1');
fs.symlinkSync('/etc', path.join(root, 'escape'));

const ok = (cmd: string, args: string[]) => assert.deepEqual(validateCommand(cmd, args, root), { ok: true }, `${cmd} ${args.join(' ')}`);
const bad = (cmd: string, args: string[]) => assert.equal(validateCommand(cmd, args, root).ok, false, `${cmd} ${args.join(' ')}`);

test('blocks reading files outside the project through git (the secrets-leak route)', () => {
  bad('git', ['diff', '--no-index', '/proc/self/environ', '/dev/null']);
  bad('git', ['diff', '--no-ind', '/proc/self/environ', '/dev/null']); // abbreviated option
  bad('git', ['diff', '/etc/passwd', '/dev/null']);
  bad('git', ['log', '-p', '--', '/etc/passwd']);
  bad('git', ['diff', '../secret']);
});

test('blocks dangerous git flags and branch mutation', () => {
  bad('git', ['diff', '--output', 'x']);
  bad('git', ['diff', '--ext-diff']);
  bad('git', ['log', '--textconv']);
  bad('git', ['-c', 'core.pager=sh', 'log']);
  bad('git', ['branch', '-D', 'main']);
  bad('git', ['branch', 'new-branch']);
  bad('git', ['checkout', 'main']);
  bad('git', ['push']);
});

test('allows normal read-only git use', () => {
  ok('git', ['status']);
  ok('git', ['status', '--short']);
  ok('git', ['log', '--oneline', '-5']);
  ok('git', ['diff', '--stat']);
  ok('git', ['diff', '--', 'src/a.ts']);
  ok('git', ['branch', '--list']);
  ok('git', ['--version']);
});

test('blocks secrets, git internals and symlink escapes', () => {
  assert.equal(isPathInsideRoot(root, '.env'), false);
  assert.equal(isPathInsideRoot(root, '.git/config'), false);
  assert.equal(isPathInsideRoot(root, 'escape/passwd'), false);
  assert.equal(isPathInsideRoot(root, 'src/a.ts'), true);
  bad('ls', ['escape']);
  bad('ls', ['.env']);
  bad('ls', ['/']);
  bad('ls', ['-R']);
  ok('ls', ['-la', 'src']);
  ok('ls', []);
});

test('npm is limited to lint, test, typecheck and listing', () => {
  ok('npm', ['test']);
  ok('npm', ['run', 'lint']);
  ok('npm', ['run', 'typecheck']);
  ok('npm', ['ls', '--depth', '0']);
  bad('npm', ['run', 'build']);
  bad('npm', ['run', 'lint', '--', '--fix']);
  bad('npm', ['install']);
  bad('npm', ['exec', 'x']);
  bad('npm', ['test', 'extra']);
  bad('npm', ['publish']);
});

test('rejects unknown commands and shell-style input', () => {
  bad('rm', ['-rf', '/']);
  bad('cat', ['src/a.ts']);
  bad('curl', ['http://example.com']);
  bad('ls', ['src; cat .env']);
  bad('ls', ['$(whoami)']);
  bad('node', ['-e', 'process.exit()']);
  bad('git', ['status', 'a'.repeat(300)]);
});

test('child process never inherits server secrets', () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret';
  process.env.OPENAI_API_KEY = 'sk-secret';
  const env = buildChildEnv();
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.ok(env.PATH);
});
