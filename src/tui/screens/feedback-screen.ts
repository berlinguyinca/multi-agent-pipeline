import blessed from 'neo-blessed';
import { BaseScreen } from './base-screen.js';
import { createPipelineBar } from '../widgets/pipeline-bar.js';
import { createRefinementScore } from '../widgets/refinement-score.js';
import { createSpecViewer } from '../widgets/spec-viewer.js';
import { createSpecDiff } from '../widgets/spec-diff.js';
import { createChatInput } from '../widgets/chat-input.js';
import { createKeyboardHelp } from '../widgets/keyboard-help.js';
import type { PipelineBarData } from '../widgets/pipeline-bar.js';
import type { RefinementScoreData } from '../widgets/refinement-score.js';

export interface FeedbackScreenData {
  stages: PipelineBarData['stages'];
  iteration: number;
  scores: RefinementScoreData['scores'];
  specContent: string;
  previousSpecContent?: string;
  onApprove: () => void;
  onFeedback: (text: string) => void;
}

export class FeedbackScreen extends BaseScreen {
  private data: FeedbackScreenData;
  private showDiff = false;

  private barWidget: ReturnType<typeof createPipelineBar> | null = null;
  private scoreWidget: ReturnType<typeof createRefinementScore> | null = null;
  private viewerWidget: ReturnType<typeof createSpecViewer> | null = null;
  private diffWidget: ReturnType<typeof createSpecDiff> | null = null;
  private helpWidget: ReturnType<typeof createKeyboardHelp> | null = null;
  private chatInputWidget: ReturnType<typeof createChatInput> | null = null;

  constructor(parent: blessed.Widgets.BoxElement, data: FeedbackScreenData) {
    super(parent);
    this.data = data;
  }

  updateData(data: Partial<FeedbackScreenData>): void {
    this.data = { ...this.data, ...data };
    this._refreshWidgets();
  }

  private _hasDiff(): boolean {
    return (
      this.data.previousSpecContent !== undefined &&
      this.data.previousSpecContent !== ''
    );
  }

  private _refreshWidgets(): void {
    if (this.barWidget) {
      this.barWidget.update({ stages: this.data.stages, iteration: this.data.iteration });
    }
    if (this.scoreWidget) {
      this.scoreWidget.update({ scores: this.data.scores });
    }
    if (this.showDiff && this._hasDiff() && this.diffWidget) {
      this.diffWidget.update({
        oldContent: this.data.previousSpecContent ?? '',
        newContent: this.data.specContent,
      });
    } else if (this.viewerWidget) {
      this.viewerWidget.update({ content: this.data.specContent });
    }
    const hasDiff = this._hasDiff();
    if (this.helpWidget) {
      this.helpWidget.update({
        shortcuts: [
          { key: 'Enter', label: 'Refine' },
          { key: 'Ctrl+E', label: 'Approve' },
          ...(hasDiff
            ? [{ key: 'Tab', label: `Toggle ${this.showDiff ? 'spec' : 'diff'} view` }]
            : []),
        ],
      });
    }
    this.parent.screen?.render();
  }

  refreshTheme(): void {
    if (this.chatInputWidget) {
      this.chatInputWidget.update({ placeholder: 'Provide feedback to refine the spec...', prefix: '>' });
    }
    this._refreshWidgets();
  }

  activate(): void {
    const bar = createPipelineBar(this.parent);
    (bar.element as blessed.Widgets.BoxElement & { top: number }).top = 0;
    bar.update({ stages: this.data.stages, iteration: this.data.iteration });
    this.barWidget = bar;
    this.widgets.push(bar);

    const score = createRefinementScore(this.parent);
    (score.element as blessed.Widgets.BoxElement & { top: number }).top = 4;
    score.update({ scores: this.data.scores });
    this.scoreWidget = score;
    this.widgets.push({ destroy: () => { score.destroy(); this.scoreWidget = null; } });

    const hasDiff = this._hasDiff();

    const viewer = createSpecViewer(this.parent);
    (viewer.element as blessed.Widgets.BoxElement & { top: number }).top = 4 + (this.data.scores.length || 1) + 1;
    (viewer.element as blessed.Widgets.BoxElement & { height: number }).height = 15;
    viewer.update({ content: this.data.specContent });
    this.viewerWidget = viewer;
    this.widgets.push({ destroy: () => { viewer.destroy(); this.viewerWidget = null; } });

    const diff = createSpecDiff(this.parent);
    (diff.element as blessed.Widgets.BoxElement & { top: number }).top = 4 + (this.data.scores.length || 1) + 1;
    (diff.element as blessed.Widgets.BoxElement & { height: number }).height = 15;
    diff.element.hide();
    if (hasDiff) {
      diff.update({
        oldContent: this.data.previousSpecContent ?? '',
        newContent: this.data.specContent,
      });
    }
    this.diffWidget = diff;
    this.widgets.push({ destroy: () => { diff.destroy(); this.diffWidget = null; } });

    const specBottom = 4 + (this.data.scores.length || 1) + 1 + 15;

    const chatInput = createChatInput(this.parent, (value) => {
      this.data.onFeedback(value);
    });
    (chatInput.element as blessed.Widgets.BoxElement & { top: number }).top = specBottom + 1;
    chatInput.update({ placeholder: 'Provide feedback to refine the spec...', prefix: '>' });
    this.chatInputWidget = chatInput;
    this.widgets.push(chatInput);

    const help = createKeyboardHelp(this.parent);
    (help.element as blessed.Widgets.BoxElement & { top: number }).top = specBottom + 3;
    help.update({
      shortcuts: [
        { key: 'Enter', label: 'Refine' },
        { key: 'Ctrl+E', label: 'Approve' },
        ...(hasDiff ? [{ key: 'Tab', label: 'Toggle diff view' }] : []),
      ],
    });
    this.helpWidget = help;
    this.widgets.push({ destroy: () => { help.destroy(); this.helpWidget = null; } });

    // Tab toggles diff view
    const screen = this.parent.screen;
    if (screen && hasDiff) {
      const tabHandler = () => {
        this.showDiff = !this.showDiff;
        if (this.showDiff) {
          viewer.element.hide();
          diff.element.show();
        } else {
          diff.element.hide();
          viewer.element.show();
        }
        this._refreshWidgets();
      };
      screen.key('tab', tabHandler);
      this.widgets.push({
        destroy: () => {
          screen.unkey('tab', tabHandler);
        },
      });
    }

    // Ctrl+E to approve
    if (screen) {
      const approveHandler = () => { this.data.onApprove(); };
      screen.key('C-e', approveHandler);
      this.widgets.push({
        destroy: () => {
          screen.unkey('C-e', approveHandler);
        },
      });
    }

    this.parent.screen?.render();
  }

  deactivate(): void {
    this.barWidget = null;
    this.scoreWidget = null;
    this.viewerWidget = null;
    this.diffWidget = null;
    this.helpWidget = null;
    this.showDiff = false;
    this.chatInputWidget = null;
    super.deactivate();
  }
}
