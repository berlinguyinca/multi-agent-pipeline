import { describe, it, expect, afterEach } from 'vitest';
import { createTestScreen, createParentBox, getBoxContent } from '../helpers/blessed-harness.js';
import { createRefinementScore } from '../../../src/tui/widgets/refinement-score.js';
import type blessed from 'neo-blessed';

let screen: blessed.Widgets.Screen | null = null;

afterEach(() => {
  if (screen) {
    screen.destroy();
    screen = null;
  }
});

describe('createRefinementScore', () => {
  it('creates without errors', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createRefinementScore(parent);
    expect(widget).toBeDefined();
    expect(widget.element).toBeDefined();
  });

  it('shows no-scores message when empty', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createRefinementScore(parent);
    widget.update({ scores: [] });
    const content = getBoxContent(widget.element);
    expect(content).toContain('No scores yet');
  });

  it('shows iteration number', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createRefinementScore(parent);
    widget.update({ scores: [{ iteration: 1, score: 0.75 }] });
    const content = getBoxContent(widget.element);
    expect(content).toContain('#1');
  });

  it('shows percentage', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createRefinementScore(parent);
    widget.update({ scores: [{ iteration: 1, score: 0.75 }] });
    const content = getBoxContent(widget.element);
    expect(content).toContain('75%');
  });

  it('shows multiple iterations', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createRefinementScore(parent);
    widget.update({
      scores: [
        { iteration: 1, score: 0.6 },
        { iteration: 2, score: 0.85 },
      ],
    });
    const content = getBoxContent(widget.element);
    expect(content).toContain('#1');
    expect(content).toContain('#2');
    expect(content).toContain('60%');
    expect(content).toContain('85%');
  });

  it('shows arrow indicator on latest score', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createRefinementScore(parent);
    widget.update({
      scores: [
        { iteration: 1, score: 0.6 },
        { iteration: 2, score: 0.9 },
      ],
    });
    const content = getBoxContent(widget.element);
    expect(content).toContain('◄');
  });

  it('handles score > 1 as percentage', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createRefinementScore(parent);
    widget.update({ scores: [{ iteration: 1, score: 85 }] });
    const content = getBoxContent(widget.element);
    expect(content).toContain('85%');
  });

  it('destroy cleans up without error', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createRefinementScore(parent);
    expect(() => widget.destroy()).not.toThrow();
  });
});
