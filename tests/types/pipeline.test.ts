import { describe, it, expect } from 'vitest';
import { isActiveStage, isTerminalStage, ACTIVE_STAGES } from '../../src/types/pipeline.js';
import type { PipelineStage } from '../../src/types/pipeline.js';

describe('isActiveStage', () => {
  it('returns true for specifying', () => {
    expect(isActiveStage('specifying')).toBe(true);
  });

  it('returns true for reviewing', () => {
    expect(isActiveStage('reviewing')).toBe(true);
  });

  it('returns true for executing', () => {
    expect(isActiveStage('executing')).toBe(true);
  });

  it('returns true for QA and fixing stages', () => {
    expect(isActiveStage('specAssessing')).toBe(true);
    expect(isActiveStage('codeAssessing')).toBe(true);
    expect(isActiveStage('fixing')).toBe(true);
    expect(isActiveStage('documenting')).toBe(true);
  });

  it('returns false for idle', () => {
    expect(isActiveStage('idle')).toBe(false);
  });

  it('returns false for feedback', () => {
    expect(isActiveStage('feedback')).toBe(false);
  });

  it('returns false for terminal stages', () => {
    expect(isActiveStage('complete')).toBe(false);
    expect(isActiveStage('failed')).toBe(false);
    expect(isActiveStage('cancelled')).toBe(false);
  });
});

describe('isTerminalStage', () => {
  it('returns true for complete', () => {
    expect(isTerminalStage('complete')).toBe(true);
  });

  it('returns true for failed', () => {
    expect(isTerminalStage('failed')).toBe(true);
  });

  it('returns true for cancelled', () => {
    expect(isTerminalStage('cancelled')).toBe(true);
  });

  it('returns false for active stages', () => {
    expect(isTerminalStage('specifying')).toBe(false);
    expect(isTerminalStage('reviewing')).toBe(false);
    expect(isTerminalStage('executing')).toBe(false);
  });

  it('returns false for idle and feedback', () => {
    expect(isTerminalStage('idle')).toBe(false);
    expect(isTerminalStage('feedback')).toBe(false);
  });
});

describe('ACTIVE_STAGES', () => {
  it('contains exactly 7 stages', () => {
    expect(ACTIVE_STAGES).toHaveLength(7);
  });

  it('is a readonly tuple (as const)', () => {
    // as const is compile-time; verify the values are correct at runtime
    expect(ACTIVE_STAGES[0]).toBe('specifying');
    expect(ACTIVE_STAGES[1]).toBe('reviewing');
    expect(ACTIVE_STAGES[2]).toBe('specAssessing');
    expect(ACTIVE_STAGES[3]).toBe('executing');
    expect(ACTIVE_STAGES[4]).toBe('codeAssessing');
    expect(ACTIVE_STAGES[5]).toBe('fixing');
    expect(ACTIVE_STAGES[6]).toBe('documenting');
  });
});

describe('PipelineStage type coverage', () => {
  it('all stages are accounted for', () => {
    const allStages: PipelineStage[] = [
      'idle',
      'specifying',
      'reviewing',
      'specAssessing',
      'feedback',
      'executing',
      'codeAssessing',
      'fixing',
      'documenting',
      'complete',
      'failed',
      'cancelled',
    ];
    expect(allStages).toHaveLength(12);
    for (const stage of allStages) {
      expect(typeof isActiveStage(stage)).toBe('boolean');
      expect(typeof isTerminalStage(stage)).toBe('boolean');
    }
  });
});
