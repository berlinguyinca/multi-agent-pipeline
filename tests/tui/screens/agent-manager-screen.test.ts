import { afterEach, describe, expect, it, vi } from 'vitest';
import type blessed from 'neo-blessed';
import { createParentBox, createTestScreen, simulateKey } from '../helpers/blessed-harness.js';
import { AgentManagerScreen } from '../../../src/tui/screens/agent-manager-screen.js';
import type { AgentDefinition } from '../../../src/types/agent-definition.js';

let screen: blessed.Widgets.Screen | null = null;

afterEach(() => {
  if (screen) {
    screen.destroy();
    screen = null;
  }
});

const agents = new Map<string, AgentDefinition>([
  [
    'researcher',
    {
      name: 'researcher',
      description: 'Research agent',
      adapter: 'ollama',
      model: 'gemma4',
      prompt: 'You research.',
      pipeline: [{ name: 'research' }],
      handles: 'research',
      output: { type: 'answer' },
      tools: [{ type: 'builtin', name: 'web-search' }],
    },
  ],
  [
    'coder',
    {
      name: 'coder',
      description: 'Coding agent',
      adapter: 'claude',
      model: 'sonnet',
      prompt: 'You code.',
      pipeline: [{ name: 'execute' }],
      handles: 'coding',
      output: { type: 'files' },
      tools: [{ type: 'builtin', name: 'shell' }],
    },
  ],
]);

function collectContent(node: blessed.Widgets.Node): string {
  const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
  return own + '\n' + node.children.map(collectContent).join('\n');
}

describe('AgentManagerScreen', () => {
  it('renders agent list and details', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const manager = new AgentManagerScreen(parent, {
      agents,
      installedOllamaModels: ['gemma4'],
      onBack: vi.fn(),
      onGenerateAgent: vi.fn(),
      onPullModel: vi.fn(),
      onSyncAllModels: vi.fn(),
      onRecommendModel: vi.fn(),
      onSaveAgent: vi.fn(),
    });
    manager.activate();
    const content = collectContent(parent);
    expect(content).toContain('Agent Manager');
    expect(content).toContain('researcher');
    expect(content).toContain('coder');
    expect(content).toContain('ollama/gemma4');
  });

  it('calls back when sync-all shortcut is used', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const onSyncAllModels = vi.fn();
    const manager = new AgentManagerScreen(parent, {
      agents,
      installedOllamaModels: ['gemma4'],
      onBack: vi.fn(),
      onGenerateAgent: vi.fn(),
      onPullModel: vi.fn(),
      onSyncAllModels,
      onRecommendModel: vi.fn(),
      onSaveAgent: vi.fn(),
    });
    manager.activate();
    simulateKey(screen!, 'u');
    expect(onSyncAllModels).toHaveBeenCalled();
  });
});
