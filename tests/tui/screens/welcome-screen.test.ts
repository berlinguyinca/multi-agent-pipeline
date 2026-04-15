import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTestScreen, createParentBox, simulateKey } from '../helpers/blessed-harness.js';
import { WelcomeScreen } from '../../../src/tui/screens/welcome-screen.js';
import type blessed from 'neo-blessed';

let screen: blessed.Widgets.Screen | null = null;

afterEach(() => {
  if (screen) {
    screen.destroy();
    screen = null;
  }
});

const availableBackends = ['claude', 'codex', 'ollama'];

function collectContent(node: blessed.Widgets.Node): string {
  const own = (node as blessed.Widgets.BoxElement).getContent?.() ?? '';
  return own + '\n' + node.children.map(collectContent).join('\n');
}

function findTextboxes(root: blessed.Widgets.Node): blessed.Widgets.TextboxElement[] {
  const results: blessed.Widgets.TextboxElement[] = [];
  (function walk(node: blessed.Widgets.Node) {
    if ((node as blessed.Widgets.TextboxElement).setValue) {
      results.push(node as blessed.Widgets.TextboxElement);
    }
    if (node.children) {
      for (const child of node.children) walk(child);
    }
  })(root);
  return results;
}

function findBoxByLabel(root: blessed.Widgets.Node, label: string): blessed.Widgets.BoxElement | null {
  for (const child of root.children) {
    const box = child as blessed.Widgets.BoxElement & { options?: { label?: string } };
    if (String(box.options?.label ?? '').includes(label)) {
      return box;
    }
    const nested = findBoxByLabel(child, label);
    if (nested) return nested;
  }
  return null;
}

describe('WelcomeScreen', () => {
  it('activates without errors', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ws = new WelcomeScreen(parent, { availableBackends }, vi.fn());
    expect(() => ws.activate()).not.toThrow();
  });

  it('shows available backends', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ws = new WelcomeScreen(parent, { availableBackends }, vi.fn());
    ws.activate();
    const content = collectContent(parent);
    expect(content).toContain('claude');
    expect(content).toContain('codex');
    expect(content).toContain('ollama');
  });

  it('shows Available Backends panel', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ws = new WelcomeScreen(parent, { availableBackends }, vi.fn());
    ws.activate();
    expect(collectContent(parent)).toContain('Available Backends');
  });

  it('shows dynamic routing message', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ws = new WelcomeScreen(parent, { availableBackends }, vi.fn());
    ws.activate();
    expect(collectContent(parent)).toContain('dynamically');
  });

  it('shows GitHub issue URL label', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ws = new WelcomeScreen(parent, { availableBackends }, vi.fn());
    ws.activate();
    expect(collectContent(parent)).toContain('GitHub issue URL');
  });

  it('shows start here label', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ws = new WelcomeScreen(parent, { availableBackends }, vi.fn());
    ws.activate();
    expect(collectContent(parent)).toContain('Start Here');
  });

  it('shows error message when githubIssueError provided', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ws = new WelcomeScreen(
      parent,
      { availableBackends, githubIssueError: 'Token not found' },
      vi.fn(),
    );
    ws.activate();
    expect(collectContent(parent)).toContain('Token not found');
  });

  it('tab cycles focus without throwing', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ws = new WelcomeScreen(parent, { availableBackends }, vi.fn());
    ws.activate();
    expect(() => simulateKey(screen!, 'tab')).not.toThrow();
    expect(() => simulateKey(screen!, 'tab')).not.toThrow();
  });

  it('deactivates cleanly', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ws = new WelcomeScreen(parent, { availableBackends }, vi.fn());
    ws.activate();
    expect(() => ws.deactivate()).not.toThrow();
  });

  it('updateData does not throw', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ws = new WelcomeScreen(parent, { availableBackends }, vi.fn());
    expect(() => ws.updateData({ availableBackends: ['claude'] })).not.toThrow();
  });

  it('does not crash when onStart triggers immediate deactivation', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const onStart = vi.fn((_prompt: string, _url?: string) => {
      ws.deactivate();
    });
    const ws = new WelcomeScreen(
      parent,
      { availableBackends, initialGithubIssueUrl: 'https://github.com/org/repo/issues/1' },
      onStart,
    );
    ws.activate();

    // Prompt input is auto-focused; press enter
    expect(() => simulateKey(screen!, 'enter')).not.toThrow();
    expect(onStart).toHaveBeenCalled();
  });

  it('does not call onStart when prompt is empty and no URL', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const onStart = vi.fn();
    const ws = new WelcomeScreen(parent, { availableBackends }, onStart);
    ws.activate();
    simulateKey(screen!, 'enter');
    expect(onStart).not.toHaveBeenCalled();
  });

  it('shows validation error when prompt is too short', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const onStart = vi.fn();
    const ws = new WelcomeScreen(parent, { availableBackends }, onStart);
    ws.activate();

    const textboxes = findTextboxes(parent);
    const promptInput = textboxes[0];
    if (promptInput) {
      promptInput.setValue('test');
    }

    simulateKey(screen!, 'enter');
    expect(onStart).not.toHaveBeenCalled();
    expect(collectContent(parent)).toContain('too short');
  });

  it('passes GitHub URL from initial data', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ws = new WelcomeScreen(
      parent,
      { availableBackends, initialGithubIssueUrl: 'https://github.com/org/repo/issues/1' },
      vi.fn(),
    );
    ws.activate();
    expect(collectContent(parent)).toContain('GitHub issue URL');
  });

  it('prefills the prompt when initialPrompt is provided', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ws = new WelcomeScreen(
      parent,
      {
        availableBackends,
        initialPrompt: 'Refactor the routing flow',
      },
      vi.fn(),
    );
    ws.activate();

    const textboxes = findTextboxes(parent);
    expect(textboxes[0]?.getValue()).toBe('Refactor the routing flow');
  });

  it('can activate then deactivate then activate again', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ws = new WelcomeScreen(parent, { availableBackends }, vi.fn());
    ws.activate();
    ws.deactivate();
    expect(() => ws.activate()).not.toThrow();
    expect(collectContent(parent)).toContain('Available Backends');
  });

  it('shows bordered panels', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ws = new WelcomeScreen(parent, { availableBackends }, vi.fn());
    ws.activate();
    const borderedChildren = parent.children.filter(
      (c) => (c as blessed.Widgets.BoxElement).border !== undefined,
    );
    expect(borderedChildren.length).toBeGreaterThanOrEqual(2);
  });

  it('shows keyboard hints', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ws = new WelcomeScreen(parent, { availableBackends }, vi.fn());
    ws.activate();
    const content = collectContent(parent);
    expect(content).toContain('Tab');
    expect(content).toContain('Enter');
    expect(content).toContain('Esc');
  });

  it('keeps the start panel visible on a 24-row terminal with all backends', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ws = new WelcomeScreen(
      parent,
      { availableBackends: ['claude', 'codex', 'ollama', 'hermes'] },
      vi.fn(),
    );
    ws.activate();

    const startPanel = findBoxByLabel(parent, 'Start Here');
    expect(startPanel).not.toBeNull();
    expect(Number(startPanel?.top) + Number(startPanel?.height)).toBeLessThanOrEqual(23);
  });

  it('opens prompt history with Ctrl+H', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ws = new WelcomeScreen(
      parent,
      {
        availableBackends,
        recentPrompts: [
          {
            prompt: 'Rework the parser',
            githubIssueUrl: 'https://github.com/org/repo/issues/7',
            timestamp: new Date().toISOString(),
          },
        ],
      },
      vi.fn(),
    );
    ws.activate();
    simulateKey(screen!, 'C-h');
    expect(collectContent(parent)).toContain('Prompt History');
  });

  it('reuses a prompt from history', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const onStart = vi.fn();
    const ws = new WelcomeScreen(
      parent,
      {
        availableBackends,
        recentPrompts: [
          {
            prompt: 'Rework the parser',
            githubIssueUrl: 'https://github.com/org/repo/issues/7',
            timestamp: new Date().toISOString(),
          },
        ],
      },
      onStart,
    );
    ws.activate();

    simulateKey(screen!, 'C-h');
    simulateKey(screen!, 'enter');

    const textboxes = findTextboxes(parent);
    expect(textboxes[0]?.getValue()).toBe('Rework the parser');
    expect(textboxes[1]?.getValue()).toBe('https://github.com/org/repo/issues/7');
    expect(onStart).toHaveBeenCalledWith(
      'Rework the parser',
      'https://github.com/org/repo/issues/7',
    );
  });

  it('cycles recent prompts inline with up/down on the prompt input', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ws = new WelcomeScreen(
      parent,
      {
        availableBackends,
        recentPrompts: [
          {
            prompt: 'Second prompt',
            githubIssueUrl: 'https://github.com/org/repo/issues/2',
            timestamp: new Date().toISOString(),
          },
          {
            prompt: 'First prompt',
            githubIssueUrl: 'https://github.com/org/repo/issues/1',
            timestamp: new Date().toISOString(),
          },
        ],
      },
      vi.fn(),
    );
    ws.activate();

    const textboxes = findTextboxes(parent);
    const promptInput = textboxes[0];
    promptInput?.focus();

    simulateKey(screen!, 'down');
    expect(textboxes[0]?.getValue()).toBe('First prompt');
    expect(textboxes[1]?.getValue()).toBe('https://github.com/org/repo/issues/1');

    simulateKey(screen!, 'up');
    expect(textboxes[0]?.getValue()).toBe('Second prompt');
    expect(textboxes[1]?.getValue()).toBe('https://github.com/org/repo/issues/2');
  });

  it('shows fallback message when no backends detected', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const ws = new WelcomeScreen(parent, { availableBackends: [] }, vi.fn());
    ws.activate();
    expect(collectContent(parent)).toContain('No backends detected');
  });

  it('submits from URL input via Enter', () => {
    screen = createTestScreen();
    const parent = createParentBox(screen);
    const onStart = vi.fn();
    const ws = new WelcomeScreen(
      parent,
      { availableBackends, initialGithubIssueUrl: 'https://github.com/org/repo/issues/1' },
      onStart,
    );
    ws.activate();

    // Focus URL input (second textbox) and press Enter
    const textboxes = findTextboxes(parent);
    const urlInput = textboxes[1];
    if (urlInput) {
      urlInput.focus();
    }
    simulateKey(screen!, 'enter');
    expect(onStart).toHaveBeenCalled();
  });
});
