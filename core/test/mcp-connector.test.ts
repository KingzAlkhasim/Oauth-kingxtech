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
};
const principal = { userId: 'user-1', clientId: 'claude-app' };
const open = async () => true;
const call = (name: string, args: unknown) => handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, principal, deps, open) as Promise<any>;
const text = (r: any) => JSON.parse(r.result.content[0].text);

test('tools: list, read, write and the guard rails', async () => {
  assert.equal(text(await call('list_projects', {})).projects[0].id, PID);
  assert.deepEqual(text(await call('list_files', { projectId: PID })).files.map((f: any) => f.path), ['a.js']);
  assert.equal(text(await call('read_file', { projectId: PID, path: 'a.js' })).content, 'hello');
  assert.equal(text(await call('read_file', { projectId: PID, path: 'big.txt' })).truncated, true);
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
  assert.deepEqual(names, ['get_account_usage', 'get_project_status', 'list_files', 'list_projects', 'read_file', 'write_file']);
  assert.equal(MCP_TOOLS.find((t) => t.name === 'write_file')!.annotations.readOnlyHint, false);
  assert.ok(MCP_TOOLS.filter((t) => t.name !== 'write_file').every((t) => t.annotations.readOnlyHint === true));
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
  assert.equal(list.result.tools.length, 6);
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
