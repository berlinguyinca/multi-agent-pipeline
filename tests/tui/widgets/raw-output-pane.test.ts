import { afterEach, describe, expect, it } from 'vitest';
import { createTestScreen, createParentBox, getBoxContent } from '../helpers/blessed-harness.js';
import { createRawOutputPane } from '../../../src/tui/widgets/raw-output-pane.js';
import { createRawOutputStore } from '../../../src/tui/raw-output-store.js';
import type blessed from 'neo-blessed';

let screen: blessed.Widgets.Screen | null = null;

afterEach(() => {
  if (screen) {
    screen.destroy();
    screen = null;
  }
});

describe('createRawOutputPane', () => {
  it('strips terminal control sequences from visible output', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const store = createRawOutputStore();
    const pane = createRawOutputPane(parent, store);

    store.setCurrent('router', 'Router', 'Thinking...\u001b[9D\u001b[K{"plan":[]}', true);

    expect(getBoxContent(pane.element)).not.toContain('␛');
    expect(getBoxContent(pane.element)).toContain('{"plan":[]}');
  });
});
