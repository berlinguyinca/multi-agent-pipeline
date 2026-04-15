import { describe, it, expect, afterEach } from 'vitest';
import { createTestScreen, createParentBox, getBoxContent } from '../helpers/blessed-harness.js';
import { createSpecViewer } from '../../../src/tui/widgets/spec-viewer.js';
import type blessed from 'neo-blessed';

let screen: blessed.Widgets.Screen | null = null;

afterEach(() => {
  if (screen) {
    screen.destroy();
    screen = null;
  }
});

describe('createSpecViewer', () => {
  it('creates without errors', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createSpecViewer(parent);
    expect(widget).toBeDefined();
    expect(widget.element).toBeDefined();
  });

  it('shows plain text content', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createSpecViewer(parent);
    widget.update({ content: 'Hello spec' });
    expect(getBoxContent(widget.element)).toContain('Hello spec');
  });

  it('renders markdown headers with bold tags', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createSpecViewer(parent);
    widget.update({ content: '# My Feature\n## Section' });
    const content = getBoxContent(widget.element);
    expect(content).toContain('My Feature');
    expect(content).toContain('Section');
  });

  it('renders unchecked checkboxes', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createSpecViewer(parent);
    widget.update({ content: '- [ ] Do something' });
    const content = getBoxContent(widget.element);
    expect(content).toContain('Do something');
  });

  it('renders checked checkboxes', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createSpecViewer(parent);
    widget.update({ content: '- [x] Done item' });
    const content = getBoxContent(widget.element);
    expect(content).toContain('Done item');
  });

  it('renders bullet list items', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createSpecViewer(parent);
    widget.update({ content: '- bullet item' });
    const content = getBoxContent(widget.element);
    expect(content).toContain('bullet item');
  });

  it('handles empty content', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createSpecViewer(parent);
    expect(() => widget.update({ content: '' })).not.toThrow();
  });

  it('destroy cleans up without error', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createSpecViewer(parent);
    expect(() => widget.destroy()).not.toThrow();
  });
});
