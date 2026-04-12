import { describe, it, expect } from 'vitest';
import {
  createSpec,
  extractAcceptanceCriteria,
  isValidRefinementScore,
} from '../../src/types/spec.js';
import type { RefinementScore } from '../../src/types/spec.js';

describe('extractAcceptanceCriteria', () => {
  it('extracts checkbox items from markdown', () => {
    const content = `## Acceptance Criteria
- [ ] POST /tasks creates a task
- [x] GET /tasks returns list
- [ ] DELETE /tasks/:id soft-deletes
Some other text`;

    const criteria = extractAcceptanceCriteria(content);
    expect(criteria).toEqual([
      'POST /tasks creates a task',
      'GET /tasks returns list',
      'DELETE /tasks/:id soft-deletes',
    ]);
  });

  it('returns empty array when no checkboxes', () => {
    expect(extractAcceptanceCriteria('no checkboxes here')).toEqual([]);
  });

  it('handles indented checkboxes', () => {
    const content = '  - [ ] indented item';
    expect(extractAcceptanceCriteria(content)).toEqual(['indented item']);
  });
});

describe('createSpec', () => {
  it('creates a spec with extracted criteria', () => {
    const content = '## Goal\nBuild something\n- [ ] First criterion\n- [ ] Second';
    const spec = createSpec(content);
    expect(spec.version).toBe(1);
    expect(spec.content).toBe(content);
    expect(spec.acceptanceCriteria).toHaveLength(2);
    expect(spec.createdAt).toBeInstanceOf(Date);
  });

  it('supports custom version', () => {
    const spec = createSpec('content', 3);
    expect(spec.version).toBe(3);
  });
});

describe('isValidRefinementScore', () => {
  it('accepts valid score', () => {
    const score: RefinementScore = {
      iteration: 1,
      score: 72,
      completeness: 0.8,
      testability: 0.7,
      specificity: 0.65,
      timestamp: new Date(),
    };
    expect(isValidRefinementScore(score)).toBe(true);
  });

  it('rejects score above 100', () => {
    const score: RefinementScore = {
      iteration: 1,
      score: 101,
      completeness: 0.8,
      testability: 0.7,
      specificity: 0.65,
      timestamp: new Date(),
    };
    expect(isValidRefinementScore(score)).toBe(false);
  });

  it('rejects negative score', () => {
    const score: RefinementScore = {
      iteration: 1,
      score: -1,
      completeness: 0.8,
      testability: 0.7,
      specificity: 0.65,
      timestamp: new Date(),
    };
    expect(isValidRefinementScore(score)).toBe(false);
  });

  it('rejects completeness > 1', () => {
    const score: RefinementScore = {
      iteration: 1,
      score: 50,
      completeness: 1.1,
      testability: 0.7,
      specificity: 0.65,
      timestamp: new Date(),
    };
    expect(isValidRefinementScore(score)).toBe(false);
  });

  it('rejects iteration < 1', () => {
    const score: RefinementScore = {
      iteration: 0,
      score: 50,
      completeness: 0.5,
      testability: 0.5,
      specificity: 0.5,
      timestamp: new Date(),
    };
    expect(isValidRefinementScore(score)).toBe(false);
  });
});
