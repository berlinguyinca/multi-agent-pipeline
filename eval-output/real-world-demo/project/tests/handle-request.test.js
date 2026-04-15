import { describe, it, expect } from 'vitest';
import { handleRequest } from '../src/index.js';

describe('handleRequest (integration)', () => {
  // --- Test Cases from spec table ---

  // [TEST:WRITE] integration-empty-marker
  it('"User\'s request:" → asks for the missing specification topic', () => {
    const response = handleRequest("User's request:");
    expect(response).toMatch(/empty|missing/i);
    expect(response).toMatch(/describe|what.*spec|what.*want/i);
  });

  // [TEST:WRITE] integration-whitespace-marker
  it('"User\'s request:   " → asks for the missing specification topic', () => {
    const response = handleRequest("User's request:   ");
    expect(response).toMatch(/empty|missing/i);
  });

  // [TEST:WRITE] integration-tbd
  it('"User\'s request: TBD" → asks for the missing specification topic', () => {
    const response = handleRequest("User's request: TBD");
    expect(response).toMatch(/empty|missing/i);
  });

  // [TEST:WRITE] integration-write-a-spec
  it('"Write a spec" → asks what the specification is for', () => {
    const response = handleRequest('Write a spec');
    expect(response).toMatch(/empty|missing|what/i);
  });

  // [TEST:WRITE] integration-non-empty-onboarding
  it('"Write a spec for onboarding new admins" → returns null (proceed)', () => {
    const response = handleRequest('Write a spec for onboarding new admins');
    expect(response).toBeNull();
  });

  // [TEST:WRITE] integration-attachment-no-access
  it('"Use the attached doc to write a spec" → asks to paste or summarize', () => {
    const response = handleRequest('Use the attached doc to write a spec');
    expect(response).toMatch(/paste|summarize/i);
  });

  // [TEST:WRITE] integration-non-empty-feature
  it('"Feature: billing alerts" → returns null (proceed)', () => {
    const response = handleRequest('Feature: billing alerts');
    expect(response).toBeNull();
  });

  // [TEST:WRITE] integration-template-present
  it('empty request response includes a template', () => {
    const response = handleRequest("User's request:");
    expect(response).toMatch(/product|feature/i);
    expect(response).toMatch(/goal|users|constraints/i);
  });

  // [TEST:WRITE] integration-no-invented-requirements
  it('empty request response does not invent requirements', () => {
    const response = handleRequest('Write a spec');
    expect(response).not.toMatch(/## (Requirements|Features|Architecture|Implementation)/i);
    expect(response).not.toMatch(/the system (shall|must|will) /i);
  });
});
