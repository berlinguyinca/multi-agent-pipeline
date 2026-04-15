import blessed from 'neo-blessed';
import type { EventEmitter } from 'events';
import type { VimMode } from './vim-mode.js';

type BlessedScreen = blessed.Widgets.Screen;

interface Shortcut {
  keys: string[];
  handler: () => void;
  /** The wrapper function actually passed to screen.key() — needed for screen.unkey(). */
  screenHandler: () => void;
}

interface Scope {
  overrides: Map<string, () => void>;
}

function isFocusedOnInput(screen: BlessedScreen): boolean {
  const focused = screen.focused;
  if (!focused) return false;
  // Textbox and textarea capture input
  return Boolean((focused as blessed.Widgets.TextboxElement).readInput);
}

export class KeyboardManager {
  private screen: BlessedScreen;
  private vim: VimMode | undefined;
  private shortcuts: Map<string, Shortcut> = new Map();
  private scopeStack: Scope[] = [];

  constructor(screen: BlessedScreen, vim?: VimMode) {
    this.screen = screen;
    this.vim = vim;
    this._registerBuiltins();
  }

  private _registerBuiltins(): void {
    this.register('q', () => {
      // Don't quit when typing in a text input
      if (isFocusedOnInput(this.screen)) return;
      this.screen.destroy();
    });

    this.register(['C-c'], () => {
      (this.screen as unknown as EventEmitter).emit('abort');
    });

    this.register('escape', () => {
      // If a text input is focused, blur it and return to NORMAL mode
      if (isFocusedOnInput(this.screen)) {
        this.vim?.toNormal();
        (this.screen as unknown as EventEmitter).emit('vim:blur');
        return;
      }
      (this.screen as unknown as EventEmitter).emit('back');
    });

    this.register('i', () => {
      // Don't intercept if already in a text input
      if (isFocusedOnInput(this.screen)) return;
      (this.screen as unknown as EventEmitter).emit('vim:insert');
    });
  }

  register(key: string | string[], handler: () => void): void {
    const keys = Array.isArray(key) ? key : [key];
    const screenHandler = () => {
      const activeOverride = this._findScopeOverride(keys[0]);
      if (activeOverride) {
        activeOverride();
      } else {
        handler();
      }
    };
    for (const k of keys) {
      this.shortcuts.set(k, { keys, handler, screenHandler });
    }

    this.screen.key(keys, screenHandler);
  }

  unregister(key: string): void {
    const shortcut = this.shortcuts.get(key);
    if (!shortcut) return;

    for (const k of shortcut.keys) {
      this.shortcuts.delete(k);
    }

    this.screen.unkey(shortcut.keys, shortcut.screenHandler);
  }

  pushScope(overrides: Record<string, () => void>): void {
    const map = new Map<string, () => void>();
    for (const [k, v] of Object.entries(overrides)) {
      map.set(k, v);
    }
    this.scopeStack.push({ overrides: map });
  }

  popScope(): void {
    this.scopeStack.pop();
  }

  private _findScopeOverride(key: string): (() => void) | undefined {
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      const override = this.scopeStack[i].overrides.get(key);
      if (override) return override;
    }
    return undefined;
  }
}
