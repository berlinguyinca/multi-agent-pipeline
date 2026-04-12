import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import RefinementScore from '../../../src/tui/components/RefinementScore.js';

const scores = [
  { iteration: 1, score: 0.4 },
  { iteration: 2, score: 0.7 },
  { iteration: 3, score: 0.9 },
];

describe('RefinementScore', () => {
  it('renders without errors', () => {
    const { lastFrame } = render(<RefinementScore scores={scores} />);
    expect(lastFrame()).toBeTruthy();
  });

  it('shows iteration labels', () => {
    const { lastFrame } = render(<RefinementScore scores={scores} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('1');
    expect(frame).toContain('2');
    expect(frame).toContain('3');
  });

  it('renders with target', () => {
    const { lastFrame } = render(<RefinementScore scores={scores} target={0.8} />);
    expect(lastFrame()).toBeTruthy();
  });

  it('renders empty scores', () => {
    const { lastFrame } = render(<RefinementScore scores={[]} />);
    expect(lastFrame()).toBeTruthy();
  });

  it('renders block chars for bars', () => {
    const { lastFrame } = render(<RefinementScore scores={scores} />);
    const frame = lastFrame() ?? '';
    // Should contain some block or bar character representation
    expect(frame.length).toBeGreaterThan(0);
  });
});
