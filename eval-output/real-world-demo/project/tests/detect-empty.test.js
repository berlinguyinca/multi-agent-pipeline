import { describe, it, expect } from 'vitest';
import { detectEmpty } from '../src/detect-empty.js';

describe('detectEmpty', () => {
  // --- Acceptance Criterion 1 ---
  // Given an input ending with `User's request:` and no text after it,
  // the assistant responds that the request is empty.
  // [TEST:WRITE] detect-empty-request-marker-no-text
  it('detects empty when input ends with "User\'s request:" and nothing after', () => {
    const result = detectEmpty("User's request:");
    expect(result.isEmpty).toBe(true);
    expect(result.reason).toMatch(/empty|missing/i);
  });

  // --- Acceptance Criterion 2 ---
  // Given whitespace-only input after a request marker, the assistant treats the request as empty.
  // [TEST:WRITE] detect-whitespace-only-after-marker
  it('detects empty when only whitespace follows the request marker', () => {
    const result = detectEmpty("User's request:   ");
    expect(result.isEmpty).toBe(true);
  });

  // [TEST:WRITE] detect-newlines-after-marker
  it('detects empty when only newlines follow the request marker', () => {
    const result = detectEmpty("User's request:\n\n\n");
    expect(result.isEmpty).toBe(true);
  });

  // --- Acceptance Criterion 3 ---
  // Given `TODO` or `[insert request here]` as the only request content,
  // the assistant treats the request as empty.
  // [TEST:WRITE] detect-placeholder-TBD
  it('detects empty when request content is "TBD"', () => {
    const result = detectEmpty("User's request: TBD");
    expect(result.isEmpty).toBe(true);
    expect(result.reason).toMatch(/empty|missing|placeholder/i);
  });

  // [TEST:WRITE] detect-placeholder-TODO
  it('detects empty when request content is "TODO"', () => {
    const result = detectEmpty("User's request: TODO");
    expect(result.isEmpty).toBe(true);
  });

  // [TEST:WRITE] detect-placeholder-insert-here
  it('detects empty when request content is "[insert request here]"', () => {
    const result = detectEmpty("User's request: [insert request here]");
    expect(result.isEmpty).toBe(true);
  });

  // --- Acceptance Criterion 4 ---
  // Given `Write a spec for a password reset flow`, the assistant does not treat the request as empty.
  // [TEST:WRITE] non-empty-full-request
  it('does NOT detect empty when a substantive request is present', () => {
    const result = detectEmpty('Write a spec for a password reset flow');
    expect(result.isEmpty).toBe(false);
  });

  // [TEST:WRITE] non-empty-feature-billing
  it('does NOT detect empty for "Feature: billing alerts"', () => {
    const result = detectEmpty('Feature: billing alerts');
    expect(result.isEmpty).toBe(false);
  });

  // [TEST:WRITE] non-empty-onboarding
  it('does NOT detect empty for "Write a spec for onboarding new admins"', () => {
    const result = detectEmpty('Write a spec for onboarding new admins');
    expect(result.isEmpty).toBe(false);
  });

  // --- Acceptance Criterion 5 ---
  // Given a partially filled request, the assistant identifies the missing piece.
  // [TEST:WRITE] partial-request-missing-users
  it('detects partial when some fields are filled but others are blank', () => {
    const result = detectEmpty('Feature: password reset; Users:');
    expect(result.isEmpty).toBe(false);
    expect(result.isPartial).toBe(true);
    expect(result.missingFields).toContain('Users');
  });

  // [TEST:WRITE] partial-request-missing-multiple
  it('detects partial when multiple fields are blank', () => {
    const result = detectEmpty('Feature: password reset; Users: ; Main goal:');
    expect(result.isPartial).toBe(true);
    expect(result.missingFields).toContain('Users');
    expect(result.missingFields).toContain('Main goal');
  });

  // --- Acceptance Criterion 6 ---
  // Given an inaccessible attachment reference, the assistant asks to paste or summarize.
  // [TEST:WRITE] detect-attachment-reference
  it('detects inaccessible attachment reference', () => {
    const result = detectEmpty('Use the attached doc to write a spec');
    expect(result.isEmpty).toBe(false);
    expect(result.hasInaccessibleAttachment).toBe(true);
  });

  // [TEST:WRITE] detect-attachment-see-attached
  it('detects "see attached" as an inaccessible attachment', () => {
    const result = detectEmpty('Write a spec based on the attached file');
    expect(result.hasInaccessibleAttachment).toBe(true);
  });

  // --- Edge Cases from spec ---
  // [TEST:WRITE] edge-write-a-spec-bare
  it('detects empty for bare "Write a spec" with no subject', () => {
    const result = detectEmpty('Write a spec');
    expect(result.isEmpty).toBe(true);
  });

  // [TEST:WRITE] edge-write-spec-for-login
  it('does NOT detect empty for "write a spec for login"', () => {
    const result = detectEmpty('write a spec for login');
    expect(result.isEmpty).toBe(false);
  });

  // [TEST:WRITE] edge-same-as-above-no-context
  it('detects empty for "same as above" with no prior context', () => {
    const result = detectEmpty('same as above');
    expect(result.isEmpty).toBe(true);
    expect(result.reason).toMatch(/no prior|restate|context/i);
  });

  // [TEST:WRITE] only-punctuation
  it('detects empty for punctuation-only input', () => {
    const result = detectEmpty('...');
    expect(result.isEmpty).toBe(true);
  });

  // [TEST:WRITE] only-whitespace
  it('detects empty for whitespace-only input', () => {
    const result = detectEmpty('   ');
    expect(result.isEmpty).toBe(true);
  });

  // [TEST:WRITE] empty-string
  it('detects empty for an empty string', () => {
    const result = detectEmpty('');
    expect(result.isEmpty).toBe(true);
  });
});
