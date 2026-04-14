import { describe, expect, it } from 'vitest';
import { parseDuration, validateDurationRelationship } from '../../src/utils/duration.js';

describe('parseDuration', () => {
  it('parses integer milliseconds', () => {
    expect(parseDuration('1500', 'timeout')).toBe(1500);
    expect(parseDuration(2500, 'timeout')).toBe(2500);
  });

  it('parses unit-based strings', () => {
    expect(parseDuration('10s', 'timeout')).toBe(10_000);
    expect(parseDuration('5m', 'timeout')).toBe(300_000);
    expect(parseDuration('1h30m', 'timeout')).toBe(5_400_000);
  });

  it('rejects invalid or non-positive durations', () => {
    expect(() => parseDuration('', 'timeout')).toThrow();
    expect(() => parseDuration('0', 'timeout')).toThrow();
    expect(() => parseDuration('5x', 'timeout')).toThrow();
  });
});

describe('validateDurationRelationship', () => {
  it('accepts valid timeout relationships', () => {
    expect(() => validateDurationRelationship(60_000, 10_000, 1_000)).not.toThrow();
  });

  it('rejects invalid timeout relationships', () => {
    expect(() => validateDurationRelationship(60_000, 10_000, 10_000)).toThrow();
    expect(() => validateDurationRelationship(60_000, 70_000, 1_000)).toThrow();
  });
});
