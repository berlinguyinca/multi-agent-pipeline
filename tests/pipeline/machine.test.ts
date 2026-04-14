import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { pipelineMachine } from '../../src/pipeline/machine.js';
import type {
  Spec,
  ReviewedSpec,
  RefinementScore,
  ExecutionResult,
  QaAssessment,
  DocumentationResult,
} from '../../src/types/spec.js';
import type { PipelineContext } from '../../src/types/pipeline.js';

function makeContext(): PipelineContext {
  return {
    prompt: '',
    spec: null,
    reviewedSpec: null,
    iteration: 1,
    refinementScores: [],
    qaAssessments: [],
    specQaIterations: 0,
    codeQaIterations: 0,
    agents: {
      spec: { type: 'claude' },
      review: { type: 'codex' },
      qa: { type: 'codex' },
      execute: { type: 'claude' },
      docs: { type: 'claude' },
    },
    outputDir: './output',
    feedbackHistory: [],
    pipelineId: 'test-id',
    startedAt: new Date(),
  };
}

const mockSpec: Spec = {
  content: '# Test Spec\n- [ ] First criterion',
  version: 1,
  createdAt: new Date(),
  acceptanceCriteria: ['First criterion'],
};

const mockReviewedSpec: ReviewedSpec = {
  content: '# Reviewed Spec\n- [ ] First criterion\n- [ ] Added criterion',
  version: 1,
  annotations: [{ type: 'improvement', text: 'Added missing criterion' }],
  originalSpecVersion: 1,
};

const mockScore: RefinementScore = {
  iteration: 1,
  score: 72,
  completeness: 0.8,
  testability: 0.7,
  specificity: 0.65,
  timestamp: new Date(),
};

const mockResult: ExecutionResult = {
  success: true,
  testsTotal: 5,
  testsPassing: 5,
  testsFailing: 0,
  filesCreated: ['src/index.ts', 'tests/index.test.ts'],
  outputDir: './output',
  duration: 4500,
};

const mockDocsResult: DocumentationResult = {
  filesUpdated: ['README.md'],
  outputDir: './output',
  duration: 500,
  rawOutput: 'Documentation updated',
};

const passingSpecQa: QaAssessment = {
  passed: true,
  target: 'spec',
  summary: 'Spec is ready',
  findings: [],
  requiredChanges: [],
  rawOutput: 'QA_RESULT: pass',
  duration: 100,
};

const passingCodeQa: QaAssessment = {
  passed: true,
  target: 'code',
  summary: 'Code is ready',
  findings: [],
  requiredChanges: [],
  rawOutput: 'QA_RESULT: pass',
  duration: 100,
};

const failingSpecQa: QaAssessment = {
  passed: false,
  target: 'spec',
  summary: 'Spec needs work',
  findings: ['Missing edge cases'],
  requiredChanges: ['Add edge cases'],
  rawOutput: 'QA_RESULT: fail',
  duration: 100,
};

function createTestActor() {
  const context = makeContext();
  return createActor(pipelineMachine, {
    snapshot: pipelineMachine.resolveState({
      value: 'idle',
      context,
    }),
  });
}

describe('Pipeline State Machine', () => {
  describe('happy path: idle → specifying → reviewing → specAssessing → feedback → executing → codeAssessing → documenting → complete', () => {
    it('transitions through all stages', () => {
      const actor = createTestActor();
      actor.start();

      expect(actor.getSnapshot().value).toBe('idle');

      actor.send({ type: 'START', prompt: 'Build a REST API' });
      expect(actor.getSnapshot().value).toBe('specifying');
      expect(actor.getSnapshot().context.prompt).toBe('Build a REST API');

      actor.send({ type: 'SPEC_COMPLETE', spec: mockSpec });
      expect(actor.getSnapshot().value).toBe('reviewing');
      expect(actor.getSnapshot().context.spec).toEqual(mockSpec);

      actor.send({ type: 'REVIEW_COMPLETE', reviewedSpec: mockReviewedSpec, score: mockScore });
      expect(actor.getSnapshot().value).toBe('specAssessing');

      actor.send({ type: 'SPEC_QA_COMPLETE', assessment: passingSpecQa, maxReached: false });
      expect(actor.getSnapshot().value).toBe('feedback');
      expect(actor.getSnapshot().context.reviewedSpec).toEqual(mockReviewedSpec);
      expect(actor.getSnapshot().context.refinementScores).toHaveLength(1);
      expect(actor.getSnapshot().context.qaAssessments).toHaveLength(1);

      actor.send({ type: 'APPROVE' });
      expect(actor.getSnapshot().value).toBe('executing');

      actor.send({ type: 'EXECUTE_COMPLETE', result: mockResult });
      expect(actor.getSnapshot().value).toBe('codeAssessing');

      actor.send({ type: 'CODE_QA_COMPLETE', assessment: passingCodeQa, maxReached: false });
      expect(actor.getSnapshot().value).toBe('documenting');

      actor.send({ type: 'DOCS_COMPLETE', result: mockDocsResult });
      expect(actor.getSnapshot().value).toBe('complete');
      expect(actor.getSnapshot().context.executionResult).toEqual(mockResult);
      expect(actor.getSnapshot().context.documentationResult).toEqual(mockDocsResult);

      actor.stop();
    });
  });

  describe('feedback loop: feedback → specifying → reviewing → feedback', () => {
    it('loops back on FEEDBACK event', () => {
      const actor = createTestActor();
      actor.start();

      actor.send({ type: 'START', prompt: 'Build something' });
      actor.send({ type: 'SPEC_COMPLETE', spec: mockSpec });
      actor.send({ type: 'REVIEW_COMPLETE', reviewedSpec: mockReviewedSpec, score: mockScore });
      actor.send({ type: 'SPEC_QA_COMPLETE', assessment: passingSpecQa, maxReached: false });

      expect(actor.getSnapshot().value).toBe('feedback');
      expect(actor.getSnapshot().context.iteration).toBe(1);

      // Send feedback — should loop back to specifying
      actor.send({ type: 'FEEDBACK', text: 'Add rate limiting' });

      expect(actor.getSnapshot().value).toBe('specifying');
      expect(actor.getSnapshot().context.iteration).toBe(2);
      expect(actor.getSnapshot().context.feedbackHistory).toEqual(['Add rate limiting']);
      expect(actor.getSnapshot().context.spec).toBeNull();
      expect(actor.getSnapshot().context.reviewedSpec).toBeNull();

      // Complete second iteration
      actor.send({ type: 'SPEC_COMPLETE', spec: { ...mockSpec, version: 2 } });
      actor.send({
        type: 'REVIEW_COMPLETE',
        reviewedSpec: { ...mockReviewedSpec, version: 2 },
        score: { ...mockScore, iteration: 2, score: 85 },
      });
      actor.send({
        type: 'SPEC_QA_COMPLETE',
        assessment: { ...passingSpecQa, duration: 120 },
        maxReached: false,
      });

      expect(actor.getSnapshot().value).toBe('feedback');
      expect(actor.getSnapshot().context.refinementScores).toHaveLength(2);

      actor.stop();
    });

    it('loops back to specifying when spec QA fails below max attempts', () => {
      const actor = createTestActor();
      actor.start();

      actor.send({ type: 'START', prompt: 'test' });
      actor.send({ type: 'SPEC_COMPLETE', spec: mockSpec });
      actor.send({ type: 'REVIEW_COMPLETE', reviewedSpec: mockReviewedSpec, score: mockScore });
      actor.send({ type: 'SPEC_QA_COMPLETE', assessment: failingSpecQa, maxReached: false });

      expect(actor.getSnapshot().value).toBe('specifying');
      expect(actor.getSnapshot().context.iteration).toBe(2);
      expect(actor.getSnapshot().context.feedbackHistory).toEqual(['Add edge cases']);
      actor.stop();
    });
  });

  describe('cancellation from any active state', () => {
    it('cancels from specifying', () => {
      const actor = createTestActor();
      actor.start();
      actor.send({ type: 'START', prompt: 'test' });
      actor.send({ type: 'CANCEL' });
      expect(actor.getSnapshot().value).toBe('cancelled');
      actor.stop();
    });

    it('cancels from reviewing', () => {
      const actor = createTestActor();
      actor.start();
      actor.send({ type: 'START', prompt: 'test' });
      actor.send({ type: 'SPEC_COMPLETE', spec: mockSpec });
      actor.send({ type: 'CANCEL' });
      expect(actor.getSnapshot().value).toBe('cancelled');
      actor.stop();
    });

    it('cancels from feedback', () => {
      const actor = createTestActor();
      actor.start();
      actor.send({ type: 'START', prompt: 'test' });
      actor.send({ type: 'SPEC_COMPLETE', spec: mockSpec });
      actor.send({ type: 'REVIEW_COMPLETE', reviewedSpec: mockReviewedSpec, score: mockScore });
      actor.send({ type: 'SPEC_QA_COMPLETE', assessment: passingSpecQa, maxReached: false });
      actor.send({ type: 'CANCEL' });
      expect(actor.getSnapshot().value).toBe('cancelled');
      actor.stop();
    });

    it('cancels from executing', () => {
      const actor = createTestActor();
      actor.start();
      actor.send({ type: 'START', prompt: 'test' });
      actor.send({ type: 'SPEC_COMPLETE', spec: mockSpec });
      actor.send({ type: 'REVIEW_COMPLETE', reviewedSpec: mockReviewedSpec, score: mockScore });
      actor.send({ type: 'SPEC_QA_COMPLETE', assessment: passingSpecQa, maxReached: false });
      actor.send({ type: 'APPROVE' });
      actor.send({ type: 'CANCEL' });
      expect(actor.getSnapshot().value).toBe('cancelled');
      actor.stop();
    });

    it('cancels from documenting', () => {
      const actor = createTestActor();
      actor.start();
      actor.send({ type: 'START', prompt: 'test' });
      actor.send({ type: 'SPEC_COMPLETE', spec: mockSpec });
      actor.send({ type: 'REVIEW_COMPLETE', reviewedSpec: mockReviewedSpec, score: mockScore });
      actor.send({ type: 'SPEC_QA_COMPLETE', assessment: passingSpecQa, maxReached: false });
      actor.send({ type: 'APPROVE' });
      actor.send({ type: 'EXECUTE_COMPLETE', result: mockResult });
      actor.send({ type: 'CODE_QA_COMPLETE', assessment: passingCodeQa, maxReached: false });
      actor.send({ type: 'CANCEL' });
      expect(actor.getSnapshot().value).toBe('cancelled');
      actor.stop();
    });
  });

  describe('error handling', () => {
    it('transitions to failed on ERROR from specifying', () => {
      const actor = createTestActor();
      actor.start();
      actor.send({ type: 'START', prompt: 'test' });
      actor.send({ type: 'ERROR', error: 'Claude crashed' });
      expect(actor.getSnapshot().value).toBe('failed');
      expect(actor.getSnapshot().context.error).toBe('Claude crashed');
      actor.stop();
    });

    it('transitions to failed on ERROR from reviewing', () => {
      const actor = createTestActor();
      actor.start();
      actor.send({ type: 'START', prompt: 'test' });
      actor.send({ type: 'SPEC_COMPLETE', spec: mockSpec });
      actor.send({ type: 'ERROR', error: 'Codex crashed' });
      expect(actor.getSnapshot().value).toBe('failed');
      actor.stop();
    });

    it('transitions to failed on ERROR from executing', () => {
      const actor = createTestActor();
      actor.start();
      actor.send({ type: 'START', prompt: 'test' });
      actor.send({ type: 'SPEC_COMPLETE', spec: mockSpec });
      actor.send({ type: 'REVIEW_COMPLETE', reviewedSpec: mockReviewedSpec, score: mockScore });
      actor.send({ type: 'SPEC_QA_COMPLETE', assessment: passingSpecQa, maxReached: false });
      actor.send({ type: 'APPROVE' });
      actor.send({ type: 'ERROR', error: 'Tests failed' });
      expect(actor.getSnapshot().value).toBe('failed');
      actor.stop();
    });

    it('transitions to failed on ERROR from documenting', () => {
      const actor = createTestActor();
      actor.start();
      actor.send({ type: 'START', prompt: 'test' });
      actor.send({ type: 'SPEC_COMPLETE', spec: mockSpec });
      actor.send({ type: 'REVIEW_COMPLETE', reviewedSpec: mockReviewedSpec, score: mockScore });
      actor.send({ type: 'SPEC_QA_COMPLETE', assessment: passingSpecQa, maxReached: false });
      actor.send({ type: 'APPROVE' });
      actor.send({ type: 'EXECUTE_COMPLETE', result: mockResult });
      actor.send({ type: 'CODE_QA_COMPLETE', assessment: passingCodeQa, maxReached: false });
      actor.send({ type: 'ERROR', error: 'Docs changed source files' });
      expect(actor.getSnapshot().value).toBe('failed');
      expect(actor.getSnapshot().context.error).toBe('Docs changed source files');
      actor.stop();
    });

    it('allows recovery from failed via FEEDBACK', () => {
      const actor = createTestActor();
      actor.start();
      actor.send({ type: 'START', prompt: 'test' });
      actor.send({ type: 'ERROR', error: 'Something broke' });
      expect(actor.getSnapshot().value).toBe('failed');

      actor.send({ type: 'FEEDBACK', text: 'Try a different approach' });
      expect(actor.getSnapshot().value).toBe('specifying');
      expect(actor.getSnapshot().context.error).toBeUndefined();
      actor.stop();
    });
  });

  describe('resume', () => {
    it('resumes to feedback state from idle', () => {
      const actor = createTestActor();
      actor.start();
      actor.send({ type: 'RESUME', pipelineId: 'saved-id' });
      expect(actor.getSnapshot().value).toBe('feedback');
      actor.stop();
    });
  });
});
