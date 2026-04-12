import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import PipelineScreen from '../../../src/tui/screens/PipelineScreen.js';

const stages = [
  { name: 'Spec', status: 'active' as const, agent: 'claude' },
  { name: 'Review', status: 'waiting' as const, agent: 'codex' },
  { name: 'Execute', status: 'waiting' as const, agent: 'ollama' },
];

describe('PipelineScreen', () => {
  it('renders without errors', () => {
    const { lastFrame } = render(
      <PipelineScreen
        stages={stages}
        iteration={1}
        output="Generating spec..."
        streaming={true}
        stageName="Spec"
        agentName="claude"
      />
    );
    expect(lastFrame()).toBeTruthy();
  });

  it('shows stage name', () => {
    const { lastFrame } = render(
      <PipelineScreen
        stages={stages}
        iteration={1}
        output=""
        streaming={false}
        stageName="Spec"
        agentName="claude"
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Spec');
  });

  it('shows agent name', () => {
    const { lastFrame } = render(
      <PipelineScreen
        stages={stages}
        iteration={1}
        output=""
        streaming={false}
        stageName="Review"
        agentName="codex"
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('codex');
  });

  it('shows output content', () => {
    const { lastFrame } = render(
      <PipelineScreen
        stages={stages}
        iteration={1}
        output="Hello from the spec agent"
        streaming={false}
        stageName="Spec"
        agentName="claude"
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Hello from the spec agent');
  });

  it('shows iteration number', () => {
    const { lastFrame } = render(
      <PipelineScreen
        stages={stages}
        iteration={3}
        output=""
        streaming={false}
        stageName="Spec"
        agentName="claude"
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('3');
  });

  it('renders with streaming true', () => {
    const { lastFrame } = render(
      <PipelineScreen
        stages={stages}
        iteration={1}
        output="partial..."
        streaming={true}
        stageName="Spec"
        agentName="claude"
      />
    );
    expect(lastFrame()).toBeTruthy();
  });
});
