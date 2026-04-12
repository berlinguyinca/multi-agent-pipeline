import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import PipelineBar from '../../../src/tui/components/PipelineBar.js';

const stages = [
  { name: 'Spec', status: 'complete' as const, agent: 'claude' },
  { name: 'Review', status: 'active' as const, agent: 'codex', progress: 42 },
  { name: 'Execute', status: 'waiting' as const, agent: 'ollama' },
];

describe('PipelineBar', () => {
  it('renders without errors', () => {
    const { lastFrame } = render(<PipelineBar stages={stages} iteration={1} />);
    expect(lastFrame()).toBeTruthy();
  });

  it('shows stage names', () => {
    const { lastFrame } = render(<PipelineBar stages={stages} iteration={1} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Spec');
    expect(frame).toContain('Review');
    expect(frame).toContain('Execute');
  });

  it('shows agent names', () => {
    const { lastFrame } = render(<PipelineBar stages={stages} iteration={1} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('claude');
    expect(frame).toContain('codex');
  });

  it('shows iteration number', () => {
    const { lastFrame } = render(<PipelineBar stages={stages} iteration={3} />);
    expect(lastFrame()).toContain('3');
  });

  it('shows progress for active stage', () => {
    const { lastFrame } = render(<PipelineBar stages={stages} iteration={1} />);
    expect(lastFrame()).toContain('42');
  });

  it('renders with failed status', () => {
    const failedStages = [{ name: 'Spec', status: 'failed' as const, agent: 'claude' }];
    const { lastFrame } = render(<PipelineBar stages={failedStages} iteration={1} />);
    expect(lastFrame()).toBeTruthy();
  });
});
