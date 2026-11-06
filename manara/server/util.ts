import crypto from 'node:crypto';

export const newId = (prefix = '') => prefix + crypto.randomBytes(9).toString('base64url');
export const nowIso = () => new Date().toISOString();

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message || code);
  }
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** Convert Arabic-Indic / Persian digits to ASCII digits. */
export function normalizeDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Normalize Arabic text for loose matching (strip diacritics/tatweel, unify alef/yaa/taa marbuta). */
export function normalizeText(s: string): string {
  return normalizeDigits(s)
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[“”«»"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function addDays(d: Date, days: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

/** Scrub obvious secrets / personal content before logging. */
export function safeLog(context: string, err: unknown) {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[manara] ${context}: ${msg.replace(/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 400)}`);
}
