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
  outcome: 'success' as const,
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

  it('shows blocked state summary when recovery cannot continue', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const cs = new CompleteScreen(parent, {
      ...baseData,
      outcome: 'blocked',
      finalReport: {
        title: 'Run Summary',
        content: 'Blocked on missing credentials.',
      },
      onNewPipeline: vi.fn(),
    });
    cs.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    expect(collectContent(parent)).toContain('Task blocked');
    expect(collectContent(parent)).toContain('Blocked on missing credentials');
  });

  it('shows cancelled state summary', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const cs = new CompleteScreen(parent, {
      ...baseData,
      outcome: 'cancelled',
      onNewPipeline: vi.fn(),
    });
    cs.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    expect(collectContent(parent)).toContain('Task cancelled');
  });

  it('sizes the main report panel inside the viewport', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const cs = new CompleteScreen(parent, { ...baseData, onNewPipeline: vi.fn() });
    cs.activate();

    const mainPanel = parent.children.find(
      (child) => (child as blessed.Widgets.BoxElement).border !== undefined,
    ) as blessed.Widgets.BoxElement & { bottom?: number };

    expect(mainPanel).toBeDefined();
    expect(mainPanel.top).toBe(0);
    expect(mainPanel.left).toBe(0);
    expect(mainPanel.right).toBe(0);
    expect(mainPanel.bottom).toBe(2);
    expect(mainPanel.padding).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it('focuses the main report panel so output can scroll immediately', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const cs = new CompleteScreen(parent, {
      ...baseData,
      finalReport: {
        title: 'Long Report',
        content: Array.from({ length: 80 }, (_, index) => `Line ${index + 1}`).join('\n'),
      },
      onNewPipeline: vi.fn(),
    });
    cs.activate();

    const mainPanel = parent.children.find(
      (child) => (child as blessed.Widgets.BoxElement).border !== undefined,
    );

    expect(screen.focused).toBe(mainPanel);
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

  it('renders final report content when provided', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const cs = new CompleteScreen(parent, {
      ...baseData,
      finalReport: {
        title: 'Generated Report',
        content: '# Research Report\n\n## Executive Summary\n\n- Avoid excess sugar.',
        logPath: '/tmp/raw-report.log',
      },
      onNewPipeline: vi.fn(),
    });
    cs.activate();

    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }

    const content = collectContent(parent);
    expect(content).toContain('Generated Report');
    expect(content).toContain('Research Report');
    expect(content).toContain('Executive Summary');
    expect(content).toContain('/tmp/raw-report.log');
  });

  it('renders the ordered execution graph when provided', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const cs = new CompleteScreen(parent, {
      ...baseData,
      executionGraph: [
        {
          id: 'step-1',
          agent: 'researcher',
          task: 'Research the topic',
          status: 'completed',
          duration: 1200,
          dependsOn: [],
        },
        {
          id: 'step-2',
          agent: 'writer',
          task: 'Write the final answer',
          status: 'completed',
          duration: 800,
          dependsOn: ['step-1'],
        },
      ],
      onNewPipeline: vi.fn(),
    });
    cs.activate();

    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }

    const content = collectContent(parent);
    expect(content).toContain('Execution graph');
    expect(content).toContain('1. step-1 [researcher]');
    expect(content).toContain('2. step-2 [writer]');
    expect(content).toContain('step-1 -[planned]-> step-2');
    expect(content).toContain('depends on: step-1');
  });

  it('renders saved markdown file paths when provided', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const cs = new CompleteScreen(parent, {
      ...baseData,
      markdownFiles: ['/tmp/out/map-output/pipe/final-report.md'],
      onNewPipeline: vi.fn(),
    });
    cs.activate();

    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }

    const content = collectContent(parent);
    expect(content).toContain('Saved Markdown');
    expect(content).toContain('/tmp/out/map-output/pipe/final-report.md');
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
