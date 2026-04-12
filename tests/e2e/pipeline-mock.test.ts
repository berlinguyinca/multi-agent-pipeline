import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { pipelineMachine } from '../../src/pipeline/machine.js';
import { createPipelineContext } from '../../src/pipeline/context.js';
import type { Spec, ReviewedSpec, RefinementScore, ExecutionResult } from '../../src/types/spec.js';

describe('E2E: Full Pipeline Flow with Mock Data', () => {
  it('completes a full pipeline: spec → review → approve → execute → complete', () => {
    const context = createPipelineContext({
      prompt: 'Build a hello world CLI tool',
      agents: {
        spec: { type: 'claude' },
        review: { type: 'codex' },
        execute: { type: 'claude' },
      },
    });

    const actor = createActor(pipelineMachine, {
      snapshot: pipelineMachine.resolveState({ value: 'idle', context }),
    });
    actor.start();

    // Stage 1: Start → Specifying
    expect(actor.getSnapshot().value).toBe('idle');
    actor.send({ type: 'START', prompt: 'Build a hello world CLI tool' });
    expect(actor.getSnapshot().value).toBe('specifying');

    // Stage 1 completes: Spec generated
    const spec: Spec = {
      content: '# Hello World CLI\n## Goal\nBuild a CLI that prints hello world\n## Acceptance Criteria\n- [ ] Running `hello` prints "Hello, World!"',
      version: 1,
      createdAt: new Date(),
      acceptanceCriteria: ['Running `hello` prints "Hello, World!"'],
    };
    actor.send({ type: 'SPEC_COMPLETE', spec });
    expect(actor.getSnapshot().value).toBe('reviewing');

    // Stage 2 completes: Review done
    const reviewedSpec: ReviewedSpec = {
      content: spec.content + '\n- [ ] Running `hello --name Alice` prints "Hello, Alice!"',
      version: 1,
      annotations: [
        { type: 'improvement', text: 'Added personalization feature' },
        { type: 'approval', text: 'Goal is clear and testable' },
      ],
      originalSpecVersion: 1,
    };
    const score: RefinementScore = {
      iteration: 1,
      score: 85,
      completeness: 0.9,
      testability: 0.85,
      specificity: 0.8,
      timestamp: new Date(),
    };
    actor.send({ type: 'REVIEW_COMPLETE', reviewedSpec, score });
    expect(actor.getSnapshot().value).toBe('feedback');
    expect(actor.getSnapshot().context.refinementScores).toHaveLength(1);
    expect(actor.getSnapshot().context.refinementScores[0].score).toBe(85);

    // User approves → Execution
    actor.send({ type: 'APPROVE' });
    expect(actor.getSnapshot().value).toBe('executing');

    // Execution completes
    const result: ExecutionResult = {
      success: true,
      testsTotal: 2,
      testsPassing: 2,
      testsFailing: 0,
      filesCreated: ['src/index.ts', 'tests/index.test.ts', 'package.json'],
      outputDir: './output/hello-cli',
      duration: 3200,
    };
    actor.send({ type: 'EXECUTE_COMPLETE', result });
    expect(actor.getSnapshot().value).toBe('complete');
    expect(actor.getSnapshot().context.executionResult?.success).toBe(true);
    expect(actor.getSnapshot().context.executionResult?.testsPassing).toBe(2);

    actor.stop();
  });

  it('handles feedback loop: spec → review → feedback → re-spec → re-review → approve → execute', () => {
    const context = createPipelineContext({
      prompt: 'Build a task API',
      agents: {
        spec: { type: 'claude' },
        review: { type: 'codex' },
        execute: { type: 'ollama', model: 'codellama' },
      },
    });

    const actor = createActor(pipelineMachine, {
      snapshot: pipelineMachine.resolveState({ value: 'idle', context }),
    });
    actor.start();

    // First iteration
    actor.send({ type: 'START', prompt: 'Build a task API' });
    actor.send({
      type: 'SPEC_COMPLETE',
      spec: { content: 'v1 spec', version: 1, createdAt: new Date(), acceptanceCriteria: ['CRUD'] },
    });
    actor.send({
      type: 'REVIEW_COMPLETE',
      reviewedSpec: { content: 'v1 reviewed', version: 1, annotations: [], originalSpecVersion: 1 },
      score: { iteration: 1, score: 60, completeness: 0.6, testability: 0.5, specificity: 0.7, timestamp: new Date() },
    });

    expect(actor.getSnapshot().value).toBe('feedback');
    expect(actor.getSnapshot().context.iteration).toBe(1);

    // User provides feedback → loops back
    actor.send({ type: 'FEEDBACK', text: 'Add rate limiting and pagination' });
    expect(actor.getSnapshot().value).toBe('specifying');
    expect(actor.getSnapshot().context.iteration).toBe(2);
    expect(actor.getSnapshot().context.feedbackHistory).toContain('Add rate limiting and pagination');

    // Second iteration
    actor.send({
      type: 'SPEC_COMPLETE',
      spec: { content: 'v2 spec with rate limiting', version: 2, createdAt: new Date(), acceptanceCriteria: ['CRUD', 'Rate limiting', 'Pagination'] },
    });
    actor.send({
      type: 'REVIEW_COMPLETE',
      reviewedSpec: { content: 'v2 reviewed', version: 2, annotations: [], originalSpecVersion: 2 },
      score: { iteration: 2, score: 90, completeness: 0.95, testability: 0.9, specificity: 0.85, timestamp: new Date() },
    });

    expect(actor.getSnapshot().context.refinementScores).toHaveLength(2);
    expect(actor.getSnapshot().context.refinementScores[1].score).toBe(90);

    // Approve and execute
    actor.send({ type: 'APPROVE' });
    actor.send({
      type: 'EXECUTE_COMPLETE',
      result: { success: true, testsTotal: 6, testsPassing: 6, testsFailing: 0, filesCreated: [], outputDir: './output', duration: 5000 },
    });

    expect(actor.getSnapshot().value).toBe('complete');
    expect(actor.getSnapshot().context.iteration).toBe(2);

    actor.stop();
  });

  it('handles cancel and error recovery', () => {
    const context = createPipelineContext({
      prompt: 'test',
      agents: {
        spec: { type: 'claude' },
        review: { type: 'codex' },
        execute: { type: 'claude' },
      },
    });

    const actor = createActor(pipelineMachine, {
      snapshot: pipelineMachine.resolveState({ value: 'idle', context }),
    });
    actor.start();

    // Start and fail
    actor.send({ type: 'START', prompt: 'test' });
    actor.send({ type: 'ERROR', error: 'Agent crashed' });
    expect(actor.getSnapshot().value).toBe('failed');
    expect(actor.getSnapshot().context.error).toBe('Agent crashed');

    // Recover with feedback
    actor.send({ type: 'FEEDBACK', text: 'Try with different approach' });
    expect(actor.getSnapshot().value).toBe('specifying');
    expect(actor.getSnapshot().context.error).toBeUndefined();

    actor.stop();
  });
});
