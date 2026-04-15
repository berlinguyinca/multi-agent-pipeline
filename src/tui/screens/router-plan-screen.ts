import blessed from 'neo-blessed';
import { BaseScreen } from './base-screen.js';
import type { DAGPlan } from '../../types/dag.js';
import { getTheme, fgTag } from '../theme.js';

export interface RouterPlanScreenData {
  plan: DAGPlan;
  onApprove: () => void;
  onCancel: () => void;
}

export class RouterPlanScreen extends BaseScreen {
  private data: RouterPlanScreenData;
  private titleBox: blessed.Widgets.BoxElement | null = null;
  private separatorBox: blessed.Widgets.BoxElement | null = null;
  private hintBox: blessed.Widgets.BoxElement | null = null;

  constructor(parent: blessed.Widgets.BoxElement, data: RouterPlanScreenData) {
    super(parent);
    this.data = data;
  }

  updateData(data: Partial<RouterPlanScreenData>): void {
    this.data = { ...this.data, ...data };
    this.deactivate();
    this.activate();
  }

  refreshTheme(): void {
    const theme = getTheme();
    for (const box of [this.titleBox, this.separatorBox, this.hintBox]) {
      if (!box) continue;
      box.style = {
        ...(box.style ?? {}),
        fg: theme.colors.panelFg,
        bg: theme.colors.panelBg,
      };
    }
    this.parent.screen?.render();
  }

  activate(): void {
    const title = blessed.box({
      parent: this.parent,
      top: 0,
      tags: true,
      height: 1,
      shrink: true,
      content: `{bold}${fgTag(getTheme().colors.accent)}  Router Plan{/}{/bold}`,
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

    let topOffset = 3;
    for (const step of this.data.plan.plan) {
      const depsLine =
        step.dependsOn.length > 0
          ? `\n  {yellow-fg}depends on: ${step.dependsOn.join(', ')}{/yellow-fg}`
          : '';

      const content =
        `{bold}${step.id}{/bold} {green-fg}[${step.agent}]{/green-fg}\n` +
        `  ${fgTag(getTheme().colors.muted)}${step.task}{/}` +
        depsLine;

      const lineCount = 2 + (step.dependsOn.length > 0 ? 1 : 0);
      const stepBox = blessed.box({
        parent: this.parent,
        top: topOffset,
        left: 2,
        tags: true,
        height: lineCount,
        shrink: true,
        content,
      });
      this.widgets.push({ destroy: () => stepBox.destroy() });
      topOffset += lineCount + 1;
    }

    const hint = blessed.box({
      parent: this.parent,
      top: topOffset + 1,
      left: 2,
      tags: true,
      height: 1,
      shrink: true,
      content: `${fgTag(getTheme().colors.muted)}Enter: Execute  |  Esc: Cancel{/}`,
    });
    this.hintBox = hint;
    this.widgets.push({ destroy: () => hint.destroy() });

    const screen = this.parent.screen;
    if (screen) {
      const enterHandler = () => { this.data.onApprove(); };
      const escHandler = () => { this.data.onCancel(); };
      screen.key(['enter'], enterHandler);
      screen.key(['escape'], escHandler);
      this.widgets.push({
        destroy: () => {
          screen.unkey(['enter'], enterHandler);
          screen.unkey(['escape'], escHandler);
        },
      });
    }

    this.parent.screen?.render();
  }
}
