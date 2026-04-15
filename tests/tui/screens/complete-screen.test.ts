import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTestScreen, createParentBox, simulateKey } from '../helpers/blessed-harness.js';
import { CompleteScreen } from '../../../src/tui/screens/complete-screen.js';
import type blessed from 'neo-blessed';

let screen: blessed.Widgets.Screen | null = null;

afterEach(() => {
  if (screen) {
    screen.destroy();
    screen = null;
  }
});

const baseData = {
  iterations: 2,
  testsTotal: 10,
  testsPassing: 9,
  filesCreated: ['src/index.ts', 'src/auth.ts'],
  duration: 12500,
  outputDir: '/tmp/output',
  securitySummary: 'enabled for all eligible outputs',
  onNewPipeline: vi.fn(),
};

describe('CompleteScreen', () => {
  it('activates without errors', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const cs = new CompleteScreen(parent, { ...baseData, onNewPipeline: vi.fn() });
    expect(() => cs.activate()).not.toThrow();
  });

  it('shows Pipeline Complete message', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const cs = new CompleteScreen(parent, { ...baseData, onNewPipeline: vi.fn() });
    cs.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    expect(collectContent(parent)).toContain('Task finished successfully');
  });

  it('shows test counts', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const cs = new CompleteScreen(parent, { ...baseData, onNewPipeline: vi.fn() });
    cs.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    const content = collectContent(parent);
    expect(content).toContain('9/10');
  });

  it('shows output directory', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const cs = new CompleteScreen(parent, { ...baseData, onNewPipeline: vi.fn() });
    cs.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    expect(collectContent(parent)).toContain('/tmp/output');
  });

  it('shows security summary when provided', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const cs = new CompleteScreen(parent, { ...baseData, onNewPipeline: vi.fn() });
    cs.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    expect(collectContent(parent)).toContain('Security');
    expect(collectContent(parent)).toContain('enabled for all eligible outputs');
  });

  it('shows files created', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const cs = new CompleteScreen(parent, { ...baseData, onNewPipeline: vi.fn() });
    cs.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    const content = collectContent(parent);
    expect(content).toContain('src/index.ts');
  });

  it('shows merged GitHub report state when available', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const cs = new CompleteScreen(parent, {
      ...baseData,
      githubReport: {
        prUrl: 'https://github.com/owner/repo/pull/1',
        posted: true,
        merged: true,
        mergeUrl: 'https://github.com/owner/repo/pull/1',
      },
      onNewPipeline: vi.fn(),
    });
    cs.activate();

    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }

    const content = collectContent(parent);
    expect(content).toContain('posted and merged');
  });

  it('calls onNewPipeline when enter pressed', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const onNewPipeline = vi.fn();
    const cs = new CompleteScreen(parent, { ...baseData, onNewPipeline });
    cs.activate();
    simulateKey(screen, 'enter');
    expect(onNewPipeline).toHaveBeenCalled();
  });

  it('shows duration', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const cs = new CompleteScreen(parent, { ...baseData, onNewPipeline: vi.fn() });
    cs.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    // 12500ms = 12.5s
    expect(collectContent(parent)).toContain('12.5s');
  });

  it('deactivates cleanly', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const cs = new CompleteScreen(parent, { ...baseData, onNewPipeline: vi.fn() });
    cs.activate();
    expect(() => cs.deactivate()).not.toThrow();
  });
});
