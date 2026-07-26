import * as Sentry from '@sentry/node';

/**
 * Initializes Sentry for backend error + performance tracing, including
 * spans around the AI agent's tool-calling loop (see agentTools.ts) so a
 * conversation's actual behavior — which tools ran, how long each took,
 * how large the history payload was — is visible as a real trace, not
 * something you have to guess at from logs.
 *
 * Reads SENTRY_DSN directly from process.env (not the zod-validated env
 * module) so this can run at the very top of server.ts, before anything
 * else is imported — Sentry's auto-instrumentation needs to attach before
 * Express/http are set up to catch everything.
 *
 * No-op if SENTRY_DSN isn't set — fully optional, doesn't block startup.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log('[sentry] disabled — SENTRY_DSN not set');
    return;
  }

  Sentry.init({
    dsn,
    tracesSampleRate: 1.0,
    sendDefaultPii: false,
  });
  console.log('[sentry] initialized');
}

export { Sentry };