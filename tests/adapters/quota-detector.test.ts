import { describe, expect, it } from 'vitest';
import { isQuotaExhaustion } from '../../src/adapters/quota-detector.js';
import { AdapterError } from '../../src/adapters/base-adapter.js';

describe('isQuotaExhaustion', () => {
  it('returns false for non-AdapterError', () => {
    expect(isQuotaExhaustion(new Error('generic error'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isQuotaExhaustion('string error')).toBe(false);
    expect(isQuotaExhaustion(null)).toBe(false);
    expect(isQuotaExhaustion(undefined)).toBe(false);
  });

  it('returns false for non-quota AdapterError', () => {
    const err = new AdapterError('claude exited with code 1: syntax error', 'claude', 1, 'syntax error');
    expect(isQuotaExhaustion(err)).toBe(false);
  });

  it('returns false for AdapterError with no stderr', () => {
    const err = new AdapterError('process crashed', 'claude', 1);
    expect(isQuotaExhaustion(err)).toBe(false);
  });

  it('detects "quota exceeded" in stderr', () => {
    const err = new AdapterError(
      'claude exited with code 1',
      'claude',
      1,
      'Error: API quota exceeded for this billing period',
    );
    expect(isQuotaExhaustion(err)).toBe(true);
  });

  it('detects "quota exhausted" in stderr', () => {
    const err = new AdapterError(
      'codex exited with code 1',
      'codex',
      1,
      'quota exhausted, please upgrade your plan',
    );
    expect(isQuotaExhaustion(err)).toBe(true);
  });

  it('detects "usage limit" in stderr', () => {
    const err = new AdapterError(
      'claude exited with code 1',
      'claude',
      1,
      'You have exceeded your usage limit',
    );
    expect(isQuotaExhaustion(err)).toBe(true);
  });

  it('detects "spending limit" in stderr', () => {
    const err = new AdapterError(
      'claude exited with code 1',
      'claude',
      1,
      'spending limit reached for this month',
    );
    expect(isQuotaExhaustion(err)).toBe(true);
  });

  it('detects "monthly limit" in stderr', () => {
    const err = new AdapterError(
      'codex exited with code 1',
      'codex',
      1,
      'monthly limit has been reached',
    );
    expect(isQuotaExhaustion(err)).toBe(true);
  });

  it('detects "daily limit" in stderr', () => {
    const err = new AdapterError(
      'claude exited with code 1',
      'claude',
      1,
      'daily limit exceeded',
    );
    expect(isQuotaExhaustion(err)).toBe(true);
  });

  it('detects "billing limit" in stderr', () => {
    const err = new AdapterError(
      'claude exited with code 1',
      'claude',
      1,
      'billing limit reached',
    );
    expect(isQuotaExhaustion(err)).toBe(true);
  });

  it('detects "insufficient credits" in stderr', () => {
    const err = new AdapterError(
      'codex exited with code 1',
      'codex',
      1,
      'insufficient credits to complete request',
    );
    expect(isQuotaExhaustion(err)).toBe(true);
  });

  it('detects "rate limit exceeded" in stderr', () => {
    const err = new AdapterError(
      'claude exited with code 1',
      'claude',
      1,
      'rate limit exceeded',
    );
    expect(isQuotaExhaustion(err)).toBe(true);
  });

  it('detects quota patterns in error message when stderr is empty', () => {
    const err = new AdapterError(
      'claude exited with code 1: quota exceeded',
      'claude',
      1,
      '',
    );
    expect(isQuotaExhaustion(err)).toBe(true);
  });

  it('is case-insensitive', () => {
    const err = new AdapterError(
      'exited with code 1',
      'claude',
      1,
      'QUOTA EXCEEDED',
    );
    expect(isQuotaExhaustion(err)).toBe(true);
  });

  it('detects "exceeded plan limit" in stderr', () => {
    const err = new AdapterError(
      'exited with code 1',
      'codex',
      1,
      'You have exceeded your plan limit',
    );
    expect(isQuotaExhaustion(err)).toBe(true);
  });
});
