import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryCounter, createRateLimiter, type TakeFn } from '../src/middleware/rateLimit.js';

function call(limiter: ReturnType<typeof createRateLimiter>, userId: string) {
  let status = 200;
  let nextCalled = false;
  const res: any = { status(s: number) { status = s; return this; }, json() { return this; } };
  return limiter({ user: { id: userId } } as any, res, () => { nextCalled = true; }).then(() => ({ status, nextCalled }));
}

test('shared counter decides when it is available', async () => {
  const seen: string[] = [];
  const take: TakeFn = async (key) => { seen.push(key); return seen.length <= 2; };
  const limiter = createRateLimiter(take);
  assert.equal((await call(limiter, 'u1')).nextCalled, true);
  assert.equal((await call(limiter, 'u1')).nextCalled, true);
  const blocked = await call(limiter, 'u1');
  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.status, 429);
  assert.deepEqual(seen, ['u1', 'u1', 'u1']);
});

test('falls back to the in-memory counter (does not fail open) when the shared counter is down', async () => {
  const limiter = createRateLimiter(async () => null);
  const results = [];
  for (let i = 0; i < 12; i += 1) results.push((await call(limiter, 'u2')).status);
  assert.equal(results.filter((s) => s === 200).length, 10);
  assert.equal(results.filter((s) => s === 429).length, 2);
});

test('users are counted separately', async () => {
  const limiter = createRateLimiter(async () => null);
  for (let i = 0; i < 10; i += 1) await call(limiter, 'a');
  assert.equal((await call(limiter, 'a')).status, 429);
  assert.equal((await call(limiter, 'b')).status, 200);
});

test('memory counter resets after the window and stays bounded', () => {
  let t = 0;
  const counter = createMemoryCounter(() => t);
  assert.equal(counter('k', 1, 60), true);
  assert.equal(counter('k', 1, 60), false);
  t = 61_000;
  assert.equal(counter('k', 1, 60), true);
  for (let i = 0; i < 6000; i += 1) counter(`k${i}`, 1, 60);
  t = 200_000;
  counter('trigger-prune', 1, 60);
  assert.equal(counter('k5', 1, 60), true, 'expired entries were pruned');
});
