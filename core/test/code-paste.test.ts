import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore plain JS module shared with the frontend
import { looksLikeCode, fencePastedCode } from '../../src/lib/codePaste.js';

test('multi-line code is detected', () => {
  assert.equal(looksLikeCode("async function askAI(messages) {\n  const res = await fetch('/x');\n  return res;\n}"), true);
  assert.equal(looksLikeCode('<div class="a">\n  <p>Hello</p>\n</div>'), true);
  assert.equal(looksLikeCode('.card {\n  color: red;\n}'), true);
});

test('normal sentences, one-liners and already-fenced text are left alone', () => {
  assert.equal(looksLikeCode('Please make the header blue and add a footer.'), false);
  assert.equal(looksLikeCode('const a = 1;'), false);
  assert.equal(looksLikeCode('Hello there\nHow are you today\nThanks for the help'), false);
  assert.equal(looksLikeCode('```js\nconst a = 1;\nlet b = 2;\n```'), false);
});

test('fencing keeps the code and ends with a blank line for the question', () => {
  assert.equal(fencePastedCode('a;\nb;\n'), '```\na;\nb;\n```\n');
});
