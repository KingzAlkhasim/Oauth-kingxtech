import assert from 'node:assert/strict';
import http from 'node:http';
import { test, before, after } from 'node:test';
import { createGate, gateScript, GATE_LIMITS } from '../src/services/projectGateRuntime.js';
import { deriveProjectKey, signRequest, expectedProof, nonceOf, gatewaySecretProblem, CREDENTIAL_HEADER } from '../src/services/projectServerAuth.js';

const MASTER = 'm'.repeat(40);
const PID = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const key = deriveProjectKey(MASTER, PID);

let upstream: http.Server; let upPort = 0; let upHits = 0;
let gate: ReturnType<typeof createGate>; let gPort = 0;

const listen = (s: http.Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as any).port)));

before(async () => {
  upstream = http.createServer((req, res) => {
    upHits += 1;
    const c: Buffer[] = []; req.on('data', (d) => c.push(d));
    req.on('end', () => {
      if (req.url === '/big') { res.writeHead(200); res.end(Buffer.alloc(GATE_LIMITS.maxResponse + 10, 97)); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ url: req.url, method: req.method, body: Buffer.concat(c).toString(), auth: req.headers[CREDENTIAL_HEADER] ?? null }));
    });
  });
  upPort = await listen(upstream);
  gate = createGate({ projectId: PID, keyHex: key, listenPort: 0, upstreamPort: upPort, listenHost: '127.0.0.1', ...GATE_LIMITS });
  gPort = await new Promise<number>((r) => gate.server.listen(0, '127.0.0.1', () => r((gate.server.address() as any).port)));
});
after(async () => { await gate.close(); upstream.close(); });

function call(method: string, url: string, body?: Buffer, auth?: string | null) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }>((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (auth) headers[CREDENTIAL_HEADER] = auth;
    if (body) headers['content-length'] = String(body.length);
    const r = http.request({ host: '127.0.0.1', port: gPort, method, path: url, headers }, (res) => {
      const c: Buffer[] = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, text: Buffer.concat(c).toString() }));
      res.on('error', reject);
    });
    r.on('error', reject); r.end(body);
  });
}
const sign = (o: Partial<Parameters<typeof signRequest>[0]> & { method: string; url: string }) => signRequest({ keyHex: key, projectId: PID, ...o });

test('valid credential is proxied and credential is not leaked to project code', async () => {
  const hits = upHits;
  const r = await call('POST', '/api/x?a=1', Buffer.from('hello'), sign({ method: 'POST', url: '/api/x?a=1', body: Buffer.from('hello') }));
  assert.equal(r.status, 200);
  const j = JSON.parse(r.text);
  assert.equal(j.body, 'hello'); assert.equal(j.url, '/api/x?a=1'); assert.equal(j.auth, null);
  assert.equal(upHits, hits + 1);
});

test('missing, malformed and garbage credentials are rejected without reaching the app', async () => {
  const hits = upHits;
  for (const a of [null, 'x', 'v1.1.2.3', 'v1.' + Date.now() + '.abcdabcdabcdabcd.' + 'z'.repeat(64), 'v1.' + Date.now() + '.abcdabcdabcdabcd.' + '0'.repeat(64)]) {
    assert.equal((await call('GET', '/', undefined, a)).status, 401);
  }
  assert.equal(upHits, hits);
});

test('expired and future-dated credentials are rejected', async () => {
  assert.equal((await call('GET', '/', undefined, sign({ method: 'GET', url: '/', now: Date.now() - 60_000 }))).status, 401);
  assert.equal((await call('GET', '/', undefined, sign({ method: 'GET', url: '/', now: Date.now() + 60_000 }))).status, 401);
});

test('credential from another project is rejected', async () => {
  const forged = signRequest({ keyHex: deriveProjectKey(MASTER, OTHER), projectId: OTHER, method: 'GET', url: '/' });
  assert.equal((await call('GET', '/', undefined, forged)).status, 401);
  const wrongBinding = signRequest({ keyHex: key, projectId: OTHER, method: 'GET', url: '/' });
  assert.equal((await call('GET', '/', undefined, wrongBinding)).status, 401);
});

test('replay of a valid credential is rejected', async () => {
  const c = sign({ method: 'GET', url: '/replay' });
  assert.equal((await call('GET', '/replay', undefined, c)).status, 200);
  assert.equal((await call('GET', '/replay', undefined, c)).status, 401);
});

test('credential is bound to method, url and body', async () => {
  assert.equal((await call('POST', '/a', Buffer.from('x'), sign({ method: 'GET', url: '/a', body: Buffer.from('x') }))).status, 401);
  assert.equal((await call('GET', '/b', undefined, sign({ method: 'GET', url: '/a' }))).status, 401);
  assert.equal((await call('POST', '/a', Buffer.from('tampered'), sign({ method: 'POST', url: '/a', body: Buffer.from('x') }))).status, 401);
});

test('oversized request body is rejected', async () => {
  const body = Buffer.alloc(GATE_LIMITS.maxBody + 1, 1);
  const r = await call('POST', '/up', body, sign({ method: 'POST', url: '/up', body }));
  assert.equal(r.status, 413);
});

test('oversized upstream response is cut off', async () => {
  const r = await call('GET', '/big', undefined, sign({ method: 'GET', url: '/big' })).catch(() => ({ status: 0, text: '' } as any));
  assert.ok(r.status === 0 || r.text.length <= GATE_LIMITS.maxResponse);
});

test('health proves a genuine gate and the reserved prefix is not forwarded', async () => {
  const c = sign({ method: 'GET', url: '/__kx/health' });
  const r = await call('GET', '/__kx/health', undefined, c);
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-kx-proof'], expectedProof(key, nonceOf(c)));
  assert.equal(JSON.parse(r.text).gate, true);
  assert.equal(JSON.parse(r.text).upstream, true);
  assert.equal((await call('GET', '/__kx/other', undefined, sign({ method: 'GET', url: '/__kx/other' }))).status, 404);
});

test('key derivation is per-project and master secret is validated', () => {
  assert.notEqual(deriveProjectKey(MASTER, PID), deriveProjectKey(MASTER, OTHER));
  assert.equal(deriveProjectKey(MASTER, PID), deriveProjectKey(MASTER, PID));
  assert.ok(gatewaySecretProblem('short'));
  assert.ok(gatewaySecretProblem(undefined));
  assert.equal(gatewaySecretProblem(MASTER), null);
  assert.throws(() => deriveProjectKey('short', PID));
});

test('gate script is self-contained, parses, and reads its key from a file', async () => {
  const src = gateScript();
  new Function(src.replace(/process\.getBuiltinModule/g, 'process.getBuiltinModule'));
  assert.ok(src.includes('/opt/kx/key'));
  assert.ok(!src.includes(MASTER));
});
