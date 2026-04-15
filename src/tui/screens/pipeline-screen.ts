import blessed from 'neo-blessed';
import { BaseScreen } from './base-screen.js';
import { createPipelineBar } from '../widgets/pipeline-bar.js';
import { createStreamOutput } from '../widgets/stream-output.js';
import type { PipelineBarData } from '../widgets/pipeline-bar.js';
import type { StreamOutputData } from '../widgets/stream-output.js';
import { getTheme, fgTag } from '../theme.js';

export interface PipelineScreenData {
  stages: PipelineBarData['stages'];
  iteration: number;
  output: string;
  streaming: boolean;
  stageName: string;
  agentName: string;
}

export class PipelineScreen extends BaseScreen {
  private data: PipelineScreenData;
  private barWidget: ReturnType<typeof createPipelineBar> | null = null;
  private outputWidget: ReturnType<typeof createStreamOutput> | null = null;

  constructor(parent: blessed.Widgets.BoxElement, data: PipelineScreenData) {
    super(parent);
    this.data = data;
  }

  updateData(data: Partial<PipelineScreenData>): void {
    this.data = { ...this.data, ...data };
    if (this.barWidget) {
      this.barWidget.update({
        stages: this.data.stages,
        iteration: this.data.iteration,
      });
    }
    if (this.outputWidget) {
      this.outputWidget.update({
        content: this.data.output,
        streaming: this.data.streaming,
      });
    }
    this.stageLabel?.setContent(
      `{bold}${this.data.stageName}{/bold}${fgTag(getTheme().colors.muted)} — ${this.data.agentName}{/}`,
    );
    this.parent.screen?.render();
  }

  private stageLabel: blessed.Widgets.BoxElement | null = null;

  activate(): void {
    const bar = createPipelineBar(this.parent);
    (bar.element as blessed.Widgets.BoxElement & { top: number }).top = 0;
    bar.update({ stages: this.data.stages, iteration: this.data.iteration });
    this.barWidget = bar;
    this.widgets.push(bar);

    const label = blessed.box({
      parent: this.parent,
      top: 4,
      left: 0,
      right: 0,
      tags: true,
      height: 1,
      content: `{bold}${this.data.stageName}{/bold}${fgTag(getTheme().colors.muted)} — ${this.data.agentName}{/}`,
      style: {
        fg: getTheme().colors.panelFg,
        bg: getTheme().colors.panelBg,
      },
    });
    this.stageLabel = label;
    this.widgets.push({ destroy: () => { label.destroy(); this.stageLabel = null; } });

    const output = createStreamOutput(this.parent);
    (output.element as blessed.Widgets.BoxElement & { top: number }).top = 6;
    (output.element as blessed.Widgets.BoxElement & { bottom: number }).bottom = 0;
    output.update({ content: this.data.output, streaming: this.data.streaming });
    this.outputWidget = output;
    this.widgets.push({
      destroy: () => { output.destroy(); this.outputWidget = null; },
    });

    this.parent.screen?.render();
  }

  deactivate(): void {
    this.barWidget = null;
    this.outputWidget = null;
    this.stageLabel = null;
    super.deactivate();
  }

  refreshTheme(): void {
    if (this.stageLabel) {
      this.stageLabel.style = {
        ...(this.stageLabel.style ?? {}),
        fg: getTheme().colors.panelFg,
        bg: getTheme().colors.panelBg,
      };
    }
    this.updateData({});
  }
}
