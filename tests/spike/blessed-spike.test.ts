/**
 * Phase 0 Validation Spike: neo-blessed ESM interop + testability
 *
 * This spike validates 6 critical assumptions before committing to the
 * blessed TUI migration:
 *
 * 1. Default ESM import of neo-blessed works
 * 2. createRequire fallback works
 * 3. blessed.screen() can be created without a real TTY
 * 4. Widget content can be read back
 * 5. Key events can be simulated
 * 6. tsup bundling tested separately (manual step)
 */

import { describe, it, expect, afterEach } from 'vitest';

// Point 1: Default ESM import
import blessed from 'neo-blessed';

// Point 2: createRequire fallback
import { createRequire } from 'module';

describe('Phase 0 Spike: neo-blessed validation', () => {
  let screen: blessed.Widgets.Screen | null = null;

  afterEach(() => {
    if (screen) {
      screen.destroy();
      screen = null;
    }
  });

  describe('Point 1: ESM default import', () => {
    it('should import blessed from neo-blessed', () => {
      expect(blessed).toBeDefined();
      expect(typeof blessed.screen).toBe('function');
      expect(typeof blessed.box).toBe('function');
      expect(typeof blessed.list).toBe('function');
      expect(typeof blessed.textbox).toBe('function');
      expect(typeof blessed.text).toBe('function');
    });
  });

  describe('Point 2: createRequire fallback', () => {
    it('should load neo-blessed via createRequire', () => {
      const require = createRequire(import.meta.url);
      const blessedCjs = require('neo-blessed');
      expect(blessedCjs).toBeDefined();
      expect(typeof blessedCjs.screen).toBe('function');
    });
  });

  describe('Point 3: blessed.screen() without TTY', () => {
    it('should create a screen in test environment', () => {
      screen = blessed.screen({
        smartCSR: true,
        title: 'MAP Spike Test',
        // Use a fake output/input to avoid TTY requirement
        input: process.stdin,
        output: process.stdout,
        fullUnicode: true,
        warnings: false,
      });
      expect(screen).toBeDefined();
      expect(screen.type).toBe('screen');
    });

    it('should create a screen with custom dimensions', () => {
      screen = blessed.screen({
        smartCSR: true,
        title: 'MAP Spike Test',
        input: process.stdin,
        output: process.stdout,
        fullUnicode: true,
        warnings: false,
      });
      // Set explicit dimensions for testing
      screen.program.cols = 80;
      screen.program.rows = 24;
      expect(screen).toBeDefined();
    });
  });

  describe('Point 4: Widget content read-back', () => {
    it('should create a box and read its content', () => {
      screen = blessed.screen({
        smartCSR: true,
        input: process.stdin,
        output: process.stdout,
        fullUnicode: true,
        warnings: false,
      });

      const box = blessed.box({
        parent: screen,
        top: 0,
        left: 0,
        width: 40,
        height: 5,
        content: 'Hello from blessed spike!',
        tags: true,
      });

      expect(box.getContent()).toBe('Hello from blessed spike!');

      // Test content update
      box.setContent('Updated content');
      expect(box.getContent()).toBe('Updated content');
    });

    it('should create a scrollable box with content', () => {
      screen = blessed.screen({
        smartCSR: true,
        input: process.stdin,
        output: process.stdout,
        fullUnicode: true,
        warnings: false,
      });

      const scrollBox = blessed.box({
        parent: screen,
        top: 0,
        left: 0,
        width: 40,
        height: 5,
        scrollable: true,
        alwaysScroll: true,
        scrollbar: {
          style: { bg: 'blue' },
        },
        content: Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`).join('\n'),
        tags: true,
      });

      // Content should contain all lines
      const content = scrollBox.getContent();
      expect(content).toContain('Line 1');
      expect(content).toContain('Line 50');

      // Should be able to scroll
      expect(typeof scrollBox.scroll).toBe('function');
      expect(typeof scrollBox.setScroll).toBe('function');
    });

    it('should create a list widget for agent picker', () => {
      screen = blessed.screen({
        smartCSR: true,
        input: process.stdin,
        output: process.stdout,
        fullUnicode: true,
        warnings: false,
      });

      const list = blessed.list({
        parent: screen,
        top: 0,
        left: 0,
        width: 30,
        height: 10,
        items: ['claude', 'codex', 'ollama'],
        keys: true,
        style: {
          selected: { bg: 'blue' },
        },
      });

      // List items accessible
      expect(list.items.length).toBe(3);
    });

    it('should create a textbox for input', () => {
      screen = blessed.screen({
        smartCSR: true,
        input: process.stdin,
        output: process.stdout,
        fullUnicode: true,
        warnings: false,
      });

      const textbox = blessed.textbox({
        parent: screen,
        top: 0,
        left: 0,
        width: 40,
        height: 3,
        inputOnFocus: true,
        style: {
          focus: { border: { fg: 'blue' } },
        },
      });

      expect(textbox).toBeDefined();
      expect(typeof textbox.setValue).toBe('function');
      expect(typeof textbox.getValue).toBe('function');
      expect(typeof textbox.focus).toBe('function');

      // Set and read value
      textbox.setValue('test input');
      expect(textbox.getValue()).toBe('test input');
    });
  });

  describe('Point 5: Key event simulation', () => {
    it('should handle key events via program emit', () => {
      screen = blessed.screen({
        smartCSR: true,
        input: process.stdin,
        output: process.stdout,
        fullUnicode: true,
        warnings: false,
      });

      let keyPressed = false;
      let keyName = '';

      screen.key(['q'], (ch, key) => {
        keyPressed = true;
        keyName = key.name;
      });

      // blessed's key() registers on program, so emit keypress on program
      screen.program.emit('keypress', 'q', { name: 'q', ctrl: false, meta: false, shift: false, sequence: 'q', full: 'q' });

      expect(keyPressed).toBe(true);
      expect(keyName).toBe('q');
    });

    it('should handle Ctrl+C key combination', () => {
      screen = blessed.screen({
        smartCSR: true,
        input: process.stdin,
        output: process.stdout,
        fullUnicode: true,
        warnings: false,
      });

      let ctrlCPressed = false;

      screen.key(['C-c'], () => {
        ctrlCPressed = true;
      });

      // Simulate Ctrl+C on program
      screen.program.emit('keypress', '\x03', { name: 'c', ctrl: true, meta: false, shift: false, sequence: '\x03', full: 'C-c' });

      expect(ctrlCPressed).toBe(true);
    });

    it('should handle Tab key for focus cycling', () => {
      screen = blessed.screen({
        smartCSR: true,
        input: process.stdin,
        output: process.stdout,
        fullUnicode: true,
        warnings: false,
      });

      let tabPressed = false;

      screen.key(['tab'], () => {
        tabPressed = true;
      });

      screen.program.emit('keypress', '\t', { name: 'tab', ctrl: false, meta: false, shift: false, sequence: '\t', full: 'tab' });

      expect(tabPressed).toBe(true);
    });

    it('should support focus management between widgets', () => {
      screen = blessed.screen({
        smartCSR: true,
        input: process.stdin,
        output: process.stdout,
        fullUnicode: true,
        warnings: false,
      });

      // Use regular boxes (not textbox with inputOnFocus which triggers readInput)
      const box1 = blessed.box({
        parent: screen,
        top: 0,
        left: 0,
        width: 30,
        height: 3,
        name: 'box1',
        keyable: true,
        focusable: true,
      });

      const box2 = blessed.box({
        parent: screen,
        top: 4,
        left: 0,
        width: 30,
        height: 3,
        name: 'box2',
        keyable: true,
        focusable: true,
      });

      // Focus tracking works
      let focusedName = '';
      box1.on('focus', () => { focusedName = 'box1'; });
      box2.on('focus', () => { focusedName = 'box2'; });

      // Focus first box
      box1.focus();
      expect(focusedName).toBe('box1');

      // Focus second box
      box2.focus();
      expect(focusedName).toBe('box2');

      // focusNext/focusPrevious exist
      expect(typeof screen.focusNext).toBe('function');
      expect(typeof screen.focusPrevious).toBe('function');
    });
  });

  describe('Point 6: Type compatibility', () => {
    it('should have correct TypeScript types for blessed widgets', () => {
      // This test validates at compile-time (TypeScript) that @types/blessed
      // covers the APIs we need. If this file compiles, types are adequate.
      screen = blessed.screen({
        smartCSR: true,
        input: process.stdin,
        output: process.stdout,
        fullUnicode: true,
        warnings: false,
      });

      const box: blessed.Widgets.BoxElement = blessed.box({
        parent: screen,
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        content: 'typed content',
      });

      // These should all type-check
      const content: string = box.getContent();
      box.setContent('new content');
      box.hide();
      box.show();
      box.destroy();

      expect(content).toBe('typed content');
    });
  });
});
