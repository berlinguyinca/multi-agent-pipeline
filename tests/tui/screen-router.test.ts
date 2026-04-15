import { describe, it, expect, vi, afterEach } from 'vitest';
import blessed from 'neo-blessed';
import { createTestScreen, createParentBox } from './helpers/blessed-harness.js';
import { ScreenRouter } from '../../src/tui/screen-router.js';
import type { BaseScreen } from '../../src/tui/screens/base-screen.js';

let screen: blessed.Widgets.Screen | null = null;

afterEach(() => {
  if (screen) {
    screen.destroy();
    screen = null;
  }
});

function makeScreen(): BaseScreen {
  return {
    activate: vi.fn(),
    deactivate: vi.fn(),
    resize: vi.fn(),
  } as unknown as BaseScreen;
}

describe('ScreenRouter', () => {
  it('creates without errors', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    expect(() => new ScreenRouter(parent, new Map())).not.toThrow();
  });

  it('current() returns null initially', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const router = new ScreenRouter(parent, new Map());
    expect(router.current()).toBeNull();
  });

  it('transition activates the matching screen', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const mockScreen = makeScreen();
    const router = new ScreenRouter(parent, new Map([['idle', mockScreen]]));
    router.transition('idle');
    expect(mockScreen.activate).toHaveBeenCalled();
  });

  it('transition deactivates previous screen', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const screenA = makeScreen();
    const screenB = makeScreen();
    const router = new ScreenRouter(
      parent,
      new Map([['a', screenA], ['b', screenB]]),
    );
    router.transition('a');
    router.transition('b');
    expect(screenA.deactivate).toHaveBeenCalled();
    expect(screenB.activate).toHaveBeenCalled();
  });

  it('transition to same state is a no-op', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const mockScreen = makeScreen();
    const router = new ScreenRouter(parent, new Map([['idle', mockScreen]]));
    router.transition('idle');
    router.transition('idle');
    // activate called only once
    expect(mockScreen.activate).toHaveBeenCalledTimes(1);
  });

  it('transition to unknown state does nothing', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const mockScreen = makeScreen();
    const router = new ScreenRouter(parent, new Map([['idle', mockScreen]]));
    expect(() => router.transition('unknown-state')).not.toThrow();
    expect(mockScreen.activate).not.toHaveBeenCalled();
  });

  it('current() returns the active screen after transition', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const mockScreen = makeScreen();
    const router = new ScreenRouter(parent, new Map([['idle', mockScreen]]));
    router.transition('idle');
    expect(router.current()).toBe(mockScreen);
  });
});
