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




  it('uses task-specific deterministic fallback questions for PubChem software sync requests', () => {
    const score = scorePromptForRefinement('I require local software to download PubChem data without being rate throttled and convert compound and substance files to Markdown');

    expect(score.questions).toEqual(expect.arrayContaining([
      expect.stringContaining('PubChem distribution source'),
      expect.stringContaining('bulk dumps'),
      expect.stringContaining('Markdown output layout'),
    ]));
    expect(score.questions).not.toContain('What is the primary goal and why does it matter?');
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

  it('adds follow-up success questions from existing clarifications', () => {
    const result = refinePromptHeadless({
      prompt: 'Build a PubChem sync tool that converts records to Markdown',
      headless: true,
      questionDetails: [
        {
          question: 'Which PubChem distribution source should be authoritative?',
          reason: 'The source controls file layout and rate limits.',
          defaultAssumption: 'Use FTP bulk dumps.',
        },
      ],
      answers: ['Use FTP bulk dumps for compound and substance data.'],
    });

    expect(result.successQuestionsAsked.length).toBeGreaterThanOrEqual(2);
    expect(result.successQuestionsAsked.join('\n')).toContain('PubChem');
    expect(result.successQuestionsAsked.join('\n')).toContain('FTP bulk dumps');
    expect(result.refinedPrompt).toContain('Follow-up success questions');
    expect(result.refinedPrompt).toContain('Definition of done');
    expect(result.refinedPrompt).toContain('Use FTP bulk dumps for compound and substance data.');
  });

  it('incorporates success follow-up answers into the definition of done', () => {
    const result = refinePromptHeadless({
      prompt: 'Build a HMDB downloader that converts metabolite records to Markdown',
      headless: true,
      answers: ['Use HMDB XML exports and write Markdown files.'],
      successAnswers: [
        'Done means 1000 non-empty Markdown records with HMDB accession, name, formula, and source fields.',
        'Verification must run unit tests plus a fixture conversion command and inspect generated files.',
      ],
    });

    expect(result.successAnswers).toHaveLength(2);
    expect(result.successCriteria).toEqual(expect.arrayContaining([
      expect.stringContaining('1000 non-empty Markdown records'),
      expect.stringContaining('fixture conversion command'),
    ]));
    expect(result.refinedPrompt).toContain('Follow-up success answers');
    expect(result.refinedPrompt).toContain('Done means 1000 non-empty Markdown records');
    expect(result.refinedPrompt).toContain('Definition of done');
    expect(result.refinedPrompt).toContain('Use this definition of done');
  });

  it('adds PubMed-backed done criteria for concise chemical taxonomy and usage reports', () => {
    const result = refinePromptHeadless({
      prompt: 'please provide a classification and taxonomy report for cocaine as well as usages for it on the medical and metabolomics field. Keep this short and assume this will presented to a customer inside a handful of XLS cells. Ensure that correctness is judged fairly and only report the output tables and the graph plot. Nothing else',
      headless: true,
    });

    expect(result.successCriteria).toEqual(expect.arrayContaining([
      expect.stringContaining('PubMed/NCBI'),
    ]));
    expect(result.successCriteria).toEqual(expect.arrayContaining([
      expect.stringContaining('DrugBank/PubChem/ChEBI/HMDB/KEGG/ChEMBL/MeSH/NCBI'),
    ]));
    expect(result.refinedPrompt).toContain('every table cell is populated');
    expect(result.refinedPrompt).toContain('at least three distinct verification perspectives');
    expect(result.refinedPrompt).toContain('usage evidence is separated from caveats and from commonness evidence');
    expect(result.recommendedCapabilities.map((capability) => capability.agent)).toEqual(expect.arrayContaining([
      'classyfire-taxonomy-classifier',
      'usage-classification-tree',
    ]));
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
