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


  it('includes unanswered Socratic questions in the refined prompt', () => {
    const result = refinePromptHeadless({
      prompt: 'Build something useful',
      headless: true,
    });

    expect(result.questionsAsked.length).toBeGreaterThan(0);
    expect(result.refinedPrompt).toContain('Questions to answer before execution');
    expect(result.refinedPrompt).toContain('What is the primary goal');
  });



  it('uses generated task-specific question details when provided', () => {
    const result = refinePromptHeadless({
      prompt: 'Build a PubChem sync tool',
      headless: true,
      questionDetails: [
        {
          question: 'Which PubChem distribution source should be authoritative: FTP bulk dumps, PUG-REST, PUG-View, or another endpoint?',
          reason: 'Different sources have different rate limits and file layouts.',
          defaultAssumption: 'Prefer FTP bulk dumps for full-database sync.',
        },
      ],
    });

    expect(result.questionsAsked).toEqual([
      expect.stringContaining('PubChem distribution source'),
    ]);
    expect(result.questionDetails[0]).toMatchObject({
      reason: expect.stringContaining('rate limits'),
      defaultAssumption: expect.stringContaining('FTP bulk dumps'),
    });
    expect(result.refinedPrompt).toContain('Why it matters: Different sources have different rate limits');
    expect(result.refinedPrompt).toContain('Default if unanswered: Prefer FTP bulk dumps');
  });

  it('incorporates collected answers into the refined prompt', () => {
    const initial = refinePromptHeadless({
      prompt: 'Build something useful',
      headless: true,
    });
    const result = refinePromptHeadless({
      prompt: 'Build something useful',
      headless: true,
      answers: initial.questionsAsked.map((question) => `Answer for: ${question}`),
    });

    expect(result.answers).toHaveLength(initial.questionsAsked.length);
    expect(result.refinedPrompt).toContain('Answers provided');
    expect(result.refinedPrompt).toContain('Use these user-provided answers');
    expect(result.refinedPrompt).toContain('Answer for: What is the primary goal');
  });

  it('does not recommend chemical classification agents for PubChem software sync requests', () => {
    const result = refinePromptHeadless({
      prompt: 'Develop local software to synchronize PubChem compound and substance files and convert them to Markdown',
      headless: true,
    });

    expect(result.recommendedCapabilities.map((capability) => capability.agent)).toContain('codesight-metadata');
    expect(result.recommendedCapabilities.map((capability) => capability.agent)).not.toContain('classyfire-taxonomy-classifier');
    expect(result.recommendedCapabilities.map((capability) => capability.agent)).not.toContain('usage-classification-tree');
    expect(result.refinedPrompt).not.toContain('classyfire-taxonomy-classifier');
    expect(result.refinedPrompt).not.toContain('usage-classification-tree');
  });

});
