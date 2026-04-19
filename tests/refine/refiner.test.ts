import { describe, expect, it } from 'vitest';
import { refinePromptHeadless, scorePromptForRefinement } from '../../src/refine/refiner.js';

describe('Socratic prompt refiner', () => {
  it('scores vague prompts and asks Socratic clarification questions', () => {
    const score = scorePromptForRefinement('Build something useful');

    expect(score.overall).toBeLessThan(0.85);
    expect(score.questions).toEqual(expect.arrayContaining([
      expect.stringContaining('primary goal'),
      expect.stringContaining('success'),
    ]));
  });

  it('produces a refined prompt with assumptions in headless mode', () => {
    const result = refinePromptHeadless({
      prompt: 'Build a tool that summarizes this repo',
      headless: true,
    });

    expect(result.mode).toBe('refine');
    expect(result.refinedPrompt).toContain('Original request');
    expect(result.refinedPrompt).toContain('Assumptions to use');
    expect(result.score.overall).toBeGreaterThanOrEqual(0.85);
    expect(result.assumptions.length).toBeGreaterThan(0);
    expect(result.questionsAsked.length).toBeGreaterThan(0);
  });

  it('recommends model installer and metadata capabilities from context', () => {
    const result = refinePromptHeadless({
      prompt: 'Install a Hugging Face chemistry model and then refactor this existing codebase',
      headless: true,
    });

    expect(result.recommendedCapabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ agent: 'model-installer' }),
      expect.objectContaining({ agent: 'codesight-metadata' }),
    ]));
  });
});
