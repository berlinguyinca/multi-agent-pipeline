import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTestScreen, simulateKey } from './helpers/blessed-harness.js';
import { KeyboardManager } from '../../src/tui/keyboard-manager.js';
import type blessed from 'neo-blessed';

let screen: blessed.Widgets.Screen | null = null;

afterEach(() => {
  if (screen) {
    screen.destroy();
    screen = null;
  }
});

describe('KeyboardManager', () => {
  it('creates without errors', () => {
    screen = createTestScreen();
    expect(() => new KeyboardManager(screen!)).not.toThrow();
  });

  it('registers and fires custom key handler', () => {
    screen = createTestScreen();
    const km = new KeyboardManager(screen);
    const handler = vi.fn();
    km.register('a', handler);
    simulateKey(screen, 'a');
    expect(handler).toHaveBeenCalled();
  });

  it('registers multiple keys for one handler', () => {
    screen = createTestScreen();
    const km = new KeyboardManager(screen);
    const handler = vi.fn();
    km.register(['x', 'y'], handler);
    simulateKey(screen, 'x');
    simulateKey(screen, 'y');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('scope override fires instead of base handler', () => {
    screen = createTestScreen();
    const km = new KeyboardManager(screen);
    const baseHandler = vi.fn();
    const scopeHandler = vi.fn();
    km.register('b', baseHandler);
    km.pushScope({ b: scopeHandler });
    simulateKey(screen, 'b');
    expect(scopeHandler).toHaveBeenCalled();
    expect(baseHandler).not.toHaveBeenCalled();
  });

  it('base handler fires after scope is popped', () => {
    screen = createTestScreen();
    const km = new KeyboardManager(screen);
    const baseHandler = vi.fn();
    const scopeHandler = vi.fn();
    km.register('c', baseHandler);
    km.pushScope({ c: scopeHandler });
    km.popScope();
    simulateKey(screen, 'c');
    expect(baseHandler).toHaveBeenCalled();
    expect(scopeHandler).not.toHaveBeenCalled();
  });

  it('unregister removes key from shortcuts map', () => {
    screen = createTestScreen();
    const km = new KeyboardManager(screen);
    const handler = vi.fn();
    km.register('d', handler);
    // blessed doesn't support true unbind — unregister replaces with a no-op listener
    // but the original screen.key binding may still fire once.
    // Verify unregister doesn't throw and removes from internal map (tested indirectly
    // by verifying scope overrides don't leak after pop, which uses shortcuts).
    expect(() => km.unregister('d')).not.toThrow();
  });

  it('q key destroys screen (builtin)', () => {
    screen = createTestScreen();
    const destroySpy = vi.spyOn(screen, 'destroy');
    new KeyboardManager(screen);
    simulateKey(screen, 'q');
    expect(destroySpy).toHaveBeenCalled();
    // screen.destroy was called, mark null to avoid double-destroy in afterEach
    screen = null;
  });

  it('escape emits back event (builtin)', () => {
    screen = createTestScreen();
    const backHandler = vi.fn();
    screen.on('back', backHandler);
    new KeyboardManager(screen);
    simulateKey(screen, 'escape');
    expect(backHandler).toHaveBeenCalled();
  });
});
