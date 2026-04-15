import { describe, it, expect, vi } from 'vitest';
import {
  resolveAgentStage,
  buildHeadlessResultFromContext,
  qaAssessmentToFeedback,
} from '../../src/tui/pipeline-runner.js';

describe('resolveAgentStage', () => {
  it('returns spec for specifying', () => {
    expect(resolveAgentStage('specifying')).toBe('spec');
  });

  it('returns review for reviewing', () => {
    expect(resolveAgentStage('reviewing')).toBe('review');
  });

  it('returns qa for specAssessing', () => {
    expect(resolveAgentStage('specAssessing')).toBe('qa');
  });

  it('returns qa for codeAssessing', () => {
    expect(resolveAgentStage('codeAssessing')).toBe('qa');
  });

  it('returns docs for documenting', () => {
    expect(resolveAgentStage('documenting')).toBe('docs');
  });

  it('returns execute for executing', () => {
    expect(resolveAgentStage('executing')).toBe('execute');
  });

  it('returns execute for fixing', () => {
    expect(resolveAgentStage('fixing')).toBe('execute');
  });

  it('returns execute for unknown state', () => {
    expect(resolveAgentStage('idle')).toBe('execute');
  });
});

describe('qaAssessmentToFeedback', () => {
  it('joins summary and findings', () => {
    const result = qaAssessmentToFeedback({
      summary: 'Overall good',
      findings: ['Issue A', 'Issue B'],
      requiredChanges: [],
    });
    expect(result).toContain('Overall good');
    expect(result).toContain('FINDING: Issue A');
    expect(result).toContain('FINDING: Issue B');
  });

  it('includes required changes', () => {
    const result = qaAssessmentToFeedback({
      summary: 'Needs work',
      findings: [],
      requiredChanges: ['Fix tests', 'Add docs'],
    });
    expect(result).toContain('REQUIRED_CHANGE: Fix tests');
    expect(result).toContain('REQUIRED_CHANGE: Add docs');
  });

  it('handles empty assessment', () => {
    const result = qaAssessmentToFeedback({
      summary: '',
      findings: [],
      requiredChanges: [],
    });
    expect(result).toBe('');
  });
});

describe('buildHeadlessResultFromContext', () => {
  const baseContext = {
    pipelineId: 'pipe-1',
    prompt: 'Build something',
    agents: {} as never,
    outputDir: '/output',
    startedAt: new Date(Date.now() - 5000),
    iteration: 1,
    specQaIterations: 0,
    codeQaIterations: 0,
    spec: undefined,
    reviewedSpec: undefined,
    executionResult: undefined,
    qaAssessments: [],
    documentationResult: undefined,
    error: undefined,
  };

  it('returns success=true for complete state', () => {
    const result = buildHeadlessResultFromContext('complete', baseContext as never, 'spec text');
    expect(result.success).toBe(true);
  });

  it('returns success=false for failed state', () => {
    const result = buildHeadlessResultFromContext('failed', baseContext as never, 'spec text');
    expect(result.success).toBe(false);
  });

  it('returns success=false for cancelled state', () => {
    const result = buildHeadlessResultFromContext('cancelled', baseContext as never, 'spec text');
    expect(result.success).toBe(false);
  });

  it('uses fallbackSpec when no spec in context', () => {
    const result = buildHeadlessResultFromContext('complete', baseContext as never, 'fallback spec');
    expect(result.spec).toBe('fallback spec');
  });

  it('uses reviewedSpec content when available', () => {
    const contextWithSpec = {
      ...baseContext,
      reviewedSpec: { content: 'reviewed spec content', iteration: 1, timestamp: new Date() },
    };
    const result = buildHeadlessResultFromContext('complete', contextWithSpec as never, 'fallback');
    expect(result.spec).toBe('reviewed spec content');
  });

  it('includes outputDir', () => {
    const result = buildHeadlessResultFromContext('complete', baseContext as never, '');
    expect(result.outputDir).toBe('/output');
  });

  it('includes error for non-complete states', () => {
    const result = buildHeadlessResultFromContext('failed', baseContext as never, '');
    expect(result.error).toBeDefined();
  });
});
