import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROJECT_MEMBER_CAPS } from '../src/config/projectCollaboration';
import { buildProjectInviteEmail, buildProjectInviteLink, escapeHtml } from '../src/services/projectInviteEmail';
import {
  roleAtLeast,
  canInvite,
  canManageMembers,
  canDeleteProject,
  canWriteFiles,
  canUseAiMode,
  validInvite,
  transferTransition,
  memberCapReached,
  PROJECT_ROUTE_MIN_ROLES,
} from '../src/services/projectCollaborationLogic';

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

test('viewer AI access is Plan-only', () => {
  assert.equal(canUseAiMode('viewer', 'plan'), true);
  assert.equal(canUseAiMode('viewer', 'build'), false);
  assert.equal(canUseAiMode('editor', 'plan'), true);
  assert.equal(canUseAiMode('editor', 'build'), true);
  assert.equal(canUseAiMode('owner', 'build'), true);
});

test('project routes have explicit minimum roles', () => {
  assert.equal(PROJECT_ROUTE_MIN_ROLES.aiGeneratePlan, 'viewer');
  assert.equal(PROJECT_ROUTE_MIN_ROLES.aiGenerateBuild, 'editor');
  assert.equal(PROJECT_ROUTE_MIN_ROLES.filesRead, 'viewer');
  assert.equal(PROJECT_ROUTE_MIN_ROLES.filesWrite, 'editor');
  assert.equal(PROJECT_ROUTE_MIN_ROLES.fileVersions, 'editor');
  assert.equal(PROJECT_ROUTE_MIN_ROLES.revert, 'editor');
  assert.equal(PROJECT_ROUTE_MIN_ROLES.rejectTurn, 'editor');
  assert.equal(PROJECT_ROUTE_MIN_ROLES.publish, 'editor');
  assert.equal(PROJECT_ROUTE_MIN_ROLES.envValues, 'owner');
  assert.equal(PROJECT_ROUTE_MIN_ROLES.pwa, 'owner');
  assert.equal(PROJECT_ROUTE_MIN_ROLES.githubLink, 'owner');
  assert.equal(PROJECT_ROUTE_MIN_ROLES.githubPush, 'owner');
  assert.equal(PROJECT_ROUTE_MIN_ROLES.githubImport, 'owner');
  assert.equal(PROJECT_ROUTE_MIN_ROLES.customDomains, 'owner');
  assert.equal(PROJECT_ROUTE_MIN_ROLES.deleteProject, 'owner');
  assert.equal(PROJECT_ROUTE_MIN_ROLES.securityCheck, 'owner');
  assert.equal(PROJECT_ROUTE_MIN_ROLES.runtime, 'owner');
  assert.equal(PROJECT_ROUTE_MIN_ROLES.terminal, 'owner');
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

test('invite links use the configured app origin and URL-encode tokens', () => {
  assert.equal(buildProjectInviteLink('token/with spaces', 'https://auth.kingxtech.name.ng/'), 'https://auth.kingxtech.name.ng/invite/token%2Fwith%20spaces');
});

test('invitation email escapes user-controlled HTML and includes text fallback details', () => {
  assert.equal(escapeHtml('<script a="b">&\''), '&lt;script a=&quot;b&quot;&gt;&amp;&#39;');
  const email = buildProjectInviteEmail({
    inviterName: '<Admin>',
    projectName: 'Website & "API"',
    role: 'editor',
    inviteLink: 'https://auth.kingxtech.name.ng/invite/abc',
    expiryDays: 7,
  });
  assert.match(email.html, /&lt;Admin&gt;/);
  assert.match(email.html, /Website &amp; &quot;API&quot;/);
  assert.doesNotMatch(email.html, /<Admin>/);
  assert.match(email.text, /expires in 7 days/);
  assert.match(email.text, /https:\/\/auth\.kingxtech\.name\.ng\/invite\/abc/);
});
