import { describe, it, expect } from 'vitest';
import { formatResponse } from '../src/format-response.js';

describe('formatResponse', () => {
  // --- Acceptance Criterion 7 ---
  // The assistant's empty-request response contains no invented product requirements.
  // [TEST:WRITE] no-invented-requirements-empty
  it('does not contain invented requirements for an empty request', () => {
    const detection = { isEmpty: true, reason: 'No substantive request found' };
    const response = formatResponse(detection);

    // Should not contain spec-like sections with invented content
    expect(response).not.toMatch(/## (Requirements|Features|Architecture|Implementation)/i);
    expect(response).not.toMatch(/the system (shall|must|will) /i);
  });

  // --- Acceptance Criterion 8 ---
  // The assistant's empty-request response includes a concise template or example.
  // [TEST:WRITE] includes-template-empty
  it('includes a template or example prompts for an empty request', () => {
    const detection = { isEmpty: true, reason: 'No substantive request found' };
    const response = formatResponse(detection);

    // Must include some kind of template/example lines
    expect(response).toMatch(/product|feature/i);
    expect(response).toMatch(/goal|users|constraints/i);
  });

  // --- Required Response Format ---
  // [TEST:WRITE] acknowledgement-of-missing-request
  it('acknowledges that the request is missing', () => {
    const detection = { isEmpty: true, reason: 'No substantive request found' };
    const response = formatResponse(detection);

    expect(response).toMatch(/empty|missing/i);
  });

  // [TEST:WRITE] asks-for-topic
  it('asks the user for the specification topic', () => {
    const detection = { isEmpty: true, reason: 'No substantive request found' };
    const response = formatResponse(detection);

    expect(response).toMatch(/describe|what.*spec|tell.*about|what.*want/i);
  });

  // --- Partial request response ---
  // [TEST:WRITE] partial-identifies-missing-fields
  it('identifies specific missing fields for a partial request', () => {
    const detection = {
      isEmpty: false,
      isPartial: true,
      missingFields: ['Users', 'Main goal'],
    };
    const response = formatResponse(detection);

    expect(response).toMatch(/Users/);
    expect(response).toMatch(/Main goal/);
    expect(response).not.toMatch(/empty/i);
  });

  // --- Attachment response ---
  // [TEST:WRITE] attachment-asks-to-paste
  it('asks the user to paste or summarize attachment content', () => {
    const detection = {
      isEmpty: false,
      hasInaccessibleAttachment: true,
    };
    const response = formatResponse(detection);

    expect(response).toMatch(/paste|summarize/i);
    expect(response).toMatch(/attach|content|doc/i);
  });

  // --- Non-empty request ---
  // [TEST:WRITE] non-empty-returns-null
  it('returns null for a non-empty, complete request', () => {
    const detection = {
      isEmpty: false,
      isPartial: false,
      hasInaccessibleAttachment: false,
    };
    const response = formatResponse(detection);

    expect(response).toBeNull();
  });

  // --- "same as above" with no context ---
  // [TEST:WRITE] same-as-above-response
  it('asks user to restate when reason indicates no prior context', () => {
    const detection = {
      isEmpty: true,
      reason: 'References prior context that is not available. Please restate your request.',
    };
    const response = formatResponse(detection);

    expect(response).toMatch(/restate|repeat|provide.*again/i);
  });
});
