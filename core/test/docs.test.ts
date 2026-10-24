import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-ignore plain JS module shared with the frontend
import { buildDocPages, parseYouTubeId, splitVideoBlocks, searchDocs } from '../../src/lib/docs.js';

const raw = {
  '../docs/02-publishing.md': '# Publishing\n> Put your site online.\n\nClick Publish. Your link looks like site.kingxtech.name.ng.',
  '../docs/01-getting-started.md': '# Getting started\n> First steps.\n\nCreate a project from a template.',
  '../docs/_notes.md': '# Hidden\nAuthor notes',
  '../docs/readme.txt': 'ignored',
};

test('pages are ordered by file name, titled, and hide author notes', () => {
  const pages = buildDocPages(raw);
  assert.deepEqual(pages.map((p: any) => p.slug), ['getting-started', 'publishing']);
  assert.equal(pages[0].title, 'Getting started');
  assert.equal(pages[1].summary, 'Put your site online.');
  assert.ok(!pages[1].body.includes('# Publishing'));
});

test('YouTube links are parsed safely', () => {
  assert.equal(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeId('https://youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeId('https://evil.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseYouTubeId('https://youtu.be/<script>'), null);
  assert.equal(parseYouTubeId('not a url'), null);
});

test('video lines become embeds and invalid ones are dropped', () => {
  const blocks = splitVideoBlocks('Intro\n\n{{video: https://youtu.be/dQw4w9WgXcQ}}\n\n{{video: PASTE_LINK_HERE}}\n\nOutro');
  assert.deepEqual(blocks.map((b: any) => b.type), ['markdown', 'video', 'markdown']);
  assert.equal(blocks[1].id, 'dQw4w9WgXcQ');
  assert.ok(!JSON.stringify(blocks).includes('PASTE_LINK_HERE'));
});

test('search ranks title matches first and requires every word', () => {
  const pages = buildDocPages(raw);
  const hits = searchDocs(pages, 'publish');
  assert.equal(hits[0].page.slug, 'publishing');
  assert.equal(searchDocs(pages, 'publishing template').length, 0);
  assert.equal(searchDocs(pages, 'x').length, 0);
  assert.equal(searchDocs(pages, '').length, 0);
  assert.match(searchDocs(pages, 'template')[0].snippet, /template/i);
});
