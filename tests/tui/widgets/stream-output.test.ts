import { describe, it, expect, afterEach } from 'vitest';
import { createTestScreen, createParentBox, getBoxContent } from '../helpers/blessed-harness.js';
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
  it('creates without errors', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createStreamOutput(parent);
    expect(widget).toBeDefined();
    expect(widget.element).toBeDefined();
  });

  it('shows content after update', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createStreamOutput(parent);
    widget.update({ content: 'Hello output', streaming: false });
    const content = getBoxContent(widget.element);
    expect(content).toContain('Hello output');
  });

  it('shows streamed text', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createStreamOutput(parent);
    widget.update({ content: 'Some streamed text', streaming: false });
    const content = getBoxContent(widget.element);
    expect(content).toContain('Some streamed text');
  });

  it('shows streaming indicator when streaming', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createStreamOutput(parent);
    widget.update({ content: 'partial...', streaming: true });
    const content = getBoxContent(widget.element);
    expect(content).toContain('streaming...');
  });

  it('renders empty content without error', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createStreamOutput(parent);
    expect(() => widget.update({ content: '', streaming: false })).not.toThrow();
  });

  it('handles large content without error', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createStreamOutput(parent);
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`).join('\n');
    expect(() => widget.update({ content: lines, streaming: false })).not.toThrow();
    expect(getBoxContent(widget.element)).toContain('Line 1');
  });

  it('destroy cleans up without error', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createStreamOutput(parent);
    expect(() => widget.destroy()).not.toThrow();
  });
});
