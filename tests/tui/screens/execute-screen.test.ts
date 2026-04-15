import { describe, it, expect, afterEach } from 'vitest';
import { createTestScreen, createParentBox } from '../helpers/blessed-harness.js';
import { ExecuteScreen } from '../../../src/tui/screens/execute-screen.js';
import type blessed from 'neo-blessed';

let screen: blessed.Widgets.Screen | null = null;

afterEach(() => {
  if (screen) {
    screen.destroy();
    screen = null;
  }
});

const stages = [
  { name: 'Spec', status: 'complete' as const, agent: 'claude' },
  { name: 'Execute', status: 'active' as const, agent: 'codex' },
];

const tests = [
  { name: 'login test', status: 'pass' as const },
  { name: 'logout test', status: 'running' as const },
];

describe('ExecuteScreen', () => {
  it('activates without errors', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const es = new ExecuteScreen(parent, {
      stages,
      iteration: 1,
      output: '',
      streaming: false,
      tests: [],
    });
    expect(() => es.activate()).not.toThrow();
  });

  it('shows test names', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const es = new ExecuteScreen(parent, {
      stages,
      iteration: 1,
      output: '',
      streaming: false,
      tests,
    });
    es.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    const allContent = collectContent(parent);
    expect(allContent).toContain('login test');
    expect(allContent).toContain('logout test');
  });

  it('shows output', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const es = new ExecuteScreen(parent, {
      stages,
      iteration: 1,
      output: 'Running npm test...',
      streaming: true,
      tests: [],
    });
    es.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    expect(collectContent(parent)).toContain('Running npm test...');
  });

  it('updateData refreshes test list', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const es = new ExecuteScreen(parent, {
      stages,
      iteration: 1,
      output: '',
      streaming: false,
      tests: [],
    });
    es.activate();
    expect(() =>
      es.updateData({ tests: [{ name: 'new test', status: 'pass' }] }),
    ).not.toThrow();
  });

  it('deactivates cleanly', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const es = new ExecuteScreen(parent, {
      stages,
      iteration: 1,
      output: '',
      streaming: false,
      tests,
    });
    es.activate();
    expect(() => es.deactivate()).not.toThrow();
  });
});
