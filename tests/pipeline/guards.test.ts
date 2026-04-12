import { describe, it, expect } from 'vitest';
import { hasSpec, hasReviewedSpec, hasExecutionResult, isExecutionSuccessful } from '../../src/pipeline/guards.js';
import type { PipelineContext } from '../../src/types/pipeline.js';

function makeContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    prompt: 'test',
    spec: null,
    reviewedSpec: null,
    iteration: 1,
    refinementScores: [],
    agents: {
      spec: { type: 'claude' },
      review: { type: 'codex' },
      execute: { type: 'claude' },
    },
    outputDir: './output',
    feedbackHistory: [],
    pipelineId: 'test-id',
    startedAt: new Date(),
    ...overrides,
  };
}

describe('hasSpec', () => {
  it('returns false when spec is null', () => {
    expect(hasSpec(makeContext())).toBe(false);
  });

  it('returns true when spec exists', () => {
    expect(
      hasSpec(
        makeContext({
          spec: { content: 'test', version: 1, createdAt: new Date(), acceptanceCriteria: [] },
        }),
      ),
    ).toBe(true);
  });
});

describe('hasReviewedSpec', () => {
  it('returns false when reviewedSpec is null', () => {
    expect(hasReviewedSpec(makeContext())).toBe(false);
  });

  it('returns true when reviewedSpec exists', () => {
    expect(
      hasReviewedSpec(
        makeContext({
          reviewedSpec: { content: 'test', version: 1, annotations: [], originalSpecVersion: 1 },
        }),
      ),
    ).toBe(true);
  });
});

describe('hasExecutionResult', () => {
  it('returns false when no result', () => {
    expect(hasExecutionResult(makeContext())).toBe(false);
  });

  it('returns true when result exists', () => {
    expect(
      hasExecutionResult(
        makeContext({
          executionResult: {
            success: true,
            testsTotal: 5,
            testsPassing: 5,
            testsFailing: 0,
            filesCreated: [],
            outputDir: './output',
            duration: 1000,
          },
        }),
      ),
    ).toBe(true);
  });
});

describe('isExecutionSuccessful', () => {
  it('returns false when no result', () => {
    expect(isExecutionSuccessful(makeContext())).toBe(false);
  });

  it('returns true when result is successful', () => {
    expect(
      isExecutionSuccessful(
        makeContext({
          executionResult: {
            success: true,
            testsTotal: 5,
            testsPassing: 5,
            testsFailing: 0,
            filesCreated: [],
            outputDir: './output',
            duration: 1000,
          },
        }),
      ),
    ).toBe(true);
  });

  it('returns false when result failed', () => {
    expect(
      isExecutionSuccessful(
        makeContext({
          executionResult: {
            success: false,
            testsTotal: 5,
            testsPassing: 3,
            testsFailing: 2,
            filesCreated: [],
            outputDir: './output',
            duration: 1000,
          },
        }),
      ),
    ).toBe(false);
  });
});
