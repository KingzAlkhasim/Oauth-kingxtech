import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const vercelConfig = JSON.parse(
  readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'),
);

test('Vercel cron schedules run at most once a day', () => {
  for (const cron of vercelConfig.crons ?? []) {
    const fields = cron.schedule.trim().split(/\s+/);
    assert.equal(
      fields.length,
      5,
      'Vercel Hobby limit: cron schedules must use five standard cron fields',
    );
    assert.match(
      fields[0],
      /^\d+$/,
      'Vercel Hobby limit: cron minute must be numeric',
    );
    assert.match(
      fields[1],
      /^\d+$/,
      'Vercel Hobby limit: cron hour must be numeric',
    );
    assert.equal(
      fields[2],
      '*',
      'Vercel Hobby limit: cron day-of-month must be * so it runs at most once a day',
    );
  }
});
