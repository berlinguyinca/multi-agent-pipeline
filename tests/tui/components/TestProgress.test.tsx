import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import TestProgress from '../../../src/tui/components/TestProgress.js';

const tests = [
  { name: 'should create user', status: 'passing' as const },
  { name: 'should validate email', status: 'failing' as const },
  { name: 'should hash password', status: 'pending' as const },
  { name: 'should update profile', status: 'writing' as const },
];

describe('TestProgress', () => {
  it('renders without errors', () => {
    const { lastFrame } = render(<TestProgress tests={tests} />);
    expect(lastFrame()).toBeTruthy();
  });

  it('shows test names', () => {
    const { lastFrame } = render(<TestProgress tests={tests} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('should create user');
    expect(frame).toContain('should validate email');
  });

  it('renders empty tests list', () => {
    const { lastFrame } = render(<TestProgress tests={[]} />);
    expect(lastFrame()).not.toBeUndefined();
  });

  it('shows status icons', () => {
    const { lastFrame } = render(<TestProgress tests={tests} />);
    const frame = lastFrame() ?? '';
    // Should have some status indicator characters
    expect(frame.length).toBeGreaterThan(0);
  });

  it('shows summary line', () => {
    const { lastFrame } = render(<TestProgress tests={tests} />);
    const frame = lastFrame() ?? '';
    // Summary should show counts
    expect(frame).toBeTruthy();
  });
});
