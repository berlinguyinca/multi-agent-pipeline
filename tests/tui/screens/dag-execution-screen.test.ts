import { describe, it, expect, afterEach } from 'vitest';
import { createTestScreen, createParentBox } from '../helpers/blessed-harness.js';
import { DAGExecutionScreen } from '../../../src/tui/screens/dag-execution-screen.js';
import type blessed from 'neo-blessed';
import type { StepResult } from '../../../src/types/dag.js';

let screen: blessed.Widgets.Screen | null = null;

afterEach(() => {
  if (screen) {
    screen.destroy();
    screen = null;
  }
});

const steps: StepResult[] = [
  { id: 'step-1', agent: 'spec-writer', provider: 'claude', model: 'sonnet', status: 'completed', duration: 1200 },
  { id: 'step-2', agent: 'reviewer', provider: 'codex', model: 'gpt-5.4', status: 'running' },
  { id: 'step-3', agent: 'researcher', provider: 'ollama', model: 'gemma4:26b', status: 'pending' },
];

describe('DAGExecutionScreen', () => {
  it('activates without errors', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const des = new DAGExecutionScreen(parent, { steps });
    expect(() => des.activate()).not.toThrow();
  });

  it('shows Executing Plan title', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const des = new DAGExecutionScreen(parent, { steps });
    des.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    expect(collectContent(parent)).toContain('Executing Plan');
  });

  it('shows step ids', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const des = new DAGExecutionScreen(parent, { steps });
    des.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    const content = collectContent(parent);
    expect(content).toContain('step-1');
    expect(content).toContain('step-2');
  });

  it('shows provider and model details', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const des = new DAGExecutionScreen(parent, { steps });
    des.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    const content = collectContent(parent);
    expect(content).toContain('spec-writer');
    expect(content).toContain('claude/sonnet');
    expect(content).toContain('codex/gpt-5.4');
    expect(content).toContain('ollama/gemma4:26b');
  });

  it('shows step statuses', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const des = new DAGExecutionScreen(parent, { steps });
    des.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    const content = collectContent(parent);
    expect(content).toContain('completed');
    expect(content).toContain('running');
    expect(content).toContain('pending');
  });

  it('shows duration for completed step', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const des = new DAGExecutionScreen(parent, { steps });
    des.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    // 1200ms = 1.2s
    expect(collectContent(parent)).toContain('1.2s');
  });

  it('updateData refreshes step statuses', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const des = new DAGExecutionScreen(parent, { steps });
    des.activate();
    const updatedSteps: StepResult[] = [
      { id: 'step-1', agent: 'claude', status: 'completed', duration: 1200 },
      { id: 'step-2', agent: 'codex', status: 'completed', duration: 800 },
      { id: 'step-3', agent: 'ollama', status: 'running' },
    ];
    expect(() => des.updateData({ steps: updatedSteps })).not.toThrow();
  });

  it('shows failed step with error', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const failedSteps: StepResult[] = [
      { id: 'step-1', agent: 'claude', status: 'failed', error: 'timeout' },
    ];
    const des = new DAGExecutionScreen(parent, { steps: failedSteps });
    des.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    expect(collectContent(parent)).toContain('timeout');
  });

  it('deactivates cleanly', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const des = new DAGExecutionScreen(parent, { steps });
    des.activate();
    expect(() => des.deactivate()).not.toThrow();
  });
});
