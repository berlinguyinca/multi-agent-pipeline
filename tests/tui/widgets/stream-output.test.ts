import { afterEach, describe, expect, it } from 'vitest';
import { createTestScreen, createParentBox } from '../helpers/blessed-harness.js';
import { createStreamOutput } from '../../../src/tui/widgets/stream-output.js';
import type blessed from 'neo-blessed';

let screen: blessed.Widgets.Screen | null = null;

afterEach(() => {
  if (screen) {
    screen.destroy();
    screen = null;
  }
});

describe('createStreamOutput', () => {
  it('enables keyboard and mouse scrolling', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createStreamOutput(parent);

    expect(widget.element.options.scrollable).toBe(true);
    expect(widget.element.options.keys).toBe(true);
    expect(widget.element.options.vi).toBe(true);
    expect(widget.element.options.mouse).toBe(true);
  });
});
