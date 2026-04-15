import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTestScreen } from './helpers/blessed-harness.js';
import { StatusLine } from '../../src/tui/status-line.js';
import type blessed from 'neo-blessed';

let screen: blessed.Widgets.Screen | null = null;

afterEach(() => {
  if (screen) {
    screen.destroy();
    screen = null;
  }
});

describe('StatusLine', () => {
  it('creates without errors', () => {
    screen = createTestScreen();
    expect(() => new StatusLine(screen!)).not.toThrow();
  });

  it('update sets state text in box', () => {
    screen = createTestScreen();
    const sl = new StatusLine(screen);
    sl.update('specifying');
    // Find the status box (last child of screen)
    const box = screen.children[screen.children.length - 1] as blessed.Widgets.BoxElement;
    expect(box.getContent()).toContain('specifying');
  });

  it('update with agent shows agent name', () => {
    screen = createTestScreen();
    const sl = new StatusLine(screen);
    sl.update('specifying', 'claude');
    const box = screen.children[screen.children.length - 1] as blessed.Widgets.BoxElement;
    expect(box.getContent()).toContain('claude');
  });

  it('setHints shows hint text', () => {
    screen = createTestScreen();
    const sl = new StatusLine(screen);
    sl.setHints('q:quit  ^C:abort');
    const box = screen.children[screen.children.length - 1] as blessed.Widgets.BoxElement;
    expect(box.getContent()).toContain('q:quit');
    expect(box.getContent()).toContain('^T:theme');
  });

  it('startTimer/stopTimer do not throw', () => {
    screen = createTestScreen();
    const sl = new StatusLine(screen);
    expect(() => sl.startTimer()).not.toThrow();
    expect(() => sl.stopTimer()).not.toThrow();
  });

  it('destroy cleans up timer', () => {
    screen = createTestScreen();
    const sl = new StatusLine(screen);
    sl.startTimer();
    expect(() => sl.destroy()).not.toThrow();
  });

  it('shows idle state initially after update', () => {
    screen = createTestScreen();
    const sl = new StatusLine(screen);
    sl.update('idle');
    const box = screen.children[screen.children.length - 1] as blessed.Widgets.BoxElement;
    expect(box.getContent()).toContain('idle');
  });

  it('shows elapsed time in content', () => {
    screen = createTestScreen();
    const sl = new StatusLine(screen);
    sl.update('running');
    const box = screen.children[screen.children.length - 1] as blessed.Widgets.BoxElement;
    expect(box.getContent()).toContain('elapsed:');
  });
});
