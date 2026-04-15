import { describe, it, expect } from 'vitest';
import { createPipelineContext } from '../../src/pipeline/context.js';

describe('createPipelineContext', () => {
  it('creates context with required fields', () => {
    const ctx = createPipelineContext({
      prompt: 'Build a REST API',
      agents: {
        spec: { type: 'claude' },
        review: { type: 'codex' },
        qa: { type: 'codex' },
        execute: { type: 'claude' },
        docs: { type: 'claude' },
      },
    });

    expect(ctx.prompt).toBe('Build a REST API');
    expect(ctx.spec).toBeNull();
    expect(ctx.reviewedSpec).toBeNull();
    expect(ctx.iteration).toBe(1);
    expect(ctx.refinementScores).toEqual([]);
    expect(ctx.qaAssessments).toEqual([]);
    expect(ctx.specQaIterations).toBe(0);
    expect(ctx.codeQaIterations).toBe(0);
    expect(ctx.feedbackHistory).toEqual([]);
    expect(ctx.outputDir).toBe('./output');
    expect(ctx.pipelineId).toMatch(/^[0-9a-f-]+$/);
    expect(ctx.startedAt).toBeInstanceOf(Date);
  });

  it('uses custom outputDir', () => {
    const ctx = createPipelineContext({
      prompt: 'test',
      agents: {
        spec: { type: 'claude' },
        review: { type: 'codex' },
        qa: { type: 'codex' },
        execute: { type: 'claude' },
        docs: { type: 'claude' },
      },
      outputDir: '/custom/path',
    });

    expect(ctx.outputDir).toBe('/custom/path');
  });

  it('stores an initial spec when provided', () => {
    const ctx = createPipelineContext({
      prompt: 'review this spec',
      initialSpec: '# Imported Spec',
      specFilePath: 'docs/spec.md',
      agents: {
        spec: { type: 'claude' },
        review: { type: 'codex' },
        qa: { type: 'codex' },
        execute: { type: 'claude' },
        docs: { type: 'claude' },
      },
    });

    expect(ctx.initialSpec).toBe('# Imported Spec');
    expect(ctx.specFilePath).toBe('docs/spec.md');
  });

  it('generates unique pipeline IDs', () => {
    const ctx1 = createPipelineContext({
      prompt: 'test',
      agents: {
        spec: { type: 'claude' },
        review: { type: 'codex' },
        qa: { type: 'codex' },
        execute: { type: 'claude' },
        docs: { type: 'claude' },
      },
    });
    const ctx2 = createPipelineContext({
      prompt: 'test',
      agents: {
        spec: { type: 'claude' },
        review: { type: 'codex' },
        qa: { type: 'codex' },
        execute: { type: 'claude' },
        docs: { type: 'claude' },
      },
    });

    expect(ctx1.pipelineId).not.toBe(ctx2.pipelineId);
  });
});
