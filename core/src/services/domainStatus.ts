export type DomainStatus = 'pending' | 'misconfigured' | 'active';

/**
 * Vercel's `verified` flag only means domain OWNERSHIP is confirmed. It says nothing about
 * whether DNS really points at us, so it can read true for a domain that does not work.
 * `dnsConfigured` comes from Vercel's domain config check (`misconfigured` inverted);
 * null means the check could not be made, which we never present as a success.
 */
export function deriveDomainStatus(verified: boolean, dnsConfigured: boolean | null | undefined): DomainStatus {
  if (!verified) return 'pending';
  if (dnsConfigured === true) return 'active';
  return 'misconfigured';
}

export function dnsConfiguredFromVercel(config: { misconfigured?: unknown } | null | undefined): boolean | null {
  if (!config || typeof config.misconfigured !== 'boolean') return null;
  return !config.misconfigured;
}
