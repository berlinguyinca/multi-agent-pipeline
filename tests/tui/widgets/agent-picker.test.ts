import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTestScreen, createParentBox } from '../helpers/blessed-harness.js';
import { createAgentPicker } from '../../../src/tui/widgets/agent-picker.js';
import type blessed from 'neo-blessed';

let screen: blessed.Widgets.Screen | null = null;

afterEach(() => {
  if (screen) {
    screen.destroy();
    screen = null;
  }
});

const stages = [
  { name: 'spec', agent: 'claude' },
  { name: 'review', agent: 'codex' },
];

const availableAgents = ['claude', 'codex', 'ollama'];

// Blessed list stores raw item strings in .ritems, not getContent()
function getListItems(element: blessed.Widgets.BoxElement): string[] {
  return (element as unknown as { ritems: string[] }).ritems ?? [];
}

describe('createAgentPicker', () => {
  it('creates without errors', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createAgentPicker(parent);
    expect(widget).toBeDefined();
    expect(widget.element).toBeDefined();
  });

  it('shows stage names after update', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createAgentPicker(parent);
    widget.update({ stages, availableAgents, focusedStage: 0 });
    const items = getListItems(widget.element).join('\n');
    expect(items).toContain('spec');
    expect(items).toContain('review');
  });

  it('shows current agent assignments after update', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createAgentPicker(parent);
    widget.update({ stages, availableAgents, focusedStage: 0 });
    const items = getListItems(widget.element).join('\n');
    expect(items).toContain('claude');
  });

  it('shows header row', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createAgentPicker(parent);
    widget.update({ stages, availableAgents, focusedStage: 0 });
    const items = getListItems(widget.element).join('\n');
    expect(items).toContain('STAGE');
  });

  it('emits assign event when enter pressed on focused stage', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createAgentPicker(parent);
    widget.update({ stages, availableAgents, focusedStage: 0 });

    const assignHandler = vi.fn();
    widget.on('assign', assignHandler);

    // element.key() registers on the element — emit keypress on program with element focused
    widget.element.focus();
    screen.program.emit('keypress', '\r', { name: 'enter', ctrl: false, meta: false, shift: false, sequence: '\r', full: 'enter' });

    expect(assignHandler).toHaveBeenCalledWith('spec', expect.any(String));
  });

  it('cycles to next agent on enter', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createAgentPicker(parent);
    // spec is currently 'claude', next in ['claude','codex','ollama'] is 'codex'
    widget.update({ stages, availableAgents, focusedStage: 0 });

    const assignHandler = vi.fn();
    widget.on('assign', assignHandler);

    widget.element.focus();
    screen.program.emit('keypress', '\r', { name: 'enter', ctrl: false, meta: false, shift: false, sequence: '\r', full: 'enter' });

    expect(assignHandler).toHaveBeenCalledWith('spec', 'codex');
  });

  it('destroy cleans up without error', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const widget = createAgentPicker(parent);
    expect(() => widget.destroy()).not.toThrow();
  });
});
