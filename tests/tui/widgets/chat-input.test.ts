import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTestScreen, createParentBox, simulateKey } from '../helpers/blessed-harness.js';
import { createChatInput } from '../../../src/tui/widgets/chat-input.js';
import type blessed from 'neo-blessed';

let screen: blessed.Widgets.Screen | null = null;

afterEach(() => {
  if (screen) {
    screen.destroy();
    screen = null;
  }
});

describe('createChatInput', () => {
  it('creates without errors', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const onSubmit = vi.fn();
    const widget = createChatInput(parent, onSubmit);
    expect(widget).toBeDefined();
    expect(widget.element).toBeDefined();
  });

  it('shows prefix content in prefix box', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const onSubmit = vi.fn();
    const widget = createChatInput(parent, onSubmit);
    widget.update({ prefix: '>' });
    // The prefix box is the first child of the container
    const container = widget.element;
    const prefixBox = container.children[0];
    expect(prefixBox).toBeDefined();
    const content = (prefixBox as blessed.Widgets.BoxElement).getContent();
    expect(content).toContain('>');
  });

  it('update with placeholder does not throw', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const onSubmit = vi.fn();
    const widget = createChatInput(parent, onSubmit);
    expect(() => widget.update({ placeholder: 'Type something...' })).not.toThrow();
  });

  it('update with prefix does not throw', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const onSubmit = vi.fn();
    const widget = createChatInput(parent, onSubmit);
    expect(() => widget.update({ prefix: '>>' })).not.toThrow();
  });

  it('has textbox child for input', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const onSubmit = vi.fn();
    const widget = createChatInput(parent, onSubmit);
    // container has 2 children: prefixBox and input textbox
    expect(widget.element.children.length).toBeGreaterThanOrEqual(2);
  });

  it('destroy cleans up', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const onSubmit = vi.fn();
    const widget = createChatInput(parent, onSubmit);
    expect(() => widget.destroy()).not.toThrow();
  });

  it('submits on enter without throwing', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const onSubmit = vi.fn();
    const widget = createChatInput(parent, onSubmit);

    const textbox = widget.element.children[1] as blessed.Widgets.TextboxElement;
    textbox.setValue('hello world');
    textbox.focus();
    screen?.render();

    expect(() => simulateKey(screen!, 'enter')).not.toThrow();
    expect(onSubmit).toHaveBeenCalledWith('hello world');
  });
});
