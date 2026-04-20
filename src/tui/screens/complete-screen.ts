import blessed from 'neo-blessed';
import { BaseScreen } from './base-screen.js';
import type { QaAssessment, DocumentationResult } from '../../types/spec.js';
import type { GitHubReportResult } from '../../types/github.js';
import type { DAGEdgeType } from '../../types/dag.js';
import { getTheme, fgTag } from '../theme.js';
import { renderModelOutput } from '../output-renderer.js';

export interface CompleteScreenData {
  outcome: 'success' | 'blocked' | 'failed' | 'cancelled';
  iterations: number;
  testsTotal: number;
  testsPassing: number;
  filesCreated: string[];
  duration: number;
  outputDir: string;
  securitySummary?: string;
  qaAssessments?: QaAssessment[];
  documentationResult?: DocumentationResult;
  githubReport?: GitHubReportResult;
  finalReport?: {
    title: string;
    content: string;
    logPath?: string;
  };
  executionGraph?: Array<{
    id: string;
    agent: string;
    provider?: string;
    model?: string;
    task: string;
    status: string;
    duration?: number;
    dependsOn: string[];
    edges?: Array<{
      from: string;
      type: DAGEdgeType;
    }>;
  }>;
  markdownFiles?: string[];
  onNewPipeline: () => void;
}

function formatDuration(ms?: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function sectionTitle(title: string): string {
  return `${fgTag(getTheme().colors.accent)}{bold}${title}{/bold}{/}`;
}

function buildContent(data: CompleteScreenData): string {
  const durationSecs = (data.duration / 1000).toFixed(1);
  const qaAssessments = data.qaAssessments ?? [];
  const finalCodeQa = [...qaAssessments].reverse().find((qa) => qa.target === 'code');
  const banner =
    data.outcome === 'success'
      ? '{green-fg}{bold}Task finished successfully{/bold}{/green-fg}'
      : data.outcome === 'blocked'
        ? '{yellow-fg}{bold}Task blocked{/bold}{/yellow-fg}'
        : data.outcome === 'cancelled'
          ? '{#888888-fg}{bold}Task cancelled{/bold}{/}'
          : '{red-fg}{bold}Task failed{/bold}{/red-fg}';

  const lines: string[] = [];
  lines.push(banner);
  lines.push('');
  lines.push(`{#888888-fg}Iterations:{/}  ${data.iterations}`);
  const passingColor = data.testsPassing === data.testsTotal ? 'green-fg' : 'yellow-fg';
  lines.push(`{#888888-fg}Tests:{/}       {${passingColor}}${data.testsPassing}/${data.testsTotal} passing{/${passingColor}}`);
  lines.push(`{#888888-fg}Duration:{/}    ${durationSecs}s`);
  lines.push(`{#888888-fg}Output:{/}      ${data.outputDir}`);

  if (data.securitySummary) {
    lines.push(`{#888888-fg}Security:{/}    ${data.securitySummary}`);
  }

  if (finalCodeQa) {
    const qaStatus = finalCodeQa.passed
      ? '{green-fg}passed{/green-fg}'
      : '{red-fg}failed{/red-fg}';
    const summary = finalCodeQa.summary ? ` — ${finalCodeQa.summary}` : '';
    lines.push(`{#888888-fg}QA:{/}          ${qaStatus}${summary}`);
  }

  if (data.githubReport) {
    const ghStatus = data.githubReport.merged
      ? `{green-fg}posted and merged${data.githubReport.mergeUrl ? ` (${data.githubReport.mergeUrl})` : ''}{/green-fg}`
      : data.githubReport.posted
        ? `{green-fg}posted${data.githubReport.commentUrl ? ` (${data.githubReport.commentUrl})` : ''}{/green-fg}`
        : `{red-fg}not posted: ${data.githubReport.error ?? 'unknown error'}{/red-fg}`;
    lines.push(`{#888888-fg}GitHub:{/}      ${ghStatus}`);
  }

  if (data.documentationResult) {
    lines.push('');
    lines.push('{#888888-fg}Documentation updated:{/}');
    if (data.documentationResult.filesUpdated.length > 0) {
      for (const f of data.documentationResult.filesUpdated) {
        lines.push(`  {#888888-fg}•{/} ${f}`);
      }
    } else {
      lines.push('  {#888888-fg}• No Markdown files changed{/}');
    }
  }

  if (data.filesCreated.length > 0) {
    lines.push('');
    lines.push('{#888888-fg}Files created:{/}');
    for (const f of data.filesCreated) {
      lines.push(`  {#888888-fg}•{/} ${f}`);
    }
  }

  if (data.executionGraph && data.executionGraph.length > 0) {
    const edges = data.executionGraph.flatMap((step) =>
      (step.edges ?? step.dependsOn.map((dep) => ({ from: dep, type: 'planned' as const }))).map(
        (edge) => `${edge.from} -[${edge.type}]-> ${step.id}`,
      ),
    );

    lines.push('');
    lines.push(sectionTitle('Execution graph'));
    if (edges.length > 0) {
      lines.push(`{#888888-fg}Connections:{/} ${edges.join(', ')}`);
    } else {
      lines.push('{#888888-fg}Connections:{/} none');
    }

    data.executionGraph.forEach((step, index) => {
      const duration = step.duration ? ` ${formatDuration(step.duration)}` : '';
      const runtime =
        step.provider !== undefined
          ? ` | ${step.provider}${step.model ? `/${step.model}` : ''}`
          : '';
      lines.push(
        `${index + 1}. ${step.id} [${step.agent}${runtime}] ${step.status}${duration}`,
      );
      lines.push(`   ${step.task}`);
      lines.push(
        step.dependsOn.length > 0
          ? `   depends on: ${step.dependsOn.join(', ')}`
          : '   ready to start',
      );
    });
  }

  if (data.finalReport?.content.trim()) {
    lines.push('');
    lines.push(sectionTitle(data.finalReport.title));
    if (data.finalReport.logPath) {
      lines.push(`{#888888-fg}Raw log:{/}     ${data.finalReport.logPath}`);
    }
    lines.push('');
    lines.push(renderModelOutput(data.finalReport.content));
  }

  if (data.markdownFiles && data.markdownFiles.length > 0) {
    lines.push('');
    lines.push(sectionTitle('Saved Markdown'));
    for (const file of data.markdownFiles) {
      lines.push(`- ${file}`);
    }
  }

  return lines.join('\n');
}

export class CompleteScreen extends BaseScreen {
  private data: CompleteScreenData;
  private mainBox: blessed.Widgets.BoxElement | null = null;
  private hintBox: blessed.Widgets.BoxElement | null = null;

  constructor(parent: blessed.Widgets.BoxElement, data: CompleteScreenData) {
    super(parent);
    this.data = data;
  }

  updateData(data: Partial<CompleteScreenData>): void {
    this.data = { ...this.data, ...data };
    // Re-activate to refresh content
    this.deactivate();
    this.activate();
  }

  refreshTheme(): void {
    const theme = getTheme();
    if (this.mainBox) {
      this.mainBox.style = {
        ...(this.mainBox.style ?? {}),
        border: { fg: theme.colors.border },
        fg: theme.colors.panelFg,
        bg: theme.colors.panelBg,
      };
    }
    if (this.hintBox) {
      this.hintBox.style = {
        ...(this.hintBox.style ?? {}),
        fg: theme.colors.panelFg,
        bg: theme.colors.panelBg,
      };
    }
    this.parent.screen?.render();
  }

  activate(): void {
    const box = blessed.box({
      parent: this.parent,
      top: 0,
      left: 0,
      right: 0,
      bottom: 2,
      tags: true,
      border: { type: 'line' },
      wrap: true,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      style: {
        border: { fg: getTheme().colors.border },
        fg: getTheme().colors.panelFg,
        bg: getTheme().colors.panelBg,
      },
      padding: {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
      },
      content: buildContent(this.data),
    });
    this.mainBox = box;
    this.widgets.push({ destroy: () => box.destroy() });

    const hint = blessed.box({
      parent: this.parent,
      bottom: 1,
      tags: true,
      height: 1,
      shrink: true,
      content: `${fgTag(getTheme().colors.muted)}j/k: scroll  Enter: new pipeline  q: restart later{/}`,
    });
    this.hintBox = hint;
    this.widgets.push({ destroy: () => hint.destroy() });

    // Enter key → new pipeline
    const screen = this.parent.screen;
    if (screen) {
      const enterHandler = () => { this.data.onNewPipeline(); };
      screen.key('enter', enterHandler);
      this.widgets.push({
        destroy: () => {
          screen.unkey('enter', enterHandler);
        },
      });
    }

    box.focus();
    this.parent.screen?.render();
  }
}
