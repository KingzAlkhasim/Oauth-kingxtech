export const PROJECT_MEMBER_CAPS = {
  free: 2,
  pro: 10,
  pro_plus: 10,
} as const;

export const PROJECT_INVITE_EXPIRY_DAYS = 7;
export const PROJECT_TRANSFER_EXPIRY_DAYS = 7;
export const PROJECT_INVITE_RATE_LIMIT = { windowMs: 60 * 60 * 1000, max: 20 } as const;

/** Runtime/terminal currently runs on the owner's compute. Keep this named so it can change later. */
export const PROJECT_RUNTIME_MIN_ROLE = 'owner' as const;

export type CollaborationTier = keyof typeof PROJECT_MEMBER_CAPS;
export type ProjectRole = 'owner' | 'editor' | 'viewer';

export function memberCapForTier(tier: CollaborationTier): number {
  return PROJECT_MEMBER_CAPS[tier];
}
