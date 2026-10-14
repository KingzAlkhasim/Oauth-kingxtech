import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROJECT_MEMBER_CAPS } from '../src/config/projectCollaboration';
import { roleAtLeast, canInvite, canManageMembers, canDeleteProject, canWriteFiles, validInvite, transferTransition, memberCapReached } from '../src/services/projectCollaborationLogic';

test('role permissions are ordered owner > editor > viewer', () => {
  assert.equal(canWriteFiles('viewer'), false);
  assert.equal(canWriteFiles('editor'), true);
  assert.equal(canDeleteProject('editor'), false);
  assert.equal(canDeleteProject('owner'), true);
  assert.equal(canInvite('viewer'), false);
  assert.equal(canInvite('editor'), true);
  assert.equal(canManageMembers('editor'), false);
  assert.equal(canManageMembers('owner'), true);
  assert.equal(roleAtLeast('owner', 'viewer'), true);
});

test('plan caps are 2 for Free and 10 for Pro/Pro+', () => {
  assert.equal(PROJECT_MEMBER_CAPS.free, 2);
  assert.equal(PROJECT_MEMBER_CAPS.pro, 10);
  assert.equal(PROJECT_MEMBER_CAPS.pro_plus, 10);
  assert.equal(memberCapReached(1, 1, 2), true);
  assert.equal(memberCapReached(1, 0, 2), false);
  assert.equal(memberCapReached(9, 1, 10), true);
});

test('invite validation rejects wrong email, expired, revoked and reused invites', () => {
  assert.deepEqual(validInvite({ signedInEmail: 'a@example.com', invitedEmail: 'b@example.com', expired: false, revoked: false, accepted: false }), { ok: false, code: 'invite_email_mismatch' });
  assert.deepEqual(validInvite({ signedInEmail: 'a@example.com', invitedEmail: 'a@example.com', expired: true, revoked: false, accepted: false }), { ok: false, code: 'invite_expired' });
  assert.deepEqual(validInvite({ signedInEmail: 'a@example.com', invitedEmail: 'a@example.com', expired: false, revoked: true, accepted: false }), { ok: false, code: 'invite_revoked' });
  assert.deepEqual(validInvite({ signedInEmail: 'a@example.com', invitedEmail: 'a@example.com', expired: false, revoked: false, accepted: true }), { ok: false, code: 'invite_used' });
  assert.deepEqual(validInvite({ signedInEmail: 'A@Example.com', invitedEmail: 'a@example.com', expired: false, revoked: false, accepted: false }), { ok: true });
});

test('transfer state transitions only start from pending', () => {
  assert.equal(transferTransition('pending', 'accept'), 'accepted');
  assert.equal(transferTransition('pending', 'decline'), 'declined');
  assert.equal(transferTransition('pending', 'cancel'), 'cancelled');
  assert.throws(() => transferTransition('accepted', 'cancel'));
});
