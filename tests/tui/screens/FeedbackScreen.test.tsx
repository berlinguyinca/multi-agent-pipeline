import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import FeedbackScreen from '../../../src/tui/screens/FeedbackScreen.js';

const stages = [
  { name: 'Spec', status: 'complete' as const, agent: 'claude' },
  { name: 'Review', status: 'complete' as const, agent: 'codex' },
  { name: 'Execute', status: 'waiting' as const, agent: 'ollama' },
];

const scores = [
  { iteration: 1, score: 0.6 },
  { iteration: 2, score: 0.85 },
];

const specContent = `# My Feature Spec

## Requirements
- [ ] User can login
- [ ] User can logout
`;

describe('FeedbackScreen', () => {
  it('renders without errors', () => {
    const { lastFrame } = render(
      <FeedbackScreen
        stages={stages}
        iteration={2}
        scores={scores}
        specContent={specContent}
        onApprove={vi.fn()}
        onFeedback={vi.fn()}
      />
    );
    expect(lastFrame()).toBeTruthy();
  });

  it('shows spec content', () => {
    const { lastFrame } = render(
      <FeedbackScreen
        stages={stages}
        iteration={2}
        scores={scores}
        specContent={specContent}
        onApprove={vi.fn()}
        onFeedback={vi.fn()}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('My Feature Spec');
  });

  it('shows keyboard help shortcuts', () => {
    const { lastFrame } = render(
      <FeedbackScreen
        stages={stages}
        iteration={2}
        scores={scores}
        specContent={specContent}
        onApprove={vi.fn()}
        onFeedback={vi.fn()}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Enter');
  });

  it('renders with previous spec content for diff', () => {
    const { lastFrame } = render(
      <FeedbackScreen
        stages={stages}
        iteration={2}
        scores={scores}
        specContent={specContent}
        previousSpecContent="# Old spec\n- old requirement"
        onApprove={vi.fn()}
        onFeedback={vi.fn()}
      />
    );
    expect(lastFrame()).toBeTruthy();
  });

  it('shows iteration number', () => {
    const { lastFrame } = render(
      <FeedbackScreen
        stages={stages}
        iteration={3}
        scores={scores}
        specContent={specContent}
        onApprove={vi.fn()}
        onFeedback={vi.fn()}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('3');
  });

  it('renders with empty scores', () => {
    const { lastFrame } = render(
      <FeedbackScreen
        stages={stages}
        iteration={1}
        scores={[]}
        specContent={specContent}
        onApprove={vi.fn()}
        onFeedback={vi.fn()}
      />
    );
    expect(lastFrame()).toBeTruthy();
  });
});
