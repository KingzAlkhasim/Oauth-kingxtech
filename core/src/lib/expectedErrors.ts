/**
 * Errors that mean "this person may not do that" (for example "You need viewer access to this project.").
 * They are normal answers to a request, not bugs, so they must never be reported to Sentry.
 *
 * Matched by shape rather than by importing the classes, because sentry.ts has to load before everything else
 * (see initSentry) and importing the services from there would pull them in too early.
 */
const EXPECTED_CODES = new Set(['project_role_forbidden']);
const EXPECTED_MESSAGES = [
  /^You need (viewer|editor|owner) access to this project\.?$/,
  /^You are not a member of this project\.?$/,
  /^Only the owner can remove another member\.?$/,
];

export function isExpectedAccessError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === 'string' && EXPECTED_CODES.has(code)) return true;
  return typeof message === 'string' && EXPECTED_MESSAGES.some((re) => re.test(message));
}
