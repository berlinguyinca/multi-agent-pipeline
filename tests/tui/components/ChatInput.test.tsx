import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import ChatInput from '../../../src/tui/components/ChatInput.js';

describe('ChatInput', () => {
  it('renders without errors', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(<ChatInput onSubmit={onSubmit} />);
    expect(lastFrame()).not.toBeUndefined();
  });

  it('shows placeholder text', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <ChatInput onSubmit={onSubmit} placeholder="Type something..." />
    );
    expect(lastFrame()).toContain('Type something...');
  });

  it('shows prefix', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <ChatInput onSubmit={onSubmit} prefix="> " />
    );
    expect(lastFrame()).toContain('>');
  });

  it('renders with all props', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      <ChatInput onSubmit={onSubmit} placeholder="Ask..." prefix=">> " />
    );
    expect(lastFrame()).toBeTruthy();
  });
});
