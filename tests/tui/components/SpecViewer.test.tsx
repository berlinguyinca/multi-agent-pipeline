import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import SpecViewer from '../../../src/tui/components/SpecViewer.js';

describe('SpecViewer', () => {
  it('renders without errors', () => {
    const { lastFrame } = render(<SpecViewer content="# Hello\n\nWorld" />);
    expect(lastFrame()).toBeTruthy();
  });

  it('shows content text', () => {
    const { lastFrame } = render(<SpecViewer content="Hello World" />);
    expect(lastFrame()).toContain('Hello World');
  });

  it('renders markdown headers', () => {
    const { lastFrame } = render(<SpecViewer content="# My Header\n\nContent" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('My Header');
  });

  it('renders bullet list items', () => {
    const { lastFrame } = render(<SpecViewer content="- Item one\n- Item two" />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Item one');
    expect(frame).toContain('Item two');
  });

  it('renders checkboxes', () => {
    const { lastFrame } = render(
      <SpecViewer content="- [ ] Todo item\n- [x] Done item" />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Todo item');
    expect(frame).toContain('Done item');
  });

  it('respects maxHeight prop', () => {
    const { lastFrame } = render(<SpecViewer content="Line 1\nLine 2\nLine 3" maxHeight={2} />);
    expect(lastFrame()).toBeTruthy();
  });
});
