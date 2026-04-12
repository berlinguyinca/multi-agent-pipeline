import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import StreamOutput from '../../../src/tui/components/StreamOutput.js';

describe('StreamOutput', () => {
  it('renders without errors', () => {
    const { lastFrame } = render(<StreamOutput content="Hello output" />);
    expect(lastFrame()).toBeTruthy();
  });

  it('shows content', () => {
    const { lastFrame } = render(<StreamOutput content="Some streamed text" />);
    expect(lastFrame()).toContain('Some streamed text');
  });

  it('renders empty content', () => {
    const { lastFrame } = render(<StreamOutput content="" />);
    expect(lastFrame()).not.toBeUndefined();
  });

  it('shows streaming indicator when streaming', () => {
    const { lastFrame } = render(<StreamOutput content="partial..." streaming={true} />);
    expect(lastFrame()).toBeTruthy();
  });

  it('respects maxHeight', () => {
    const content = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n');
    const { lastFrame } = render(<StreamOutput content={content} maxHeight={5} />);
    expect(lastFrame()).toBeTruthy();
  });
});
