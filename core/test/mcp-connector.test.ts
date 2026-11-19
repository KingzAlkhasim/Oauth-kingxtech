import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import express from 'express';
// The modules pull in the Supabase client, which validates env at import. Dummy values: no network call is made.
for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) process.env[k] ??= 'test-placeholder';
process.env.SUPABASE_URL ??= 'http://127.0.0.1:9';
const { oauthClientId, verifyMcpToken, isBlockedMcpPath, decodeJwtPayload } = require('../src/services/mcpAuth') as typeof import('../src/services/mcpAuth');
const { runMcpTool, McpToolError, MCP_TOOLS } = require('../src/services/mcpTools') as typeof import('../src/services/mcpTools');
const { createMcpRouter, handleRpc } = require('../src/services/mcpServer') as typeof import('../src/services/mcpServer');
const { requireAuth } = require('../src/middleware/auth') as typeof import('../src/middleware/auth');

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims: Record<string, unknown>) => `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`;
const APP_TOKEN = jwt({ sub: 'user-1', role: 'authenticated', client_id: 'claude-app' });
const USER_TOKEN = jwt({ sub: 'user-1', role: 'authenticated' });
const PID = '11111111-2222-4333-8444-555555555555';

test('tokens: only OAuth-app tokens carry a client id', () => {
  assert.equal(oauthClientId(APP_TOKEN), 'claude-app');
  assert.equal(oauthClientId(USER_TOKEN), null);
  assert.equal(oauthClientId('kx_live_abc'), null);
  assert.equal(oauthClientId('a.b.c'), null);
  assert.equal(decodeJwtPayload('nope'), null);
});

test('verifyMcpToken refuses ordinary session tokens without calling Supabase, and checks app tokens with it', async () => {
  let calls = 0;
  const fetchOk = (async () => { calls++; return { ok: true, json: async () => ({ id: 'user-1', email: 'a@b.c' }) }; }) as unknown as typeof fetch;
  assert.equal(await verifyMcpToken(USER_TOKEN, 'http://x', 'k', fetchOk), null);
  assert.equal(calls, 0);
  assert.deepEqual(await verifyMcpToken(APP_TOKEN, 'http://x', 'k', fetchOk), { userId: 'user-1', email: 'a@b.c', clientId: 'claude-app' });
  const fetchBad = (async () => ({ ok: false })) as unknown as typeof fetch;
  assert.equal(await verifyMcpToken(APP_TOKEN, 'http://x', 'k', fetchBad), null);
});

test('secrets and build output are off limits to AI apps', () => {
  for (const p of ['.env', '.env.local', 'app/.env.production', '.git/config', '.kingxtech-dist/index.html', '.kx-verify-dist/a.js']) assert.equal(isBlockedMcpPath(p), true, p);
  for (const p of ['.env.example', '.env.sample', 'src/App.jsx', 'environment.md', 'src/.envelope.js']) assert.equal(isBlockedMcpPath(p), false, p);
});

test('requireAuth refuses a connected-app token on the rest of the API', async () => {
  let status = 0; let body: any = null; let nextCalled = false;
  const res: any = { status(s: number) { status = s; return res; }, json(b: unknown) { body = b; return res; } };
  await requireAuth({ headers: { authorization: `Bearer ${APP_TOKEN}` }, originalUrl: '/api/projects' } as any, res, () => { nextCalled = true; });
  assert.equal(status, 403); assert.equal(body.code, 'oauth_app_scope'); assert.equal(nextCalled, false);
});

const calls: string[] = [];
const deps = {
  listProjects: async (u: string) => { calls.push(`list:${u}`); return [{ id: PID, name: 'Site', slug: 'site', status: 'active', role: 'owner', published: true, publishedAt: 'x' }]; },
  listFiles: async () => [{ path: 'a.js', is_folder: false, updated_at: 't' }, { path: '.env', is_folder: false, updated_at: 't' }, { path: '.kingxtech-dist/x', is_folder: false, updated_at: 't' }],
  readFile: async (_u: string, _p: string, path: string) => ({ path, content: path === 'logo.png' ? '__KX_BINARY_BASE64__:AAAA' : path === 'big.txt' ? 'x'.repeat(250_000) : path === 'dir' ? null : 'hello', updated_at: 't' }),
  writeFile: async (u: string, p: string, path: string, content: string) => { calls.push(`write:${u}:${p}:${path}:${content.length}`); },
  projectStatus: async () => ({ id: PID }),
  accountUsage: async () => ({ plan: 'free' }),
  siteSettings: async () => ({ installAsApp: false }),
  setInstallable: async (u: string, p: string, on: boolean) => { calls.push(`pwa:${u}:${p}:${on}`); },
  setAppIcon: async (u: string, p: string, svg: string) => { calls.push(`icon:${u}:${p}:${svg.length}`); return { publicUrl: 'https://x/icon.png' }; },
  listCollections: async () => [{ name: 'contacts', rows: 2, publicCreate: true, publicRead: false }],
  readRows: async () => [{ id: 'r1', data: { name: 'A' }, created_at: 't' }],
  setRules: async (_u: string, _p: string, collection: string, rules: { publicCreate: boolean; publicRead: boolean }) => { calls.push(`rules:${collection}:${rules.publicCreate}:${rules.publicRead}`); return rules; },
};
const principal = { userId: 'user-1', clientId: 'claude-app' };
const open = async () => true;
const call = (name: string, args: unknown) => handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, principal, deps, open) as Promise<any>;
const text = (r: any) => JSON.parse(r.result.content[0].text);

test('tools: list, read, write and the guard rails', async () => {
  assert.equal(text(await call('list_projects', {})).projects[0].id, PID);
  assert.deepEqual(text(await call('list_files', { projectId: PID })).files.map((f: any) => f.path), ['a.js']);
  assert.equal(text(await call('read_file', { projectId: PID, path: 'a.js' })).content, 'hello');
  const chunk1 = text(await call('read_file', { projectId: PID, path: 'big.txt' }));
  assert.equal(chunk1.done, false); assert.equal(chunk1.totalChars, 250_000); assert.equal(chunk1.content.length, 30_000); assert.equal(chunk1.nextOffset, 30_000);
  let got = ''; let off = 0; let n = 0;
  for (;;) { const c = text(await call('read_file', { projectId: PID, path: 'big.txt', offset: off, limit: 40_000 })); got += c.content; n++; if (c.done) break; off = c.nextOffset; }
  assert.equal(got.length, 250_000); assert.equal(n, 7);
  assert.equal(text(await call('read_file', { projectId: PID, path: 'a.js', offset: 99 })).done, true);
  assert.equal(text(await call('read_file', { projectId: PID, path: 'logo.png' })).binary, true);
  const folder = await call('read_file', { projectId: PID, path: 'dir' });
  assert.equal(folder.result.isError, true);
  const env = await call('read_file', { projectId: PID, path: '.env' });
  assert.equal(env.result.isError, true);
  calls.length = 0;
  assert.equal(text(await call('write_file', { projectId: PID, path: 'src/a.js', content: 'ok' })).ok, true);
  assert.deepEqual(calls, [`write:user-1:${PID}:src/a.js:2`]);
  for (const bad of [{ projectId: PID, path: '.env', content: 'x' }, { projectId: PID, path: 'a', content: '__KX_BINARY_BASE64__:AA' }, { projectId: PID, path: 'a', content: 'x'.repeat(500_001) }, { projectId: 'nope', path: 'a', content: 'x' }, { projectId: PID, path: 'a' }]) {
    calls.length = 0;
    assert.equal((await call('write_file', bad)).result.isError, true);
    assert.deepEqual(calls, []);
  }
});

test('tools: there is no way to delete, publish or reach secrets', () => {
  const names = MCP_TOOLS.map((t) => t.name).sort();
  assert.deepEqual(names, ['edit_file', 'get_account_usage', 'get_platform_guide', 'get_project_status', 'get_site_settings', 'list_data_collections', 'list_files', 'list_projects', 'read_data_rows', 'read_file', 'set_app_icon', 'set_data_rules', 'update_site_settings', 'write_file']);
  const writers = ['write_file', 'edit_file', 'update_site_settings', 'set_app_icon', 'set_data_rules'];
  for (const t of MCP_TOOLS) assert.equal(t.annotations.readOnlyHint, !writers.includes(t.name), t.name);
});

test('every tool states readOnlyHint, destructiveHint and openWorldHint (directories require it)', () => {
  for (const t of MCP_TOOLS) {
    const a = t.annotations as Record<string, unknown>;
    for (const key of ['readOnlyHint', 'destructiveHint', 'openWorldHint']) assert.equal(typeof a[key], 'boolean', `${t.name}.${key}`);
    assert.ok(t.title && t.description, t.name);
  }
});

test('rate limit and unexpected errors do not leak internals', async () => {
  const limited = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_projects', arguments: {} } }, principal, deps, async () => false) as any;
  assert.equal(limited.result.isError, true);
  const boom = await handleRpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_projects', arguments: {} } }, principal, { ...deps, listProjects: async () => { throw new Error('secret db detail'); } }, open) as any;
  assert.equal(boom.result.isError, true);
  assert.doesNotMatch(boom.result.content[0].text, /secret db detail/);
  assert.ok(new McpToolError('x') instanceof Error);
  await assert.rejects(runMcpTool('nope', {}, 'u', deps as any), /Unknown tool/);
});

let server: http.Server; let base = '';
before(async () => {
  const app = express(); app.use(express.json());
  const verify = (async (t: string) => (t === APP_TOKEN ? { userId: 'user-1', clientId: 'claude-app' } : null)) as any;
  app.use(createMcpRouter(deps as any, verify));
  server = http.createServer(app); await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server?.close(); });
const post = (body: unknown, token?: string) => fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

test('http: unauthenticated callers are pointed at the OAuth metadata', async () => {
  const none = await post({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.equal(none.status, 401);
  assert.match(none.headers.get('www-authenticate') || '', /resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource\/mcp"/);
  const wrong = await post({ jsonrpc: '2.0', id: 1, method: 'initialize' }, USER_TOKEN);
  assert.equal(wrong.status, 401);
  assert.match(wrong.headers.get('www-authenticate') || '', /invalid_token/);
});

test('http: initialize, list tools, notification, batch, and unsupported methods', async () => {
  const init = await (await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, APP_TOKEN)).json() as any;
  assert.equal(init.result.protocolVersion, '2025-06-18'); assert.equal(init.result.serverInfo.name, 'kingxtech');
  const old = await (await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, APP_TOKEN)).json() as any;
  assert.equal(old.result.protocolVersion, '2025-06-18');
  const list = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, APP_TOKEN)).json() as any;
  assert.equal(list.result.tools.length, 14);
  const note = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, APP_TOKEN);
  assert.equal(note.status, 202);
  const batch = await (await post([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 2, method: 'nope' }], APP_TOKEN)).json() as any[];
  assert.equal(batch.length, 2); assert.equal(batch[1].error.code, -32601);
  const get = await fetch(`${base}/mcp`); assert.equal(get.status, 405);
  const meta = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json() as any;
  assert.equal(meta.resource, `${base}/mcp`);
  assert.match(meta.authorization_servers[0], /\/auth\/v1$/);
});

test('053: the database blocks connected-app tokens on REST, RPC and Storage', () => {
  const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../supabase/migrations/053_block_connected_ai_app_tokens.sql'), 'utf8') as string;
  assert.match(sql, /pgrst\.db_pre_request = 'public\.block_oauth_app_tokens'/);
  assert.match(sql, /->> 'client_id'/);
  assert.match(sql, /on storage\.objects as restrictive/);
  assert.match(sql, /reset pgrst\.db_pre_request/);
});

test('http: the connector host serves the KingxTech icon as a PNG without sign-in', async () => {
  for (const path of ['/favicon.ico', '/favicon.png', '/apple-touch-icon.png']) {
    const r = await fetch(`${base}${path}`);
    assert.equal(r.status, 200, path);
    assert.match(r.headers.get('content-type') || '', /image\/png/);
    const bytes = Buffer.from(await r.arrayBuffer());
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.ok(bytes.length > 1000);
  }
});

test('edit_file replaces exactly one match and refuses the rest', async () => {
  calls.length = 0;
  assert.equal(text(await call('edit_file', { projectId: PID, path: 'a.js', oldText: 'ell', newText: 'ELL' })).ok, true);
  assert.deepEqual(calls, [`write:user-1:${PID}:a.js:5`]);
  calls.length = 0;
  for (const bad of [{ oldText: 'zzz', newText: 'x' }, { oldText: 'l', newText: 'x' }, { oldText: '', newText: 'x' }, { oldText: 'h' }]) {
    assert.equal((await call('edit_file', { projectId: PID, path: 'a.js', ...bad })).result.isError, true);
  }
  assert.equal((await call('edit_file', { projectId: PID, path: '.env', oldText: 'a', newText: 'b' })).result.isError, true);
  assert.equal((await call('edit_file', { projectId: PID, path: 'logo.png', oldText: 'A', newText: 'b' })).result.isError, true);
  assert.deepEqual(calls, []);
});

test('platform guide, site settings and site data tools', async () => {
  const g = (await call('get_platform_guide', {})).result.content[0].text as string;
  assert.match(g, /Publish changes/); assert.match(g, /install_app/); assert.match(g, /_hp/);
  assert.match((await call('get_platform_guide', { topic: 'plans' })).result.content[0].text, /25 MB/);
  calls.length = 0;
  assert.equal(text(await call('update_site_settings', { projectId: PID, installAsApp: true })).installAsApp, true);
  assert.equal((await call('update_site_settings', { projectId: PID, installAsApp: 'yes' })).result.isError, true);
  assert.equal(text(await call('set_app_icon', { projectId: PID, svg: '<svg viewBox="0 0 512 512"/>' })).ok, true);
  assert.equal(text(await call('list_data_collections', { projectId: PID })).collections[0].name, 'contacts');
  assert.equal(text(await call('read_data_rows', { projectId: PID, collection: 'contacts' })).count, 1);
  const open = text(await call('set_data_rules', { projectId: PID, collection: 'contacts', publicCreate: true, publicRead: true }));
  assert.match(open.warning, /Anyone on the internet/);
  assert.equal((await call('set_data_rules', { projectId: PID, collection: 'contacts', publicCreate: true })).result.isError, true);
  assert.deepEqual(calls, [`pwa:user-1:${PID}:true`, `icon:user-1:${PID}:28`, 'rules:contacts:true:true']);
});

test('generated icons: unsafe SVG is refused, a plain one becomes a 512 PNG', async () => {
  const { renderIconPng, checkIconSvg } = require('../src/services/mcpSvgIcon') as typeof import('../src/services/mcpSvgIcon');
  const bad = [
    '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>',
    '<svg viewBox="0 0 1 1" onload="x()"></svg>',
    '<svg viewBox="0 0 1 1"><image href="http://evil/x.png"/></svg>',
    '<svg viewBox="0 0 1 1"><rect fill="url(http://evil/x)"/></svg>',
    '<!DOCTYPE svg [<!ENTITY a "b">]><svg viewBox="0 0 1 1"/>',
    '<svg viewBox="0 0 1 1"><foreignObject/></svg>',
    '<svg viewBox="0 0 1 1"><use href="#a"/></svg>',
    'not svg',
  ];
  for (const svg of bad) assert.throws(() => checkIconSvg(svg), undefined, svg);
  const png = await renderIconPng('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g"><stop offset="0" stop-color="#0a0"/><stop offset="1" stop-color="#06c"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/><text x="256" y="330" font-size="260" text-anchor="middle" fill="#fff">K</text></svg>');
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  const sharp = require('sharp');
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, 512); assert.equal(meta.height, 512);
});
