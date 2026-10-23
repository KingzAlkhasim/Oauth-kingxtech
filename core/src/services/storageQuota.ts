// Pure storage-quota rules (no database imports, so they can be unit tested).
// Only source files count. Published builds are shown on the Usage page but not counted,
// because they are regenerated from the source on every publish.

export type StorageTier = 'free' | 'pro' | 'pro_plus';

const MB = 1024 * 1024;

// Sizes are the stored size of file content (images and fonts are base64, ~33% larger than on disk).
export const STORAGE_LIMIT_BYTES: Record<StorageTier, number> = {
  free: 25 * MB,
  pro: 250 * MB,
  pro_plus: 1024 * MB,
};

export function storageLimitFor(tier: StorageTier): number {
  return STORAGE_LIMIT_BYTES[tier] ?? STORAGE_LIMIT_BYTES.free;
}

/** Generated output and verification folders never count toward a person's limit. */
export function isCountedPath(path: string): boolean {
  return !path.startsWith('.kingxtech-dist/') && !path.startsWith('.kx-verify-dist/');
}

export function formatMb(bytes: number): string {
  const mb = bytes / MB;
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`;
  return `${mb >= 100 || Number.isInteger(mb) ? Math.round(mb) : mb.toFixed(1)} MB`;
}

const TIER_NAME: Record<StorageTier, string> = { free: 'Free', pro: 'Pro', pro_plus: 'Pro+' };

export interface WriteCheck {
  limit: number;
  usedBytes: number;      // current total of counted source files
  existingBytes: number;  // size of the file being replaced (0 for a new file)
  newBytes: number;       // size of the new content
}

/** A write is allowed if it fits, or if it does not make storage any larger (so people can always edit down). */
export function canWrite({ limit, usedBytes, existingBytes, newBytes }: WriteCheck): boolean {
  if (newBytes <= existingBytes) return true;
  return usedBytes - existingBytes + newBytes <= limit;
}

export function storageFullMessage(tier: StorageTier, limit: number): string {
  const upgrade = tier === 'pro_plus' ? '' : ' or upgrade your plan for more space';
  return `Storage is full. Your ${TIER_NAME[tier]} plan includes ${formatMb(limit)} for project files. Delete files you no longer need${upgrade}.`;
}
