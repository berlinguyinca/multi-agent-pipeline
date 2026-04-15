import { describe, it, expect, afterEach } from 'vitest';
import { createTestScreen, createParentBox, getBoxContent } from '../helpers/blessed-harness.js';
import { createSpecDiff } from '../../../src/tui/widgets/spec-diff.js';
import type blessed from 'neo-blessed';

let screen: blessed.Widgets.Screen | null = null;

afterEach(() => {
  if (screen) {
    screen.destroy();
    screen = null;
  }
});

describe('createSpecDiff', () => {
  it('creates without errors', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createSpecDiff(parent);
    expect(widget).toBeDefined();
    expect(widget.element).toBeDefined();
  });

  it('shows added lines with + prefix', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createSpecDiff(parent);
    widget.update({ oldContent: 'old line', newContent: 'old line\nnew line' });
    const content = getBoxContent(widget.element);
    expect(content).toContain('+ new line');
  });

  it('shows removed lines with - prefix', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createSpecDiff(parent);
    widget.update({ oldContent: 'old line\nremoved line', newContent: 'old line' });
    const content = getBoxContent(widget.element);
    expect(content).toContain('- removed line');
  });

  it('handles identical content', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createSpecDiff(parent);
    expect(() => widget.update({ oldContent: 'same', newContent: 'same' })).not.toThrow();
  });

  it('handles empty old content', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createSpecDiff(parent);
    widget.update({ oldContent: '', newContent: 'brand new content' });
    const content = getBoxContent(widget.element);
    expect(content).toContain('+ brand new content');
  });

  it('handles empty new content', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createSpecDiff(parent);
    widget.update({ oldContent: 'deleted content', newContent: '' });
    const content = getBoxContent(widget.element);
    expect(content).toContain('- deleted content');
  });

  it('destroy cleans up without error', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createSpecDiff(parent);
    expect(() => widget.destroy()).not.toThrow();
  });
});
