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
  it('contains exactly 3 stages', () => {
    expect(ACTIVE_STAGES).toHaveLength(3);
  });

  it('is a readonly tuple (as const)', () => {
    // as const is compile-time; verify the values are correct at runtime
    expect(ACTIVE_STAGES[0]).toBe('specifying');
    expect(ACTIVE_STAGES[1]).toBe('reviewing');
    expect(ACTIVE_STAGES[2]).toBe('executing');
  });
});

describe('PipelineStage type coverage', () => {
  it('all stages are accounted for', () => {
    const allStages: PipelineStage[] = [
      'idle',
      'specifying',
      'reviewing',
      'feedback',
      'executing',
      'complete',
      'failed',
      'cancelled',
    ];
    expect(allStages).toHaveLength(8);
    for (const stage of allStages) {
      expect(typeof isActiveStage(stage)).toBe('boolean');
      expect(typeof isTerminalStage(stage)).toBe('boolean');
    }
  });
});
