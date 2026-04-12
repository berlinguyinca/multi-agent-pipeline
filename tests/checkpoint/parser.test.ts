import { describe, it, expect } from 'vitest';
import {
  formatCheckpointMessage,
  parseCheckpointMessage,
} from '../../src/checkpoint/parser.js';
import type { CheckpointMeta } from '../../src/types/checkpoint.js';

const sampleMeta: CheckpointMeta = {
  pipelineId: 'pipe-abc-123',
  name: 'my-pipeline',
  stage: 'reviewing',
  iteration: 2,
  agents: {
    spec: { adapter: 'claude' },
    review: { adapter: 'codex' },
    execute: { adapter: 'claude' },
  },
  timestamp: new Date('2024-01-15T10:30:00.000Z'),
  commitHash: '',
};

describe('formatCheckpointMessage', () => {
  it('produces the correct [MAP] format', () => {
    const msg = formatCheckpointMessage(sampleMeta);
    expect(msg).toContain('[MAP]');
    expect(msg).toContain('stage:reviewing');
    expect(msg).toContain('iter:2');
    expect(msg).toContain('id:pipe-abc-123');
    expect(msg).toContain('name:my-pipeline');
    expect(msg).toContain('ts:2024-01-15T10:30:00.000Z');
  });
});

describe('parseCheckpointMessage', () => {
  it('roundtrips correctly', () => {
    const msg = formatCheckpointMessage(sampleMeta);
    const parsed = parseCheckpointMessage(msg);

    expect(parsed).not.toBeNull();
    expect(parsed!.pipelineId).toBe('pipe-abc-123');
    expect(parsed!.name).toBe('my-pipeline');
    expect(parsed!.stage).toBe('reviewing');
    expect(parsed!.iteration).toBe(2);
    expect(parsed!.timestamp.toISOString()).toBe('2024-01-15T10:30:00.000Z');
  });

  it('returns null for non-MAP messages', () => {
    expect(parseCheckpointMessage('regular commit message')).toBeNull();
    expect(parseCheckpointMessage('fix: some bug')).toBeNull();
    expect(parseCheckpointMessage('')).toBeNull();
  });

  it('returns null for malformed MAP messages', () => {
    expect(parseCheckpointMessage('[MAP] missing fields')).toBeNull();
  });
});
