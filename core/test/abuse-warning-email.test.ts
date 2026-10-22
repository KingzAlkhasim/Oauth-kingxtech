import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAbuseWarningEmail, describeWarningCategory } from '../src/services/abuseWarningEmail';

test('warning email names the category and links the terms', () => {
  const mail = buildAbuseWarningEmail({ name: 'Ada', category: 'phishing', termsLink: 'https://auth.example/terms' });
  assert.match(mail.text, /imitate other services/);
  assert.match(mail.html, /https:\/\/auth\.example\/terms/);
  assert.match(mail.text, /Hi Ada/);
});

test('warning email escapes names and admin notes', () => {
  const mail = buildAbuseWarningEmail({ name: '<b>x</b>', category: 'malware', termsLink: 'https://a/terms', adminNote: '<script>alert(1)</script>' });
  assert.ok(!mail.html.includes('<script>'));
  assert.ok(!mail.html.includes('<b>x</b>'));
});

test('unknown categories fall back to generic wording and never quote user text', () => {
  assert.match(describeWarningCategory('something_new'), /break our Terms/);
});
