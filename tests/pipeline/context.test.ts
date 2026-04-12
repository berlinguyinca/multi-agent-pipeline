import { describe, it, expect } from 'vitest';
import { createPipelineContext } from '../../src/pipeline/context.js';

describe('createPipelineContext', () => {
  it('creates context with required fields', () => {
    const ctx = createPipelineContext({
      prompt: 'Build a REST API',
      agents: {
        spec: { type: 'claude' },
        review: { type: 'codex' },
        execute: { type: 'claude' },
      },
    });

    expect(ctx.prompt).toBe('Build a REST API');
    expect(ctx.spec).toBeNull();
    expect(ctx.reviewedSpec).toBeNull();
    expect(ctx.iteration).toBe(1);
    expect(ctx.refinementScores).toEqual([]);
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
        execute: { type: 'claude' },
      },
      outputDir: '/custom/path',
    });

    expect(ctx.outputDir).toBe('/custom/path');
  });

  it('generates unique pipeline IDs', () => {
    const ctx1 = createPipelineContext({
      prompt: 'test',
      agents: {
        spec: { type: 'claude' },
        review: { type: 'codex' },
        execute: { type: 'claude' },
      },
    });
    const ctx2 = createPipelineContext({
      prompt: 'test',
      agents: {
        spec: { type: 'claude' },
        review: { type: 'codex' },
        execute: { type: 'claude' },
      },
    });

    expect(ctx1.pipelineId).not.toBe(ctx2.pipelineId);
  });
});
