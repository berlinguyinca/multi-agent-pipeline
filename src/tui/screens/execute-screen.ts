import blessed from 'neo-blessed';
import { BaseScreen } from './base-screen.js';
import { createPipelineBar } from '../widgets/pipeline-bar.js';
import { createTestProgress } from '../widgets/test-progress.js';
import { createStreamOutput } from '../widgets/stream-output.js';
import type { PipelineBarData } from '../widgets/pipeline-bar.js';
import type { TestProgressData } from '../widgets/test-progress.js';

export interface ExecuteScreenData {
  stages: PipelineBarData['stages'];
  iteration: number;
  output: string;
  streaming: boolean;
  tests: TestProgressData['tests'];
}

export class ExecuteScreen extends BaseScreen {
  private data: ExecuteScreenData;
  private barWidget: ReturnType<typeof createPipelineBar> | null = null;
  private testsWidget: ReturnType<typeof createTestProgress> | null = null;
  private outputWidget: ReturnType<typeof createStreamOutput> | null = null;

  constructor(parent: blessed.Widgets.BoxElement, data: ExecuteScreenData) {
    super(parent);
    this.data = data;
  }

  updateData(data: Partial<ExecuteScreenData>): void {
    this.data = { ...this.data, ...data };
    if (this.barWidget) {
      this.barWidget.update({ stages: this.data.stages, iteration: this.data.iteration });
    }
    if (this.testsWidget) {
      this.testsWidget.update({ tests: this.data.tests });
    }
    if (this.outputWidget) {
      this.outputWidget.update({ content: this.data.output, streaming: this.data.streaming });
    }
    this.parent.screen?.render();
  }

  refreshTheme(): void {
    this.updateData({});
  }

  activate(): void {
    const bar = createPipelineBar(this.parent);
    (bar.element as blessed.Widgets.BoxElement & { top: number }).top = 0;
    bar.update({ stages: this.data.stages, iteration: this.data.iteration });
    this.barWidget = bar;
    this.widgets.push(bar);

    const testsHeight = Math.max(4, this.data.tests.length + 2);
    const tests = createTestProgress(this.parent);
    (tests.element as blessed.Widgets.BoxElement & { top: number }).top = 4;
    (tests.element as blessed.Widgets.BoxElement & { height: number }).height = testsHeight;
    tests.update({ tests: this.data.tests });
    this.testsWidget = tests;
    this.widgets.push({ destroy: () => { tests.destroy(); this.testsWidget = null; } });

    const output = createStreamOutput(this.parent);
    (output.element as blessed.Widgets.BoxElement & { top: number }).top = 4 + testsHeight + 1;
    (output.element as blessed.Widgets.BoxElement & { bottom: number }).bottom = 0;
    output.update({ content: this.data.output, streaming: this.data.streaming });
    this.outputWidget = output;
    this.widgets.push({ destroy: () => { output.destroy(); this.outputWidget = null; } });

    this.parent.screen?.render();
  }

  deactivate(): void {
    this.barWidget = null;
    this.testsWidget = null;
    this.outputWidget = null;
    super.deactivate();
  }
}
