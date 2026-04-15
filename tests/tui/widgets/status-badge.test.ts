import { describe, it, expect, afterEach } from 'vitest';
import { createTestScreen, createParentBox, getBoxContent } from '../helpers/blessed-harness.js';
import { createStatusBadge } from '../../../src/tui/widgets/status-badge.js';
import type blessed from 'neo-blessed';

let screen: blessed.Widgets.Screen | null = null;

afterEach(() => {
  if (screen) {
    screen.destroy();
    screen = null;
  }
});

describe('createStatusBadge', () => {
  it('creates without errors', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createStatusBadge(parent);
    expect(widget).toBeDefined();
    expect(widget.element).toBeDefined();
  });

  it('shows waiting icon for waiting status', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createStatusBadge(parent);
    widget.update({ status: 'waiting' });
    const content = getBoxContent(widget.element);
    expect(content).toContain('○');
  });

  it('shows active icon for active status', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createStatusBadge(parent);
    widget.update({ status: 'active' });
    const content = getBoxContent(widget.element);
    expect(content).toContain('●');
  });

  it('shows complete icon for complete status', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createStatusBadge(parent);
    widget.update({ status: 'complete' });
    const content = getBoxContent(widget.element);
    expect(content).toContain('✓');
  });

  it('shows failed icon for failed status', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createStatusBadge(parent);
    widget.update({ status: 'failed' });
    const content = getBoxContent(widget.element);
    expect(content).toContain('✗');
  });

  it('shows optional label', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createStatusBadge(parent);
    widget.update({ status: 'active', label: 'Spec Stage' });
    const content = getBoxContent(widget.element);
    expect(content).toContain('Spec Stage');
  });

  it('shows no label when not provided', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createStatusBadge(parent);
    widget.update({ status: 'waiting' });
    // Should only have the icon, no extra label text
    const content = getBoxContent(widget.element);
    expect(content).not.toContain('undefined');
  });

  it('destroy cleans up without error', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createStatusBadge(parent);
    expect(() => widget.destroy()).not.toThrow();
  });
});
