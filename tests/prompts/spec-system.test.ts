import { describe, it, expect } from 'vitest';
import { buildSpecPrompt } from '../../src/prompts/spec-system.js';

describe('buildSpecPrompt', () => {
  it('includes user prompt', () => {
    const result = buildSpecPrompt('Build a REST API');
    expect(result).toContain('Build a REST API');
  });

  it('includes acceptance criteria section instruction', () => {
    const result = buildSpecPrompt('test');
    expect(result).toContain('## Acceptance Criteria');
    expect(result).toContain('- [ ]');
  });

  it('includes feedback when provided', () => {
    const result = buildSpecPrompt('test', {
      feedbackText: 'Add rate limiting',
      iteration: 1,
      previousSpecVersion: 1,
    });
    expect(result).toContain('Add rate limiting');
    expect(result).toContain('iteration 2');
  });

  it('does not include feedback section when no feedback', () => {
    const result = buildSpecPrompt('test');
    expect(result).not.toContain('IMPORTANT: This is iteration');
  });
});
