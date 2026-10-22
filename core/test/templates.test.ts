import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-ignore plain JS module shared with the frontend
import { TEMPLATE_LIST, renderTemplate } from '../../src/lib/templates.js';

test('every template except blank ships an index.html that publishes as static', () => {
  for (const t of TEMPLATE_LIST) {
    const files = renderTemplate(t.id, 'Demo');
    if (t.id === 'blank') { assert.equal(files.length, 0); continue; }
    assert.ok(files.some((f: any) => f.path === 'index.html'), t.id);
    for (const f of files) assert.ok(f.content.length > 0 && f.content.length < 20000, `${t.id}/${f.path}`);
  }
});

test('project names are escaped into the page', () => {
  const html = renderTemplate('landing', '<script>alert(1)</script>').find((f: any) => f.path === 'index.html').content;
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('templates make no outside requests (CSP and privacy safe)', () => {
  for (const t of TEMPLATE_LIST) {
    for (const f of renderTemplate(t.id, 'Demo')) {
      assert.ok(!/(src|href)=["']https?:\/\//i.test(f.content.replace(/href="https:\/\/wa\.me/g, '')), `${t.id}/${f.path}`);
      assert.ok(!/@import|url\(https?:/i.test(f.content), `${t.id}/${f.path}`);
    }
  }
});

test('unknown template gives nothing', () => {
  assert.deepEqual(renderTemplate('nope', 'x'), []);
});
