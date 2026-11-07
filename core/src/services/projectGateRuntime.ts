/**
 * The gate: a tiny dependency-free HTTP server that runs INSIDE each project's sandbox as root and is the
 * only thing listening on the exposed port. Project code runs as a different, unprivileged Linux user on
 * a loopback-only port and cannot read the gate's key, signal the gate, or take its port.
 *
 * `createGate` is written as one self-contained function so the very same code is (a) unit/integration
 * tested here under Node and (b) shipped to the sandbox as source via `gateScript()`.
 * Do not add imports or helpers outside the function body.
 */
export interface GateConfig {
  projectId: string;
  keyHex: string;
  listenPort: number;
  upstreamPort: number;
  listenHost?: string;
  maxBody: number;
  maxResponse: number;
  maxInflight: number;
  maxAgeMs: number;
  upstreamTimeoutMs: number;
}

export function createGate(cfg: GateConfig) {
  const http = (process as any).getBuiltinModule('node:http');
  const crypto = (process as any).getBuiltinModule('node:crypto');
  const net = (process as any).getBuiltinModule('node:net');
  const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length', 'x-kx-auth']);
  const nonces = new Map<string, number>();
  const stats = { requests: 0, bytesIn: 0, bytesOut: 0, rejected: 0, upstreamErrors: 0, inflight: 0 };

  const hmac = (data: string) => crypto.createHmac('sha256', cfg.keyHex).update(data).digest('hex');
  const safeEq = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const reply = (res: any, status: number, message: string, extra?: Record<string, string>) => {
    if (res.headersSent) { res.destroy(); return; }
    const body = JSON.stringify({ success: false, error: message });
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', ...(extra || {}) });
    res.end(body);
  };
  const pruneNonces = (now: number) => {
    if (nonces.size < 2000) return;
    for (const [n, exp] of nonces) if (exp < now) nonces.delete(n);
    if (nonces.size > 20000) nonces.clear();
  };

  /** Returns null when the credential is valid, otherwise a short reason. */
  const verify = (header: string | undefined, method: string, url: string, body: Buffer): { ok: true; nonce: string } | { ok: false } => {
    if (typeof header !== 'string' || header.length > 300) return { ok: false };
    const parts = header.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') return { ok: false };
    const ts = Number(parts[1]);
    const nonce = parts[2];
    const sig = parts[3];
    if (!Number.isFinite(ts) || !/^[0-9a-f]{16,64}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(sig)) return { ok: false };
    const now = Date.now();
    if (Math.abs(now - ts) > cfg.maxAgeMs) return { ok: false };
    const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
    const expected = hmac(['v1', cfg.projectId, method.toUpperCase(), url, bodyHash, String(ts), nonce].join('\n'));
    if (!safeEq(expected, sig)) return { ok: false };
    pruneNonces(now);
    if (nonces.has(nonce)) return { ok: false };
    nonces.set(nonce, now + cfg.maxAgeMs * 2);
    return { ok: true, nonce };
  };

  const server = http.createServer((req: any, res: any) => {
    if (stats.inflight >= cfg.maxInflight) { stats.rejected += 1; reply(res, 503, 'busy', { 'retry-after': '2' }); req.resume(); return; }
    stats.inflight += 1;
    let finished = false;
    const done = () => { if (!finished) { finished = true; stats.inflight -= 1; } };
    res.on('close', done);

    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > cfg.maxBody) { tooBig = true; chunks.length = 0; return; }
      if (!tooBig) chunks.push(c);
    });
    req.on('error', () => { done(); });
    req.on('end', () => {
      if (tooBig) { stats.rejected += 1; reply(res, 413, 'request too large'); return; }
      const body = Buffer.concat(chunks);
      const method = String(req.method || 'GET');
      const url = String(req.url || '/');
      const auth = verify(req.headers['x-kx-auth'], method, url, body);
      if (!auth.ok) { stats.rejected += 1; reply(res, 401, 'unauthorized'); return; }
      stats.requests += 1;
      stats.bytesIn += body.length;

      if (url === '/__kx/health') {
        const probe = net.connect({ host: '127.0.0.1', port: cfg.upstreamPort, timeout: 1500 });
        const finish = (upstream: boolean) => {
          probe.destroy();
          if (res.headersSent) return;
          const out = JSON.stringify({ gate: true, upstream, projectId: cfg.projectId, ...stats });
          res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(out), 'x-kx-proof': hmac('proof\n' + auth.nonce), 'cache-control': 'no-store' });
          res.end(out);
        };
        probe.on('connect', () => finish(true));
        probe.on('error', () => finish(false));
        probe.on('timeout', () => finish(false));
        return;
      }
      if (url.startsWith('/__kx/')) { reply(res, 404, 'not found'); return; }

      const headers: Record<string, any> = {};
      for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k.toLowerCase())) headers[k] = v;
      headers['host'] = '127.0.0.1:' + cfg.upstreamPort;
      if (body.length > 0) headers['content-length'] = String(body.length);
      const up = http.request({ host: '127.0.0.1', port: cfg.upstreamPort, method, path: url, headers, timeout: cfg.upstreamTimeoutMs }, (ur: any) => {
        const outHeaders: Record<string, any> = {};
        for (const [k, v] of Object.entries(ur.headers)) if (!HOP.has(k.toLowerCase())) outHeaders[k] = v;
        res.writeHead(ur.statusCode || 502, outHeaders);
        let sent = 0;
        ur.on('data', (c: Buffer) => {
          sent += c.length;
          stats.bytesOut += c.length;
          if (sent > cfg.maxResponse) { ur.destroy(); res.destroy(); return; }
          res.write(c);
        });
        ur.on('end', () => res.end());
        ur.on('error', () => res.destroy());
      });
      up.on('timeout', () => { up.destroy(); stats.upstreamErrors += 1; reply(res, 504, 'upstream timeout'); });
      up.on('error', () => { stats.upstreamErrors += 1; reply(res, 502, 'upstream unavailable'); });
      res.on('close', () => up.destroy());
      up.end(body);
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 200;

  return {
    server,
    stats,
    start: (cb?: () => void) => server.listen(cfg.listenPort, cfg.listenHost || '0.0.0.0', cb),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export const GATE_LIMITS = { maxBody: 1024 * 1024, maxResponse: 5 * 1024 * 1024, maxInflight: 64, maxAgeMs: 30_000, upstreamTimeoutMs: 25_000 } as const;
export const GATE_DIR = '/opt/kx';
export const GATE_KEY_FILE = '/opt/kx/key';
export const GATE_SCRIPT_FILE = '/opt/kx/gate.cjs';

/** The program written to the sandbox (as root) and started as root. It reads its key from a root-only file. */
export function gateScript(): string {
  return [
    `'use strict';`,
    // Some bundlers/transpilers (esbuild keepNames) wrap functions in __name(); keep the shipped source runnable either way.
    `const __name = (f) => f;`,
    `const createGate = ${createGate.toString()};`,
    `const fs = process.getBuiltinModule('node:fs');`,
    `const key = fs.readFileSync(${JSON.stringify(GATE_KEY_FILE)}, 'utf8').trim();`,
    `const [projectId, listen, upstream] = process.argv.slice(2);`,
    `const gate = createGate(Object.assign({ projectId, keyHex: key, listenPort: Number(listen), upstreamPort: Number(upstream) }, ${JSON.stringify(GATE_LIMITS)}));`,
    `gate.start(() => console.log('gate listening on ' + listen));`,
    `process.on('uncaughtException', (e) => { console.error('gate error', e && e.message); });`,
    ``,
  ].join('\n');
}
