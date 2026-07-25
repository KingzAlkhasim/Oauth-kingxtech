import { supabase } from './supabase';
import { listProjects } from './projects';

const EARLY_BUILDER_CUTOFF = new Date('2026-09-01T00:00:00Z');

/**
 * Every value here is a direct fact from your account — no invented scoring,
 * no point weights, no formula. A fresh account just shows its real state.
 */
export async function getCommunityStats() {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const mfaEnabled = !!factors?.totp?.find((f) => f.status === 'verified');

  const { data: projects } = await listProjects();
  const projectCount = projects?.length || 0;

  const meta = user.user_metadata || {};
  const profileComplete = !!(meta.developer_role && meta.experience_level && (meta.tech_stack?.length > 0 || true));

  const createdAt = new Date(user.created_at);
  const earlyBuilder = createdAt < EARLY_BUILDER_CUTOFF;

  const badges = [
    { id: 'early-builder', label: 'Early Builder', earned: earlyBuilder, desc: `Account created before ${EARLY_BUILDER_CUTOFF.toLocaleDateString()}` },
    { id: 'secure-account', label: '2FA Guardian', earned: mfaEnabled, desc: 'Two-factor authentication is enabled' },
    { id: 'profile-complete', label: 'Profile Complete', earned: profileComplete, desc: 'Developer profile is filled out' },
    { id: 'beta-tester', label: 'Builder', earned: projectCount > 0, desc: 'Tracking at least one project' },
  ];

  return {
    accountCreated: createdAt,
    emailConfirmed: !!user.email_confirmed_at,
    mfaEnabled,
    profileComplete,
    projectCount,
    badges,
  };
}
