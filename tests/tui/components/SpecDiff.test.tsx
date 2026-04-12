import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import SpecDiff from '../../../src/tui/components/SpecDiff.js';

describe('SpecDiff', () => {
  it('renders without errors', () => {
    const { lastFrame } = render(
      <SpecDiff oldContent="Hello World" newContent="Hello Universe" />
    );
    expect(lastFrame()).toBeTruthy();
  });

  it('shows unchanged context', () => {
    const { lastFrame } = render(
      <SpecDiff oldContent="Hello World" newContent="Hello Universe" />
    );
    expect(lastFrame()).toContain('Hello');
  });

  it('shows added content', () => {
    const { lastFrame } = render(
      <SpecDiff oldContent="Line one" newContent="Line one\nLine two" />
    );
    expect(lastFrame()).toContain('Line two');
  });

  it('shows removed content', () => {
    const { lastFrame } = render(
      <SpecDiff oldContent="Line one\nLine two" newContent="Line one" />
    );
    expect(lastFrame()).toContain('Line two');
  });

  it('renders identical content without errors', () => {
    const { lastFrame } = render(
      <SpecDiff oldContent="Same content" newContent="Same content" />
    );
    expect(lastFrame()).toBeTruthy();
  });
});
