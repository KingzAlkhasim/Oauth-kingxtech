import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildInitialIconPng, siteInitial, siteIconColor, SUPPORTED_INITIALS } from '../src/services/siteIcon';

test('initial comes from the first letter or digit of the name', () => {
  assert.equal(siteInitial('Mama Put Bakery'), 'M');
  assert.equal(siteInitial('  kitoko hub'), 'K');
  assert.equal(siteInitial('9ja Foods'), '9');
  assert.equal(siteInitial('---'), 'K');
  assert.equal(siteInitial(''), 'K');
});

test('every letter and digit has a 5x7 shape', () => {
  assert.equal(SUPPORTED_INITIALS.length, 36);
});

test('colour is stable per name and differs between names', () => {
  assert.deepEqual(siteIconColor('Bakery'), siteIconColor(' bakery '));
  assert.notDeepEqual(siteIconColor('Bakery'), siteIconColor('Garage'));
});

test('icon is a valid PNG of the right size', () => {
  for (const size of [48, 192, 512]) {
    const png = buildInitialIconPng(size, 'Bakery');
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
  assert.notDeepEqual(buildInitialIconPng(64, 'Bakery'), buildInitialIconPng(64, 'Garage'));
});

import { hasFaviconLink } from '../src/services/siteIcon';
test('favicon detection ignores apple-touch-icon and finds real icons', () => {
  assert.equal(hasFaviconLink('<head><link rel="icon" href="/a.png"></head>'), true);
  assert.equal(hasFaviconLink("<link href='/a.ico' rel='shortcut icon'>"), true);
  assert.equal(hasFaviconLink('<link rel="apple-touch-icon" href="/a.png">'), false);
  assert.equal(hasFaviconLink('<link rel="stylesheet" href="/icon.css">'), false);
  assert.equal(hasFaviconLink('<html><head></head></html>'), false);
});
