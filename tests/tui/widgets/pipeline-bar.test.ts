import { describe, it, expect, afterEach } from 'vitest';
import { createTestScreen, createParentBox, getBoxContent } from '../helpers/blessed-harness.js';
import { createPipelineBar } from '../../../src/tui/widgets/pipeline-bar.js';
import type blessed from 'neo-blessed';

let screen: blessed.Widgets.Screen | null = null;

afterEach(() => {
  if (screen) {
    screen.destroy();
    screen = null;
  }
});

const stages = [
  { name: 'Spec', status: 'complete' as const, agent: 'claude' },
  { name: 'Review', status: 'active' as const, agent: 'codex' },
  { name: 'Execute', status: 'waiting' as const, agent: 'ollama' },
];

describe('createPipelineBar', () => {
  it('creates without errors', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createPipelineBar(parent);
    expect(widget).toBeDefined();
    expect(widget.element).toBeDefined();
  });

  it('shows stage names', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createPipelineBar(parent);
    widget.update({ stages, iteration: 1 });
    const content = getBoxContent(widget.element);
    expect(content).toContain('Spec');
    expect(content).toContain('Review');
    expect(content).toContain('Execute');
  });

  it('shows agent names', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createPipelineBar(parent);
    widget.update({ stages, iteration: 1 });
    const content = getBoxContent(widget.element);
    expect(content).toContain('claude');
    expect(content).toContain('codex');
  });

  it('shows iteration number', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createPipelineBar(parent);
    widget.update({ stages, iteration: 3 });
    const content = getBoxContent(widget.element);
    expect(content).toContain('3');
  });

  it('shows status icons', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createPipelineBar(parent);
    widget.update({ stages, iteration: 1 });
    const content = getBoxContent(widget.element);
    // complete = ✓, active = ●, waiting = ○
    expect(content).toContain('✓');
    expect(content).toContain('●');
    expect(content).toContain('○');
  });

  it('updates content on second update', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createPipelineBar(parent);
    widget.update({ stages, iteration: 1 });
    widget.update({ stages, iteration: 5 });
    const content = getBoxContent(widget.element);
    expect(content).toContain('5');
  });

  it('destroy cleans up without error', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createPipelineBar(parent);
    expect(() => widget.destroy()).not.toThrow();
  });
});
