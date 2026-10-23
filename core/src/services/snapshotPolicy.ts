// Pure snapshot (restore point) rules. Kept free of database imports so they can be unit tested.
// Snapshots do not count toward the plan storage limit, so each plan keeps only a few of them.

export type SnapshotTier = 'free' | 'pro' | 'pro_plus';

export const SNAPSHOTS_KEPT: Record<SnapshotTier, number> = { free: 3, pro: 5, pro_plus: 10 };

export function snapshotsToKeep(tier: SnapshotTier): number {
  return SNAPSHOTS_KEPT[tier] ?? SNAPSHOTS_KEPT.free;
}

/** Trims, collapses whitespace, strips control characters and caps the length. */
export function cleanSnapshotLabel(label: unknown, fallback = 'Restore point'): string {
  if (typeof label !== 'string') return fallback;
  const cleaned = label.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return cleaned || fallback;
}
