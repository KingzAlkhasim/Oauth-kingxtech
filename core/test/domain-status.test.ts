import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveDomainStatus, dnsConfiguredFromVercel } from '../src/services/domainStatus';

test('unverified domains stay pending whatever DNS says', () => {
  assert.equal(deriveDomainStatus(false, true), 'pending');
  assert.equal(deriveDomainStatus(false, null), 'pending');
});

test('verified but DNS not pointing here is misconfigured, not active', () => {
  assert.equal(deriveDomainStatus(true, false), 'misconfigured');
});

test('an unknown DNS check is never reported as active', () => {
  assert.equal(deriveDomainStatus(true, null), 'misconfigured');
  assert.equal(deriveDomainStatus(true, undefined), 'misconfigured');
});

test('verified and DNS configured is active', () => {
  assert.equal(deriveDomainStatus(true, true), 'active');
});

test('vercel config maps misconfigured to dnsConfigured', () => {
  assert.equal(dnsConfiguredFromVercel({ misconfigured: true }), false);
  assert.equal(dnsConfiguredFromVercel({ misconfigured: false }), true);
  assert.equal(dnsConfiguredFromVercel({}), null);
  assert.equal(dnsConfiguredFromVercel(null), null);
});
