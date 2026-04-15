import blessed from 'neo-blessed';
import { BaseScreen } from './base-screen.js';
import type { QaAssessment, DocumentationResult } from '../../types/spec.js';
import type { GitHubReportResult } from '../../types/github.js';
import { getTheme, fgTag } from '../theme.js';

export interface CompleteScreenData {
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
  onNewPipeline: () => void;
}

function buildContent(data: CompleteScreenData): string {
  const durationSecs = (data.duration / 1000).toFixed(1);
  const qaAssessments = data.qaAssessments ?? [];
  const finalCodeQa = [...qaAssessments].reverse().find((qa) => qa.target === 'code');

  const lines: string[] = [];
  lines.push('{green-fg}{bold}Task finished successfully{/bold}{/green-fg}');
  lines.push('');
  lines.push(`{#888888-fg}Iterations:{/}  ${data.iterations}`);
  lines.push(
    `{#888888-fg}Tests:{/}       {green-fg}${data.testsPassing}/${data.testsTotal} passing{/green-fg}`,
  );
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
      top: 1,
      left: 1,
      right: 1,
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
      padding: 1,
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
      content: `${fgTag(getTheme().colors.muted)}Press [Enter] or run again to start a new pipeline{/}`,
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

    this.parent.screen?.render();
  }
}
