import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import KeyboardHelp from '../../../src/tui/components/KeyboardHelp.js';

const shortcuts = [
  { key: 'ctrl+c', label: 'Quit' },
  { key: 'tab', label: 'Switch focus' },
  { key: 'enter', label: 'Confirm' },
];

describe('KeyboardHelp', () => {
  it('renders without errors', () => {
    const { lastFrame } = render(<KeyboardHelp shortcuts={shortcuts} />);
    expect(lastFrame()).toBeTruthy();
  });

  it('shows shortcut keys', () => {
    const { lastFrame } = render(<KeyboardHelp shortcuts={shortcuts} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('ctrl+c');
    expect(frame).toContain('tab');
  });

  it('shows labels', () => {
    const { lastFrame } = render(<KeyboardHelp shortcuts={shortcuts} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Quit');
    expect(frame).toContain('Switch focus');
  });

  it('renders empty shortcuts', () => {
    const { lastFrame } = render(<KeyboardHelp shortcuts={[]} />);
    expect(lastFrame()).not.toBeUndefined();
  });
});
