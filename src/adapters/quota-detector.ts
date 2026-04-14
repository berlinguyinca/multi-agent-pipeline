import { AdapterError } from './base-adapter.js';

const QUOTA_PATTERNS: RegExp[] = [
  /quota\s*(exceeded|exhausted|limit)/i,
  /usage\s*limit/i,
  /spending\s*limit/i,
  /monthly\s*limit/i,
  /daily\s*limit/i,
  /billing\s*(limit|quota)/i,
  /insufficient[\s_]*(credits?|funds|balance)/i,
  /exceeded.*(?:plan|tier)\s*(?:limit|quota)/i,
];

export function isQuotaExhaustion(error: unknown): boolean {
  if (!(error instanceof AdapterError)) {
    return false;
  }

  const stderr = error.stderr ?? '';
  const message = error.message;
  const combined = `${stderr}\n${message}`;

  return QUOTA_PATTERNS.some((pattern) => pattern.test(combined));
}
