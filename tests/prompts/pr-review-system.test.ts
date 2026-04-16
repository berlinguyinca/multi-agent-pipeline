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

  it('uses professional severity labels without emoji markers', () => {
    const prompt = buildPRReviewSystemPrompt();

    expect(prompt).toContain('- **CRITICAL** - Must fix before merge');
    expect(prompt).toContain('- **SUGGESTION** - Should consider fixing');
    expect(prompt).toContain('- **NIT** - Optional polish');
    expect(prompt).not.toMatch(/[\u{1F534}\u{1F7E1}\u{1F7E2}]/u);
  });
});
