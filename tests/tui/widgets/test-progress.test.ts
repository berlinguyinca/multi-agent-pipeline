import { describe, it, expect, afterEach } from 'vitest';
import { createTestScreen, createParentBox, getBoxContent } from '../helpers/blessed-harness.js';
import { createTestProgress } from '../../../src/tui/widgets/test-progress.js';
import type blessed from 'neo-blessed';

let screen: blessed.Widgets.Screen | null = null;

afterEach(() => {
  if (screen) {
    screen.destroy();
    screen = null;
  }
});

describe('createTestProgress', () => {
  it('creates without errors', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createTestProgress(parent);
    expect(widget).toBeDefined();
    expect(widget.element).toBeDefined();
  });

  it('shows test names', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createTestProgress(parent);
    widget.update({
      tests: [
        { name: 'login test', status: 'pass' },
        { name: 'logout test', status: 'fail' },
      ],
    });
    const content = getBoxContent(widget.element);
    expect(content).toContain('login test');
    expect(content).toContain('logout test');
  });

  it('shows pass icon for passing tests', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createTestProgress(parent);
    widget.update({ tests: [{ name: 'passes', status: 'pass' }] });
    const content = getBoxContent(widget.element);
    expect(content).toContain('✓');
  });

  it('shows fail icon for failing tests', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createTestProgress(parent);
    widget.update({ tests: [{ name: 'fails', status: 'fail' }] });
    const content = getBoxContent(widget.element);
    expect(content).toContain('✗');
  });

  it('shows summary with passing count', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createTestProgress(parent);
    widget.update({
      tests: [
        { name: 'a', status: 'pass' },
        { name: 'b', status: 'pass' },
        { name: 'c', status: 'fail' },
      ],
    });
    const content = getBoxContent(widget.element);
    expect(content).toContain('2 passing');
    expect(content).toContain('1 failing');
  });

  it('handles empty tests array', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createTestProgress(parent);
    expect(() => widget.update({ tests: [] })).not.toThrow();
  });

  it('destroy cleans up without error', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createTestProgress(parent);
    expect(() => widget.destroy()).not.toThrow();
  });
});
