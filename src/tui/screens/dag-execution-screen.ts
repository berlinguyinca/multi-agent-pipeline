import blessed from 'neo-blessed';
import { BaseScreen } from './base-screen.js';
import type { StepResult } from '../../types/dag.js';
import { getTheme, fgTag } from '../theme.js';

export interface DAGExecutionScreenData {
  steps: StepResult[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: '{#888888-fg}',
  running: '{yellow-fg}',
  completed: '{green-fg}',
  failed: '{red-fg}',
  skipped: '{#888888-fg}',
};

const STATUS_ICONS: Record<string, string> = {
  pending: '○',
  running: '◉',
  completed: '●',
  failed: '✗',
  skipped: '◌',
};

function formatDuration(ms?: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function buildContent(steps: StepResult[]): string {
  return steps
    .map((step) => {
      const color = STATUS_COLORS[step.status] ?? '{white-fg}';
      const icon = STATUS_ICONS[step.status] ?? '?';
      const duration = step.duration ? ` ${formatDuration(step.duration)}` : '';
      const error = step.error ? ` {red-fg}— ${step.error}{/red-fg}` : '';
      return (
        `  ${color}${icon}{/} {bold}${step.id}{/bold} {green-fg}[${step.agent}]{/green-fg} ` +
        `{#888888-fg}${step.status}{/}${duration}${error}`
      );
    })
    .join('\n');
}

export class DAGExecutionScreen extends BaseScreen {
  private data: DAGExecutionScreenData;
  private contentBox: blessed.Widgets.BoxElement | null = null;
  private titleBox: blessed.Widgets.BoxElement | null = null;
  private separatorBox: blessed.Widgets.BoxElement | null = null;

  constructor(parent: blessed.Widgets.BoxElement, data: DAGExecutionScreenData) {
    super(parent);
    this.data = data;
  }

  updateData(data: Partial<DAGExecutionScreenData>): void {
    this.data = { ...this.data, ...data };
    if (this.contentBox) {
      this.contentBox.setContent(buildContent(this.data.steps));
      this.parent.screen?.render();
    }
  }

  refreshTheme(): void {
    const theme = getTheme();
    for (const box of [this.titleBox, this.separatorBox, this.contentBox]) {
      if (!box) continue;
      box.style = {
        ...(box.style ?? {}),
        fg: theme.colors.panelFg,
        bg: theme.colors.panelBg,
      };
    }
    this.updateData({});
  }

  activate(): void {
    const title = blessed.box({
      parent: this.parent,
      top: 0,
      tags: true,
      height: 1,
      shrink: true,
      content: `{bold}${fgTag(getTheme().colors.accent)}  Executing Plan{/}{/bold}`,
      style: {
        fg: getTheme().colors.panelFg,
        bg: getTheme().colors.panelBg,
      },
    });
    this.titleBox = title;
    this.widgets.push({ destroy: () => title.destroy() });

    const separator = blessed.box({
      parent: this.parent,
      top: 1,
      tags: true,
      height: 1,
      shrink: true,
      content: `${fgTag(getTheme().colors.muted)}  ────────────────────────────────────────{/}`,
    });
    this.separatorBox = separator;
    this.widgets.push({ destroy: () => separator.destroy() });

    const content = blessed.box({
      parent: this.parent,
      top: 3,
      left: 0,
      right: 0,
      bottom: 0,
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: false,
      scrollbar: {
        ch: '│',
        style: { fg: getTheme().colors.accent },
        track: { bg: getTheme().colors.scrollbarTrack },
      },
      content: buildContent(this.data.steps),
      style: {
        fg: getTheme().colors.panelFg,
        bg: getTheme().colors.panelBg,
      },
    });
    this.contentBox = content;
    this.widgets.push({ destroy: () => { content.destroy(); this.contentBox = null; } });

    this.parent.screen?.render();
  }

  deactivate(): void {
    this.contentBox = null;
    super.deactivate();
  }
}
