import { describe, it, expect, afterEach } from 'vitest';
import { createTestScreen, createParentBox, getBoxContent } from '../helpers/blessed-harness.js';
import { createKeyboardHelp } from '../../../src/tui/widgets/keyboard-help.js';
import type blessed from 'neo-blessed';

let screen: blessed.Widgets.Screen | null = null;

afterEach(() => {
  if (screen) {
    screen.destroy();
    screen = null;
  }
});

describe('createKeyboardHelp', () => {
  it('creates without errors', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createKeyboardHelp(parent);
    expect(widget).toBeDefined();
    expect(widget.element).toBeDefined();
  });

  it('shows key names', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createKeyboardHelp(parent);
    widget.update({ shortcuts: [{ key: 'Enter', label: 'Submit' }] });
    const content = getBoxContent(widget.element);
    expect(content).toContain('Enter');
  });

  it('shows shortcut labels', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createKeyboardHelp(parent);
    widget.update({ shortcuts: [{ key: 'q', label: 'Quit' }] });
    const content = getBoxContent(widget.element);
    expect(content).toContain('Quit');
  });

  it('shows multiple shortcuts', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createKeyboardHelp(parent);
    widget.update({
      shortcuts: [
        { key: 'Enter', label: 'Refine' },
        { key: 'Ctrl+E', label: 'Approve' },
      ],
    });
    const content = getBoxContent(widget.element);
    expect(content).toContain('Enter');
    expect(content).toContain('Refine');
    expect(content).toContain('Ctrl+E');
    expect(content).toContain('Approve');
  });

  it('handles empty shortcuts array', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createKeyboardHelp(parent);
    expect(() => widget.update({ shortcuts: [] })).not.toThrow();
  });

  it('destroy cleans up without error', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createKeyboardHelp(parent);
    expect(() => widget.destroy()).not.toThrow();
  });
});
