import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanSnapshotLabel, snapshotsToKeep, SNAPSHOTS_KEPT } from '../src/services/snapshotPolicy';

test('higher plans keep more restore points', () => {
  assert.ok(snapshotsToKeep('free') < snapshotsToKeep('pro'));
  assert.ok(snapshotsToKeep('pro') < snapshotsToKeep('pro_plus'));
  assert.equal(snapshotsToKeep('free'), SNAPSHOTS_KEPT.free);
});

test('labels are cleaned and capped', () => {
  assert.equal(cleanSnapshotLabel('  Before   the redesign  '), 'Before the redesign');
  assert.equal(cleanSnapshotLabel('a\u0000b\nc'), 'a b c');
  assert.equal(cleanSnapshotLabel('x'.repeat(200)).length, 60);
  assert.equal(cleanSnapshotLabel('   '), 'Restore point');
  assert.equal(cleanSnapshotLabel(undefined, 'Manual'), 'Manual');
  assert.equal(cleanSnapshotLabel(42 as unknown as string), 'Restore point');
});
