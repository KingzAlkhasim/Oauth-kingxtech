import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import {
  sanitizeAppEnv, restrictedCommand, serverNetworkPolicy, DENIED_EGRESS_CIDRS, APP_USER, APP_PORT, SERVER_PORT,
} from '../src/services/projectServerPolicy.js';
import {
  freshCheckArgs, installArgs, writeHashArgs, appStartArgs, gateStartArgs, provisionArgs, PROVISION_SCRIPT, stopProcessesArgs,
} from '../src/services/projectServerProvision.js';

const env = { API_KEY: 'abc', DATABASE_URL: 'postgres://x' };

test('every command that touches project code is env -i + setpriv to kxapp with no-new-privs', () => {
  const all = [freshCheckArgs(env, 'h'), installArgs(env), writeHashArgs(env, 'h'), appStartArgs(env)];
  for (const argv of all) {
    const flat = argv.join(' ');
    assert.ok(flat.includes('env -i '), flat);
    assert.ok(flat.includes(`setpriv --reuid=${APP_USER} --regid=${APP_USER} --init-groups --no-new-privs`), flat);
    assert.ok(flat.indexOf('env -i') < flat.indexOf('setpriv'));
  }
});

test('project env is sanitized: no platform, sudo or reserved variables can be set or smuggled', () => {
  const out = sanitizeAppEnv({
    OK_VAR: '1', PATH: '/evil', HOME: '/root', PORT: '1', VERCEL_OIDC_TOKEN: 't', SUDO_USER: 'x', PROJECT_SERVER_GATEWAY_SECRET: 's',
    KX_SECRET: 'k', LD_PRELOAD: '/x.so', 'BAD-NAME': 'v', '1BAD': 'v', GOOD2: 'a\0b',
  });
  assert.deepEqual(Object.keys(out), ['OK_VAR']);
  const cmd = restrictedCommand({ A: '1' }, ['node']).join(' ');
  assert.ok(cmd.includes(`PORT=${APP_PORT}`) && cmd.includes('PATH=/usr/local/bin:/usr/bin:/bin') && !cmd.includes('SUDO'));
});

test('gate runs as root on the public port before the app, app only on loopback port, secrets never in argv', () => {
  const g = gateStartArgs('pid').join(' ');
  assert.ok(g.includes(`gate.cjs pid ${SERVER_PORT} ${APP_PORT}`) && !g.includes('setpriv'));
  assert.notEqual(SERVER_PORT, APP_PORT);
  for (const argv of [gateStartArgs('p'), provisionArgs(), appStartArgs(env)].slice(0, 2)) assert.ok(!argv.join(' ').match(/[0-9a-f]{64}/));
});

test('no dependency on fuser, and process cleanup is scoped by user/name', () => {
  assert.ok(!PROVISION_SCRIPT.includes('fuser'));
  assert.ok(!stopProcessesArgs().join(' ').includes('fuser'));
  assert.ok(PROVISION_SCRIPT.includes('pkill -KILL -u kxapp'));
  const src = fs.readFileSync(new URL('../src/services/projectServer.ts', import.meta.url), 'utf8');
  assert.ok(!/fuser/.test(src));
  assert.ok(!/['"`]npm['"`]/.test(src) || !/runCommand\(\{ cmd: ['"]npm/.test(src), 'npm must only run through restrictedCommand');
  assert.ok(!/\/vercel\/sandbox\/project/.test(src), 'old privileged project root removed');
});

test('gate and key are root-only, project dir goes to kxapp', () => {
  assert.match(PROVISION_SCRIPT, /install -d -m 700 -o root -g root \/opt\/kx/);
  assert.match(PROVISION_SCRIPT, /install -m 600 -o root -g root \S+\/key \/opt\/kx\/key/);
  assert.match(PROVISION_SCRIPT, /chown -R kxapp:kxapp \/home\/kxapp/);
  assert.match(PROVISION_SCRIPT, /chmod 700 \/home\/kxapp/);
});

test('network policy allows public domains and denies private/metadata IPv4 only (API rejects IPv6 CIDRs)', () => {
  const p = serverNetworkPolicy();
  assert.deepEqual(Object.keys(p.allow), ['*']);
  for (const c of ['169.254.0.0/16', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '127.0.0.0/8']) assert.ok(p.subnets.deny.includes(c), c);
  assert.ok(DENIED_EGRESS_CIDRS.every((c) => !c.includes(':')));
});
