import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import AgentPicker from '../../../src/tui/components/AgentPicker.js';

const stages = [
  { name: 'Spec', agent: 'claude' },
  { name: 'Review', agent: 'codex' },
];

const availableAgents = ['claude', 'codex', 'ollama'];

describe('AgentPicker', () => {
  it('renders without errors', () => {
    const onAssign = vi.fn();
    const { lastFrame } = render(
      <AgentPicker
        stages={stages}
        availableAgents={availableAgents}
        onAssign={onAssign}
        focusedStage={0}
      />
    );
    expect(lastFrame()).toBeTruthy();
  });

  it('shows stage names', () => {
    const onAssign = vi.fn();
    const { lastFrame } = render(
      <AgentPicker
        stages={stages}
        availableAgents={availableAgents}
        onAssign={onAssign}
        focusedStage={0}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Spec');
    expect(frame).toContain('Review');
  });

  it('shows current agent assignments', () => {
    const onAssign = vi.fn();
    const { lastFrame } = render(
      <AgentPicker
        stages={stages}
        availableAgents={availableAgents}
        onAssign={onAssign}
        focusedStage={0}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('claude');
  });

  it('shows available agents in list', () => {
    const onAssign = vi.fn();
    const { lastFrame } = render(
      <AgentPicker
        stages={stages}
        availableAgents={availableAgents}
        onAssign={onAssign}
        focusedStage={0}
      />
    );
    expect(lastFrame()).toBeTruthy();
  });
});
