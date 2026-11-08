import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
// Real production app (api/index.ts) over HTTP. Dummy env: nothing here reaches a network or a database.
for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) process.env[k] ??= 'test-placeholder';
process.env.SUPABASE_URL ??= 'http://127.0.0.1:9';
process.env.CRON_SECRET = 'x'.repeat(40);
const app = require('../api/index') as import('express').Express;

function get(port: number, path: string, auth?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers: { host: 'neurocore-rouge.vercel.app', ...(auth ? { authorization: auth } : {}) } }, (res) => {
      let body = ''; res.on('data', (c) => (body += c)); res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    }).on('error', reject);
  });
}

// Cron callers have no user session. The collaboration router asks for one on every path it sees, so the cron routes must be mounted before it.
test('cron routes are answered by their own bearer check, not by the user-session check in front of them', async () => {
  const server = app.listen(0); const port = (server.address() as { port: number }).port;
  try {
    for (const path of ['/api/internal/cron/project-servers-reap', '/api/internal/cron/expire-plans']) {
      const r = await get(port, path, 'Bearer not-the-secret'); // cron callers send a Bearer header, which the session check would treat as a user token
      assert.equal(r.status, 401, path);
      assert.match(r.body, /Unauthorized/, path);
      assert.ok(!/Invalid or expired session/.test(r.body), `${path} was intercepted by the user-session check: ${r.body}`);
    }
    // A user route is still protected.
    const u = await get(port, '/api/project-servers/usage');
    assert.equal(u.status, 401);
  } finally { server.close(); }
});
