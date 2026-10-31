import crypto from 'node:crypto';

/**
 * Gateway-to-sandbox authentication for project servers.
 *
 * KingxTech holds one master secret (PROJECT_SERVER_GATEWAY_SECRET). Each project gets its own key,
 * derived from it, so a key that leaks from one sandbox is worthless for any other project and the
 * master secret itself never enters a sandbox. Every request the gateway forwards carries a short-lived
 * HMAC credential bound to: project, HTTP method, exact path+query, SHA-256 of the body, timestamp and a
 * one-time nonce. The in-sandbox gate (projectGateRuntime.ts) rejects anything else.
 */
export const CREDENTIAL_VERSION = 'v1';
export const CREDENTIAL_HEADER = 'x-kx-auth';
export const CREDENTIAL_MAX_AGE_MS = 30_000;
export const MIN_MASTER_SECRET_LENGTH = 32;

export function gatewaySecretProblem(secret: string | undefined): string | null {
  if (!secret) return 'PROJECT_SERVER_GATEWAY_SECRET is not set.';
  if (secret.length < MIN_MASTER_SECRET_LENGTH) return `PROJECT_SERVER_GATEWAY_SECRET must be at least ${MIN_MASTER_SECRET_LENGTH} characters.`;
  return null;
}

export function deriveProjectKey(masterSecret: string, projectId: string): string {
  const problem = gatewaySecretProblem(masterSecret);
  if (problem) throw new Error(problem);
  return crypto.createHmac('sha256', masterSecret).update(`kx-project-server-v1:${projectId}`).digest('hex');
}

export const sha256Hex = (data: Buffer | string) => crypto.createHash('sha256').update(data).digest('hex');

export function canonicalString(parts: { projectId: string; method: string; url: string; bodySha256: string; ts: number; nonce: string }): string {
  return [CREDENTIAL_VERSION, parts.projectId, parts.method.toUpperCase(), parts.url, parts.bodySha256, String(parts.ts), parts.nonce].join('\n');
}

export function signRequest(opts: { keyHex: string; projectId: string; method: string; url: string; body?: Buffer; now?: number; nonce?: string }): string {
  const ts = opts.now ?? Date.now();
  const nonce = opts.nonce ?? crypto.randomBytes(16).toString('hex');
  const canonical = canonicalString({ projectId: opts.projectId, method: opts.method, url: opts.url, bodySha256: sha256Hex(opts.body ?? Buffer.alloc(0)), ts, nonce });
  const sig = crypto.createHmac('sha256', opts.keyHex).update(canonical).digest('hex');
  return `${CREDENTIAL_VERSION}.${ts}.${nonce}.${sig}`;
}

/** What the real gate returns on the health check, proving a genuine gate (not project code) is answering. */
export function expectedProof(keyHex: string, nonce: string): string {
  return crypto.createHmac('sha256', keyHex).update(`proof\n${nonce}`).digest('hex');
}

export function nonceOf(credential: string): string {
  return credential.split('.')[2] ?? '';
}
