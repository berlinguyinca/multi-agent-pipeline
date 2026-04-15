import blessed from 'neo-blessed';
import type { WidgetController } from './types.js';
import { getTheme, fgTag } from '../theme.js';

export type TestStatus = 'pass' | 'fail' | 'running' | 'pending';

export interface TestProgressData {
  tests: Array<{ name: string; status: TestStatus }>;
}

const STATUS_ICONS: Record<TestStatus, string> = {
  pass: '✓',
  fail: '✗',
  running: '●',
  pending: '○',
};

const STATUS_COLORS: Record<TestStatus, string> = {
  pass: '{green-fg}',
  fail: '{red-fg}',
  running: '{#ff8700-fg}',
  pending: '{#888888-fg}',
};

export function createTestProgress(parent: blessed.Widgets.Node): WidgetController<TestProgressData> {
  const element = blessed.box({
    parent,
    tags: true,
    left: 0,
    right: 0,
    wrap: true,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    mouse: false,
    scrollbar: {
      ch: '│',
      style: { fg: '#d75f00' },
      track: { bg: '#333333' },
    },
  });

  function update(data: TestProgressData): void {
    const theme = getTheme();
    element.style = {
      ...(element.style ?? {}),
      fg: theme.colors.panelFg,
      bg: theme.colors.panelBg,
    };
    const lines = data.tests.map((test) => {
      const color = STATUS_COLORS[test.status];
      const icon = STATUS_ICONS[test.status];
      return `${color}${icon} ${test.name}{/}`;
    });

    if (data.tests.length > 0) {
      const passing = data.tests.filter((t) => t.status === 'pass').length;
      const failing = data.tests.filter((t) => t.status === 'fail').length;
      const running = data.tests.filter((t) => t.status === 'running').length;
      const pending = data.tests.filter((t) => t.status === 'pending').length;

      const summary: string[] = [];
      summary.push(`{green-fg}${passing} passing{/}`);
      if (failing > 0) summary.push(`{red-fg}${failing} failing{/}`);
      if (running > 0) summary.push(`{#ff8700-fg}${running} running{/}`);
      if (pending > 0) summary.push(`${fgTag(theme.colors.muted)}${pending} pending{/}`);

      lines.push('');
      lines.push(summary.join(' '));
    }

    element.setContent(lines.join('\n'));
    element.screen?.render();
  }

  return {
    element: element as blessed.Widgets.BoxElement,
    update,
    destroy: () => element.destroy(),
  };
}
