import { describe, expect, it } from 'vitest';
import { computeShellLayout, scrollFocusedElement } from '../../src/tui/tui-app.js';

describe('computeShellLayout', () => {
  it('keeps welcome content full-height when no raw output exists', () => {
    expect(computeShellLayout({ hasRawOutput: false, rawOutputFullscreen: false })).toEqual({
      contentBottom: 1,
      bottomRawOutputVisible: false,
      fullscreenRawOutputVisible: false,
    });
  });

  it('reserves bottom space when raw output exists', () => {
    expect(computeShellLayout({ hasRawOutput: true, rawOutputFullscreen: false })).toEqual({
      contentBottom: 11,
      bottomRawOutputVisible: true,
      fullscreenRawOutputVisible: false,
    });
  });

  it('hides the bottom pane while raw output is fullscreen', () => {
    expect(computeShellLayout({ hasRawOutput: true, rawOutputFullscreen: true })).toEqual({
      contentBottom: 1,
      bottomRawOutputVisible: false,
      fullscreenRawOutputVisible: true,
    });
  });

  it('keeps content full-height when raw output docking is disabled', () => {
    expect(
      computeShellLayout({
        hasRawOutput: true,
        rawOutputFullscreen: false,
        dockRawOutput: false,
      }),
    ).toEqual({
      contentBottom: 1,
      bottomRawOutputVisible: false,
      fullscreenRawOutputVisible: false,
    });
  });
});

describe('scrollFocusedElement', () => {
  it('scrolls the focused element when it supports scrolling', () => {
    let scrolledBy = 0;
    const screen = {
      focused: {
        scroll(amount: number) {
          scrolledBy += amount;
        },
      },
    };

    expect(scrollFocusedElement(screen as never, 3)).toBe(true);
    expect(scrolledBy).toBe(3);
  });

  it('does not handle focus without scroll support', () => {
    expect(scrollFocusedElement({ focused: {} } as never, 1)).toBe(false);
  });
});
