import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTestScreen, createParentBox, simulateKey } from '../helpers/blessed-harness.js';
import { RouterPlanScreen } from '../../../src/tui/screens/router-plan-screen.js';
import type blessed from 'neo-blessed';
import type { DAGPlan } from '../../../src/types/dag.js';

let screen: blessed.Widgets.Screen | null = null;

afterEach(() => {
  if (screen) {
    screen.destroy();
    screen = null;
  }
});

const plan: DAGPlan = {
  plan: [
    {
      id: 'step-1',
      agent: 'claude',
      task: 'Write the specification',
      dependsOn: [],
    },
    {
      id: 'step-2',
      agent: 'codex',
      task: 'Review the specification',
      dependsOn: ['step-1'],
    },
  ],
};

describe('RouterPlanScreen', () => {
  it('activates without errors', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const rps = new RouterPlanScreen(parent, {
      plan,
      onApprove: vi.fn(),
      onCancel: vi.fn(),
    });
    expect(() => rps.activate()).not.toThrow();
  });

  it('shows Pipeline Plan title', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const rps = new RouterPlanScreen(parent, {
      plan,
      onApprove: vi.fn(),
      onCancel: vi.fn(),
    });
    rps.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    expect(collectContent(parent)).toContain('Pipeline Plan');
  });

  it('shows step ids and agents', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const rps = new RouterPlanScreen(parent, {
      plan,
      onApprove: vi.fn(),
      onCancel: vi.fn(),
    });
    rps.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    const content = collectContent(parent);
    expect(content).toContain('step-1');
    expect(content).toContain('step-2');
    expect(content).toContain('claude');
    expect(content).toContain('codex');
  });

  it('shows step tasks', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const rps = new RouterPlanScreen(parent, {
      plan,
      onApprove: vi.fn(),
      onCancel: vi.fn(),
    });
    rps.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    const content = collectContent(parent);
    expect(content).toContain('Write the specification');
    expect(content).toContain('Review the specification');
  });

  it('shows depends-on for step with dependency', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const rps = new RouterPlanScreen(parent, {
      plan,
      onApprove: vi.fn(),
      onCancel: vi.fn(),
    });
    rps.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    expect(collectContent(parent)).toContain('depends on');
  });

  it('shows agent summary and dependency layers', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const rps = new RouterPlanScreen(parent, {
      plan,
      onApprove: vi.fn(),
      onCancel: vi.fn(),
    });
    rps.activate();

    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }

    const content = collectContent(parent);
    expect(content).toContain('Connections');
    expect(content).toContain('step-1 [claude] ─▶ step-2 [codex]');
    expect(content).toContain('Agents: claude, codex');
    expect(content).toContain('Layer 1');
    expect(content).toContain('Layer 2');
  });

  it('calls onApprove when enter pressed', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const onApprove = vi.fn();
    const rps = new RouterPlanScreen(parent, {
      plan,
      onApprove,
      onCancel: vi.fn(),
    });
    rps.activate();
    simulateKey(screen, 'enter');
    expect(onApprove).toHaveBeenCalled();
  });

  it('calls onCancel when escape pressed', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const onCancel = vi.fn();
    const rps = new RouterPlanScreen(parent, {
      plan,
      onApprove: vi.fn(),
      onCancel,
    });
    rps.activate();
    simulateKey(screen, 'escape');
    expect(onCancel).toHaveBeenCalled();
  });

  it('deactivates cleanly', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const rps = new RouterPlanScreen(parent, {
      plan,
      onApprove: vi.fn(),
      onCancel: vi.fn(),
    });
    rps.activate();
    expect(() => rps.deactivate()).not.toThrow();
  });
});
