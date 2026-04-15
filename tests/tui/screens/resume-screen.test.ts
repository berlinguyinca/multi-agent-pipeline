import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTestScreen, createParentBox, simulateKey } from '../helpers/blessed-harness.js';
import { ResumeScreen } from '../../../src/tui/screens/resume-screen.js';
import type blessed from 'neo-blessed';

let screen: blessed.Widgets.Screen | null = null;

afterEach(() => {
  if (screen) {
    screen.destroy();
    screen = null;
  }
});

const pipelines = [
  {
    id: 'abc123',
    name: 'Login feature',
    stage: 'reviewing',
    iteration: 2,
    agents: 'claude',
    timestamp: '2026-04-01T10:00:00Z',
  },
  {
    id: 'def456',
    name: 'Auth module',
    stage: 'executing',
    iteration: 1,
    agents: 'codex',
    timestamp: '2026-04-02T12:00:00Z',
  },
];

describe('ResumeScreen', () => {
  it('activates without errors', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const rs = new ResumeScreen(parent, {
      pipelines,
      onResume: vi.fn(),
      onBack: vi.fn(),
    });
    expect(() => rs.activate()).not.toThrow();
  });

  it('shows Resume Pipeline title', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const rs = new ResumeScreen(parent, {
      pipelines,
      onResume: vi.fn(),
      onBack: vi.fn(),
    });
    rs.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    expect(collectContent(parent)).toContain('Resume Pipeline');
  });

  it('shows pipeline names', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const rs = new ResumeScreen(parent, {
      pipelines,
      onResume: vi.fn(),
      onBack: vi.fn(),
    });
    rs.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    const content = collectContent(parent);
    expect(content).toContain('Login feature');
    expect(content).toContain('Auth module');
  });

  it('shows empty state message when no pipelines', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const rs = new ResumeScreen(parent, {
      pipelines: [],
      onResume: vi.fn(),
      onBack: vi.fn(),
    });
    rs.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    expect(collectContent(parent)).toContain('No saved pipelines found');
  });

  it('calls onBack when escape pressed', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const onBack = vi.fn();
    const rs = new ResumeScreen(parent, {
      pipelines,
      onResume: vi.fn(),
      onBack,
    });
    rs.activate();
    simulateKey(screen, 'escape');
    expect(onBack).toHaveBeenCalled();
  });

  it('deactivates cleanly', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const rs = new ResumeScreen(parent, {
      pipelines,
      onResume: vi.fn(),
      onBack: vi.fn(),
    });
    rs.activate();
    expect(() => rs.deactivate()).not.toThrow();
  });
});
