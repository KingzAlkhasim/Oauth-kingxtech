// Rules for the Project Data API. Pure functions, no env or database.
export const COLLECTION_RE = /^[a-z][a-z0-9_-]{0,39}$/;
export const MAX_ROW_BYTES = 16 * 1024;
export const MAX_FIELDS = 40;
export const MAX_ROWS_PER_PROJECT = 5000;
export const PUBLIC_READ_PAGE = 50;
/** Spam trap: real visitors never see or fill this field, bots often do. */
export const HONEYPOT_FIELD = '_hp';

export function cleanCollectionName(raw: unknown): string | null {
  return typeof raw === 'string' && COLLECTION_RE.test(raw) ? raw : null;
}

export type CleanRow = { ok: true; data: Record<string, unknown>; spam: boolean } | { ok: false; error: string };

/**
 * Keeps only plain values (text, numbers, true/false, null), at most MAX_FIELDS fields,
 * and the whole record under MAX_ROW_BYTES. Nested objects are refused so a record stays
 * a flat, easy-to-read row.
 */
export function cleanRow(raw: unknown): CleanRow {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Send a JSON object, like {"name":"Ada","message":"Hi"}.' };
  const entries = Object.entries(raw as Record<string, unknown>);
  const spam = typeof (raw as any)[HONEYPOT_FIELD] === 'string' && (raw as any)[HONEYPOT_FIELD].length > 0;
  const data: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (key === HONEYPOT_FIELD) continue;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) return { ok: false, error: `Field name "${key.slice(0, 40)}" is not allowed. Use letters, numbers and underscores, starting with a letter.` };
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) return { ok: false, error: `Field "${key}" must be text, a number, true/false or null.` };
    if (typeof value === 'number' && !Number.isFinite(value)) return { ok: false, error: `Field "${key}" must be a finite number.` };
    data[key] = value;
  }
  if (Object.keys(data).length === 0 && !spam) return { ok: false, error: 'The record is empty.' };
  if (Object.keys(data).length > MAX_FIELDS) return { ok: false, error: `A record can have at most ${MAX_FIELDS} fields.` };
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_ROW_BYTES) return { ok: false, error: `A record can be at most ${MAX_ROW_BYTES / 1024} KB.` };
  return { ok: true, data, spam };
}

export interface CollectionRules { publicCreate: boolean; publicRead: boolean }
export function cleanRules(input: any): CollectionRules {
  return { publicCreate: input?.publicCreate === true, publicRead: input?.publicRead === true };
}

export function cleanLimit(raw: unknown): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) ? Math.min(PUBLIC_READ_PAGE, Math.max(1, n)) : 20;
}
