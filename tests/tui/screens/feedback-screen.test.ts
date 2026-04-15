import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTestScreen, createParentBox, simulateKey } from '../helpers/blessed-harness.js';
import { FeedbackScreen } from '../../../src/tui/screens/feedback-screen.js';
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
  { name: 'Review', status: 'complete' as const, agent: 'codex' },
  { name: 'Execute', status: 'waiting' as const, agent: 'ollama' },
];

const scores = [
  { iteration: 1, score: 0.6 },
  { iteration: 2, score: 0.85 },
];

const specContent = `# My Feature Spec

## Requirements
- [ ] User can login
- [ ] User can logout
`;

describe('FeedbackScreen', () => {
  it('activates without errors', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const fs = new FeedbackScreen(parent, {
      stages,
      iteration: 2,
      scores,
      specContent,
      onApprove: vi.fn(),
      onFeedback: vi.fn(),
    });
    expect(() => fs.activate()).not.toThrow();
  });

  it('shows spec content after activation', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const fs = new FeedbackScreen(parent, {
      stages,
      iteration: 2,
      scores,
      specContent,
      onApprove: vi.fn(),
      onFeedback: vi.fn(),
    });
    fs.activate();
    // Collect content recursively from children
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      const childContent = node.children.map(collectContent).join('\n');
      return own + '\n' + childContent;
    }
    const allContent = collectContent(parent);
    expect(allContent).toContain('My Feature Spec');
  });

  it('shows keyboard shortcuts', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const fs = new FeedbackScreen(parent, {
      stages,
      iteration: 2,
      scores,
      specContent,
      onApprove: vi.fn(),
      onFeedback: vi.fn(),
    });
    fs.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    const allContent = collectContent(parent);
    expect(allContent).toContain('Enter');
  });

  it('shows iteration number', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const fs = new FeedbackScreen(parent, {
      stages,
      iteration: 3,
      scores,
      specContent,
      onApprove: vi.fn(),
      onFeedback: vi.fn(),
    });
    fs.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    expect(collectContent(parent)).toContain('3');
  });

  it('calls onApprove when Ctrl+E pressed', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const onApprove = vi.fn();
    const fs = new FeedbackScreen(parent, {
      stages,
      iteration: 2,
      scores,
      specContent,
      onApprove,
      onFeedback: vi.fn(),
    });
    fs.activate();
    simulateKey(screen, 'C-e', { ctrl: true });
    expect(onApprove).toHaveBeenCalled();
  });

  it('shows tab shortcut when previousSpecContent provided', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const fs = new FeedbackScreen(parent, {
      stages,
      iteration: 2,
      scores,
      specContent,
      previousSpecContent: '# Old spec\n- old requirement',
      onApprove: vi.fn(),
      onFeedback: vi.fn(),
    });
    fs.activate();
    function collectContent(node: blessed.Widgets.Node): string {
      const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
      return own + '\n' + node.children.map(collectContent).join('\n');
    }
    const allContent = collectContent(parent);
    expect(allContent).toContain('Tab');
  });

  it('tab toggles diff view without throwing', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const fs = new FeedbackScreen(parent, {
      stages,
      iteration: 2,
      scores,
      specContent,
      previousSpecContent: '# Old spec',
      onApprove: vi.fn(),
      onFeedback: vi.fn(),
    });
    fs.activate();
    expect(() => simulateKey(screen!, 'tab')).not.toThrow();
    expect(() => simulateKey(screen!, 'tab')).not.toThrow();
  });

  it('renders with empty scores', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const fs = new FeedbackScreen(parent, {
      stages,
      iteration: 1,
      scores: [],
      specContent,
      onApprove: vi.fn(),
      onFeedback: vi.fn(),
    });
    expect(() => fs.activate()).not.toThrow();
  });

  it('deactivates cleanly', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const fs = new FeedbackScreen(parent, {
      stages,
      iteration: 2,
      scores,
      specContent,
      onApprove: vi.fn(),
      onFeedback: vi.fn(),
    });
    fs.activate();
    expect(() => fs.deactivate()).not.toThrow();
  });

  it('updateData refreshes content', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const fs = new FeedbackScreen(parent, {
      stages,
      iteration: 2,
      scores,
      specContent,
      onApprove: vi.fn(),
      onFeedback: vi.fn(),
    });
    fs.activate();
    expect(() =>
      fs.updateData({ specContent: '# Updated spec\n- new requirement' }),
    ).not.toThrow();
  });
});
