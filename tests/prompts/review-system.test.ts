import { describe, it, expect } from 'vitest';
import { buildReviewPrompt } from '../../src/prompts/review-system.js';

describe('buildReviewPrompt', () => {
  it('includes the spec content', () => {
    const result = buildReviewPrompt('# My Spec\n## Goal\nBuild something');
    expect(result).toContain('# My Spec');
    expect(result).toContain('## Goal');
  });

  it('asks for scoring dimensions', () => {
    const result = buildReviewPrompt('test');
    expect(result).toContain('Completeness');
    expect(result).toContain('Testability');
    expect(result).toContain('Specificity');
  });

  it('asks for annotations with prefixes', () => {
    const result = buildReviewPrompt('test');
    expect(result).toContain('IMPROVEMENT:');
    expect(result).toContain('WARNING:');
    expect(result).toContain('APPROVAL:');
  });

  it('includes score format instruction', () => {
    const result = buildReviewPrompt('test');
    expect(result).toContain('SCORES: completeness=');
  });
});
