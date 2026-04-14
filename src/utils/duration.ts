const DURATION_SEGMENT_REGEX = /(\d+(?:\.\d+)?)(ms|s|m|h)/gi;

const UNIT_TO_MS = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
} as const;

export function parseDuration(value: string | number, label: string): number {
  if (typeof value === 'number') {
    return validateDurationNumber(value, label);
  }

  const trimmed = value.trim();
  if (trimmed === '') {
    throw new Error(`${label} must not be empty`);
  }

  if (/^\d+$/.test(trimmed)) {
    return validateDurationNumber(Number.parseInt(trimmed, 10), label);
  }

  let total = 0;
  let matchedLength = 0;

  for (const match of trimmed.matchAll(DURATION_SEGMENT_REGEX)) {
    const [, amountRaw, unitRaw] = match;
    const amount = Number.parseFloat(amountRaw ?? '');
    const unit = unitRaw?.toLowerCase() as keyof typeof UNIT_TO_MS | undefined;

    if (!Number.isFinite(amount) || amount <= 0 || unit === undefined) {
      throw new Error(`${label} must be a positive duration`);
    }

    total += amount * UNIT_TO_MS[unit];
    matchedLength += match[0].length;
  }

  if (matchedLength !== trimmed.length) {
    throw new Error(
      `${label} must be a positive duration like "10s", "5m", "1h", or milliseconds`,
    );
  }

  return validateDurationNumber(total, label);
}

export function validateDurationRelationship(
  totalTimeoutMs: number,
  inactivityTimeoutMs: number,
  pollIntervalMs: number,
): void {
  if (pollIntervalMs >= inactivityTimeoutMs) {
    throw new Error('headless.pollIntervalMs must be less than headless.inactivityTimeoutMs');
  }

  if (inactivityTimeoutMs > totalTimeoutMs) {
    throw new Error('headless.inactivityTimeoutMs must be less than or equal to headless.totalTimeoutMs');
  }
}

function validateDurationNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive duration`);
  }

  return Math.round(value);
}
