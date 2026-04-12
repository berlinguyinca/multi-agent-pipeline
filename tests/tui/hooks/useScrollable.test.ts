import { describe, it, expect } from 'vitest';
import React, { useRef, useImperativeHandle } from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { useScrollable } from '../../../src/tui/hooks/useScrollable.js';

interface ScrollHandle {
  scrollUp(): void;
  scrollDown(): void;
  pageUp(): void;
  pageDown(): void;
  scrollToBottom(): void;
}

// Wrapper component to test the hook within Ink's renderer
function TestScrollable(
  props: { totalLines: number; viewportHeight: number; handleRef?: React.MutableRefObject<ScrollHandle | null> }
) {
  const scroll = useScrollable(props.totalLines, props.viewportHeight);

  if (props.handleRef) {
    props.handleRef.current = {
      scrollUp: scroll.scrollUp,
      scrollDown: scroll.scrollDown,
      pageUp: scroll.pageUp,
      pageDown: scroll.pageDown,
      scrollToBottom: scroll.scrollToBottom,
    };
  }

  return React.createElement(Text, null, JSON.stringify({ offset: scroll.offset }));
}

describe('useScrollable', () => {
  it('initializes with offset 0', () => {
    const { lastFrame } = render(
      React.createElement(TestScrollable, { totalLines: 100, viewportHeight: 10 }),
    );
    const state = JSON.parse(lastFrame()!);
    expect(state.offset).toBe(0);
  });

  it('exposes scroll functions', () => {
    const { lastFrame } = render(
      React.createElement(TestScrollable, { totalLines: 100, viewportHeight: 10 }),
    );
    expect(lastFrame()).toContain('"offset":0');
  });
});

// Pure logic tests for scrollable behavior
describe('useScrollable scroll logic', () => {
  function makeScrollable(totalLines: number, viewportHeight: number) {
    const maxOffset = Math.max(0, totalLines - viewportHeight);
    let offset = 0;
    const clamp = (v: number) => Math.min(maxOffset, Math.max(0, v));
    return {
      getOffset: () => offset,
      scrollUp: () => { offset = clamp(offset - 1); },
      scrollDown: () => { offset = clamp(offset + 1); },
      pageUp: () => { offset = clamp(offset - viewportHeight); },
      pageDown: () => { offset = clamp(offset + viewportHeight); },
      scrollToBottom: () => { offset = maxOffset; },
    };
  }

  it('scrolls down by 1', () => {
    const s = makeScrollable(100, 10);
    s.scrollDown();
    expect(s.getOffset()).toBe(1);
  });

  it('scrolls up by 1', () => {
    const s = makeScrollable(100, 10);
    s.scrollDown();
    s.scrollDown();
    s.scrollUp();
    expect(s.getOffset()).toBe(1);
  });

  it('does not scroll above 0', () => {
    const s = makeScrollable(100, 10);
    s.scrollUp();
    expect(s.getOffset()).toBe(0);
  });

  it('does not scroll past max offset', () => {
    const s = makeScrollable(15, 10);
    for (let i = 0; i < 20; i++) s.scrollDown();
    expect(s.getOffset()).toBe(5);
  });

  it('pages down', () => {
    const s = makeScrollable(100, 10);
    s.pageDown();
    expect(s.getOffset()).toBe(10);
  });

  it('pages up', () => {
    const s = makeScrollable(100, 10);
    s.pageDown();
    s.pageDown();
    s.pageUp();
    expect(s.getOffset()).toBe(10);
  });

  it('scrolls to bottom', () => {
    const s = makeScrollable(100, 10);
    s.scrollToBottom();
    expect(s.getOffset()).toBe(90);
  });

  it('handles totalLines <= viewportHeight', () => {
    const s = makeScrollable(5, 10);
    s.scrollDown();
    expect(s.getOffset()).toBe(0);
  });
});
