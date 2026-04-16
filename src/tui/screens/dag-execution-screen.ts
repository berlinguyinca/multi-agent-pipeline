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

function buildGraphContent(steps: StepResult[], selectedIndex: number): string {
  const stepIds = new Set(steps.map((step) => step.id));
  const lines: string[] = [];

  for (const [index, step] of steps.entries()) {
    const color = STATUS_COLORS[step.status] ?? '{white-fg}';
    const icon = STATUS_ICONS[step.status] ?? '?';
    const duration = step.duration ? ` ${formatDuration(step.duration)}` : '';
    const selected = index === selectedIndex ? '>' : ' ';
    const security =
      step.securityPassed === true
        ? ' ◊ security passed'
        : step.securityPassed === false
          ? ' ◊ security failed'
          : '';
    lines.push(
      `${selected} ${color}${icon}{/} ${step.id} [${step.agent}] ${step.status}${duration}${security}`,
    );
  }

  const edges = steps.flatMap((step) =>
    (getStepDependsOn(step))
      .filter((dep) => stepIds.has(dep))
      .map((dep) => `${dep} -> ${step.id}`),
  );

  if (edges.length > 0) {
    lines.push('', ...edges.map((edge) => `  ${edge}`));
  }

  return lines.join('\n');
}

function buildDetailContent(step: StepResult | undefined): string {
  if (!step) return 'No steps yet.';

  const runtime = step.provider ? `${step.provider}${step.model ? `/${step.model}` : ''}` : 'unknown';
  const lines = [
    `${step.id} [${step.agent}]`,
    `Status: ${step.status}`,
    `Runtime: ${runtime}`,
    ...(step.task ? [`Task: ${step.task}`] : []),
    ...(step.duration ? [`Duration: ${formatDuration(step.duration)}`] : []),
    ...(step.error ? [`Error: ${step.error}`] : []),
  ];

  if (step.securityFindings && step.securityFindings.length > 0) {
    lines.push('', 'Security Findings:');
    for (const finding of step.securityFindings) {
      lines.push(`- ${finding.severity} ${finding.rule}: ${finding.message}`);
    }
  }

  if (step.output) {
    lines.push('', 'Output:', step.output);
  }

  return lines.join('\n');
}

function buildLegacySummaryContent(steps: StepResult[]): string {
  return steps
    .map((step) => {
      const color = STATUS_COLORS[step.status] ?? '{white-fg}';
      const icon = STATUS_ICONS[step.status] ?? '?';
      const duration = step.duration ? ` ${formatDuration(step.duration)}` : '';
      const error = step.error ? ` {red-fg}— ${step.error}{/red-fg}` : '';
      const runtime = step.provider
        ? ` {#888888-fg}(${step.provider}${step.model ? `/${step.model}` : ''}){/}`
        : '';
      return (
        `  ${color}${icon}{/} {bold}${step.id}{/bold} {green-fg}[${step.agent}]{/green-fg}${runtime} ` +
        `{#888888-fg}${step.status}{/}${duration}${error}`
      );
    })
    .join('\n');
}

export class DAGExecutionScreen extends BaseScreen {
  private data: DAGExecutionScreenData;
  private graphBox: blessed.Widgets.BoxElement | null = null;
  private detailBox: blessed.Widgets.BoxElement | null = null;
  private titleBox: blessed.Widgets.BoxElement | null = null;
  private separatorBox: blessed.Widgets.BoxElement | null = null;
  private selectedIndex = 0;

  constructor(parent: blessed.Widgets.BoxElement, data: DAGExecutionScreenData) {
    super(parent);
    this.data = data;
    this.selectedIndex = initialSelectedIndex(data.steps);
  }

  updateData(data: Partial<DAGExecutionScreenData>): void {
    this.data = { ...this.data, ...data };
    this.selectedIndex = clampSelectedIndex(this.selectedIndex, this.data.steps.length);
    this.refreshContent();
  }

  refreshTheme(): void {
    const theme = getTheme();
    for (const box of [this.titleBox, this.separatorBox, this.graphBox, this.detailBox]) {
      if (!box) continue;
      box.style = {
        ...(box.style ?? {}),
        fg: theme.colors.panelFg,
        bg: theme.colors.panelBg,
      };
    }
    this.refreshContent();
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

    const graph = blessed.box({
      parent: this.parent,
      top: 3,
      left: 0,
      right: 0,
      height: '45%',
      label: ' Workflow Graph ',
      tags: true,
      wrap: true,
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
      content: buildGraphContent(this.data.steps, this.selectedIndex),
      style: {
        fg: getTheme().colors.panelFg,
        bg: getTheme().colors.panelBg,
      },
    });
    this.graphBox = graph;
    this.widgets.push({ destroy: () => { graph.destroy(); this.graphBox = null; } });

    const detail = blessed.box({
      parent: this.parent,
      top: '50%',
      left: 0,
      right: 0,
      bottom: 0,
      label: ' Step Detail ',
      tags: true,
      wrap: true,
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
      content: buildDetailContent(this.data.steps[this.selectedIndex]) + '\n\n' + buildLegacySummaryContent(this.data.steps),
      style: {
        fg: getTheme().colors.panelFg,
        bg: getTheme().colors.panelBg,
      },
    });
    this.detailBox = detail;
    this.widgets.push({ destroy: () => { detail.destroy(); this.detailBox = null; } });

    const screen = this.parent.screen;
    if (screen) {
      const downHandler = () => {
        this.selectedIndex = clampSelectedIndex(this.selectedIndex + 1, this.data.steps.length);
        this.refreshContent();
      };
      const upHandler = () => {
        this.selectedIndex = clampSelectedIndex(this.selectedIndex - 1, this.data.steps.length);
        this.refreshContent();
      };
      screen.key(['j', 'down'], downHandler);
      screen.key(['k', 'up'], upHandler);
      this.widgets.push({
        destroy: () => {
          screen.unkey('j', downHandler);
          screen.unkey('down', downHandler);
          screen.unkey('k', upHandler);
          screen.unkey('up', upHandler);
        },
      });
    }

    this.parent.screen?.render();
  }

  deactivate(): void {
    this.graphBox = null;
    this.detailBox = null;
    super.deactivate();
  }

  private refreshContent(): void {
    this.graphBox?.setContent(buildGraphContent(this.data.steps, this.selectedIndex));
    this.detailBox?.setContent(
      buildDetailContent(this.data.steps[this.selectedIndex]) +
        '\n\n' +
        buildLegacySummaryContent(this.data.steps),
    );
    this.parent.screen?.render();
  }
}

function clampSelectedIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(index, count - 1));
}

function initialSelectedIndex(steps: StepResult[]): number {
  const runningIndex = steps.findIndex((step) => step.status === 'running');
  return runningIndex >= 0 ? runningIndex : 0;
}

function getStepDependsOn(step: StepResult): string[] {
  const value = (step as StepResult & { dependsOn?: unknown }).dependsOn;
  return Array.isArray(value) && value.every((dep) => typeof dep === 'string') ? value : [];
}
