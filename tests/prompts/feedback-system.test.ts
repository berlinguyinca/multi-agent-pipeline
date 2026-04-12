import { describe, it, expect } from 'vitest';
import { buildFeedbackPrompt } from '../../src/prompts/feedback-system.js';

describe('buildFeedbackPrompt', () => {
  it('includes all four inputs', () => {
    const result = buildFeedbackPrompt(
      'Build a REST API',
      '## Goal\nOriginal spec',
      '## Review\nNeeds rate limiting',
      'Add rate limiting to all endpoints',
    );
    expect(result).toContain('Build a REST API');
    expect(result).toContain('Original spec');
    expect(result).toContain('Needs rate limiting');
    expect(result).toContain('Add rate limiting to all endpoints');
  });

  it('instructs to rewrite from scratch', () => {
    const result = buildFeedbackPrompt('test', 'spec', 'review', 'feedback');
    expect(result).toContain('Rewrite the entire specification from scratch');
  });

  it('includes markdown section instructions', () => {
    const result = buildFeedbackPrompt('test', 'spec', 'review', 'feedback');
    expect(result).toContain('## Goal');
    expect(result).toContain('## Acceptance Criteria');
  });
});
