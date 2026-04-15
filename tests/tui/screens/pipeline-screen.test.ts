import { describe, it, expect, afterEach } from 'vitest';
import { createTestScreen, createParentBox } from '../helpers/blessed-harness.js';
import { PipelineScreen } from '../../../src/tui/screens/pipeline-screen.js';
import type blessed from 'neo-blessed';

let screen: blessed.Widgets.Screen | null = null;

afterEach(() => {
  if (screen) {
    screen.destroy();
    screen = null;
  }
});

const stages = [
  { name: 'Spec', status: 'active' as const, agent: 'claude' },
  { name: 'Review', status: 'waiting' as const, agent: 'codex' },
];

describe('PipelineScreen', () => {
  it('activates without errors', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ps = new PipelineScreen(parent, {
      stages,
      iteration: 1,
      output: '',
      streaming: false,
      stageName: 'Spec',
      agentName: 'claude',
    });
    expect(() => ps.activate()).not.toThrow();
  });

  it('shows stage name and agent', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ps = new PipelineScreen(parent, {
      stages,
      iteration: 1,
      output: '',
      streaming: false,
      stageName: 'Spec',
      agentName: 'claude',
    });
    ps.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    const allContent = collectContent(parent);
    expect(allContent).toContain('Spec');
    expect(allContent).toContain('claude');
  });

  it('shows output content', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ps = new PipelineScreen(parent, {
      stages,
      iteration: 1,
      output: 'Generating spec...',
      streaming: true,
      stageName: 'Spec',
      agentName: 'claude',
    });
    ps.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    expect(collectContent(parent)).toContain('Generating spec...');
  });

  it('updateData refreshes stage label', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ps = new PipelineScreen(parent, {
      stages,
      iteration: 1,
      output: '',
      streaming: false,
      stageName: 'Spec',
      agentName: 'claude',
    });
    ps.activate();
    expect(() =>
      ps.updateData({ stageName: 'Review', agentName: 'codex' }),
    ).not.toThrow();
  });

  it('deactivates cleanly', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ps = new PipelineScreen(parent, {
      stages,
      iteration: 1,
      output: '',
      streaming: false,
      stageName: 'Spec',
      agentName: 'claude',
    });
    ps.activate();
    expect(() => ps.deactivate()).not.toThrow();
  });
});
