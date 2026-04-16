import { describe, expect, it } from 'vitest';
import { buildDocsPrompt } from '../../src/prompts/docs-system.js';
import { buildExecutePrompt } from '../../src/prompts/execute-system.js';
import { buildFeedbackPrompt } from '../../src/prompts/feedback-system.js';
import { buildPRReviewSystemPrompt } from '../../src/prompts/pr-review-system.js';
import { buildCodeFixPrompt, buildCodeQaPrompt, buildSpecQaPrompt } from '../../src/prompts/qa-system.js';
import { buildReviewPrompt } from '../../src/prompts/review-system.js';
import { buildSpecPrompt } from '../../src/prompts/spec-system.js';
import type { ExecutionResult, QaAssessment } from '../../src/types/spec.js';

const CONDUCT_RULE = 'Use a professional engineering tone: direct, factual, and free of cheerleading.';
const NO_EMOJI_RULE = 'Do not use emoji, pictographs, decorative symbols, or playful reaction markers.';
const READABLE_OUTPUT_RULE = 'Generate code and text output in a human-readable form.';
const EVIDENCE_RULE = 'Ground factual claims in provided context, retrieved evidence, tool output, or clearly labeled assumptions.';
const UNCERTAINTY_RULE = 'When evidence is missing or conflicting, say what is unknown instead of inventing certainty.';
const BINARY_EXCEPTION_RULE = 'Exceptions are allowed only for explicitly requested binary or media artifacts';

const executionResult: ExecutionResult = {
  success: true,
  testsTotal: 1,
  testsPassing: 1,
  testsFailing: 0,
  filesCreated: ['src/index.ts'],
  outputDir: './output/demo',
  duration: 10,
};

const qaAssessment: QaAssessment = {
  passed: true,
  target: 'code',
  summary: 'Ready',
  findings: [],
  requiredChanges: [],
  rawOutput: 'QA_RESULT: pass',
  duration: 10,
};

describe('classic agent prompt conduct', () => {
  it('adds professional no-emoji conduct rules to every fixed-stage prompt', () => {
    const prompts = [
      buildSpecPrompt('Build a CLI'),
      buildSpecPrompt('Build a CLI', { feedbackText: 'Add tests', iteration: 1, previousSpecVersion: 1 }),
      buildReviewPrompt('# Spec'),
      buildFeedbackPrompt('Build a CLI', '# Spec', 'Review', 'Feedback'),
      buildSpecQaPrompt('Build a CLI', '# Reviewed Spec'),
      buildExecutePrompt('# Reviewed Spec'),
      buildCodeQaPrompt('# Reviewed Spec', executionResult, 'src/index.ts'),
      buildCodeFixPrompt('# Reviewed Spec', 'REQUIRED_CHANGE: Add tests', './output/demo'),
      buildDocsPrompt({
        reviewedSpecContent: '# Reviewed Spec',
        executionResult,
        qaAssessments: [qaAssessment],
        projectSnapshot: 'README.md',
      }),
      buildPRReviewSystemPrompt(),
    ];

    for (const prompt of prompts) {
      expect(prompt).toContain(CONDUCT_RULE);
      expect(prompt).toContain(NO_EMOJI_RULE);
      expect(prompt).toContain(READABLE_OUTPUT_RULE);
      expect(prompt).toContain(EVIDENCE_RULE);
      expect(prompt).toContain(UNCERTAINTY_RULE);
      expect(prompt).toContain(BINARY_EXCEPTION_RULE);
    }
  });
});
