import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import ResumeScreen from '../../../src/tui/screens/ResumeScreen.js';

const pipelines = [
  {
    id: 'abc-123',
    name: 'User Auth Feature',
    stage: 'feedback',
    iteration: 2,
    agents: 'claude/codex/claude',
    timestamp: '2024-01-15 10:30',
  },
  {
    id: 'def-456',
    name: 'Shopping Cart',
    stage: 'specifying',
    iteration: 1,
    agents: 'ollama/claude/codex',
    timestamp: '2024-01-14 15:00',
  },
];

describe('ResumeScreen', () => {
  it('renders without errors', () => {
    const { lastFrame } = render(
      <ResumeScreen
        pipelines={pipelines}
        onResume={vi.fn()}
        onBack={vi.fn()}
      />
    );
    expect(lastFrame()).toBeTruthy();
  });

  it('shows pipeline names', () => {
    const { lastFrame } = render(
      <ResumeScreen
        pipelines={pipelines}
        onResume={vi.fn()}
        onBack={vi.fn()}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('User Auth Feature');
    expect(frame).toContain('Shopping Cart');
  });

  it('shows pipeline stage', () => {
    const { lastFrame } = render(
      <ResumeScreen
        pipelines={pipelines}
        onResume={vi.fn()}
        onBack={vi.fn()}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('feedback');
  });

  it('shows iteration numbers', () => {
    const { lastFrame } = render(
      <ResumeScreen
        pipelines={pipelines}
        onResume={vi.fn()}
        onBack={vi.fn()}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('2');
  });

  it('renders empty state when no pipelines', () => {
    const { lastFrame } = render(
      <ResumeScreen
        pipelines={[]}
        onResume={vi.fn()}
        onBack={vi.fn()}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('No saved pipelines');
  });

  it('shows title', () => {
    const { lastFrame } = render(
      <ResumeScreen
        pipelines={pipelines}
        onResume={vi.fn()}
        onBack={vi.fn()}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Resume');
  });
});
