import { describe, expect, it } from 'vitest';
import { buildPRReviewSystemPrompt } from '../../src/prompts/pr-review-system.js';

describe('buildPRReviewSystemPrompt', () => {
  it('describes the GitHub review and merge specialist role', () => {
    const prompt = buildPRReviewSystemPrompt();

    expect(prompt).toContain('GitHub review and merge specialist');
    expect(prompt).toContain('merge it only when the change is ready');
    expect(prompt).toContain('APPROVE');
    expect(prompt).toContain('REQUEST_CHANGES');
  });

  it('states that approved PRs may be merged after posting the review', () => {
    const prompt = buildPRReviewSystemPrompt();

    expect(prompt).toContain('may merge the PR after posting the review comment');
  });
});
