import blessed from 'neo-blessed';
import { BaseScreen } from './base-screen.js';
import { getTheme, fgTag } from '../theme.js';

export interface SavedPipeline {
  id: string;
  name: string;
  stage: string;
  iteration: number;
  agents: string;
  timestamp: string;
}

export interface ResumeScreenData {
  pipelines: SavedPipeline[];
  onResume: (id: string) => void;
  onBack: () => void;
}

export class ResumeScreen extends BaseScreen {
  private data: ResumeScreenData;
  private selectedIndex = 0;
  private listBox: blessed.Widgets.ListElement | null = null;

  constructor(parent: blessed.Widgets.BoxElement, data: ResumeScreenData) {
    super(parent);
    this.data = data;
  }

  updateData(data: Partial<ResumeScreenData>): void {
    this.data = { ...this.data, ...data };
    this.selectedIndex = 0;
    this.deactivate();
    this.activate();
  }

  refreshTheme(): void {
    if (this.listBox) {
      const theme = getTheme();
      this.listBox.style = {
        ...(this.listBox.style ?? {}),
        selected: { fg: theme.colors.accent, bold: true },
        item: { fg: theme.colors.panelFg },
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
      content: `{bold}${fgTag(getTheme().colors.accent)}Resume Pipeline{/}{/bold}`,
      style: {
        fg: getTheme().colors.panelFg,
        bg: getTheme().colors.panelBg,
      },
    });
    this.widgets.push({ destroy: () => title.destroy() });

    const { pipelines } = this.data;

    if (pipelines.length === 0) {
      const empty = blessed.box({
        parent: this.parent,
        top: 2,
        tags: true,
        height: 1,
        content: `${fgTag(getTheme().colors.muted)}No saved pipelines found.{/}`,
        style: {
          fg: getTheme().colors.panelFg,
          bg: getTheme().colors.panelBg,
        },
      });
      this.widgets.push({ destroy: () => empty.destroy() });
    } else {
      const list = blessed.list({
        parent: this.parent,
        top: 2,
        left: 0,
        right: 0,
        bottom: 2,
        tags: true,
        keys: true,
        vi: true,
        mouse: false,
        style: {
          selected: { fg: getTheme().colors.accent, bold: true },
          item: { fg: getTheme().colors.panelFg },
        },
        items: pipelines.map((p, i) =>
          `{bold}${i + 1}. ${p.name}{/bold}  ${fgTag(getTheme().colors.muted)}${p.stage} | iter ${p.iteration} | ${p.agents} | ${p.timestamp}{/}`,
        ) as unknown as string[],
      }) as blessed.Widgets.ListElement;
      this.listBox = list;

      list.select(this.selectedIndex);

      list.key(['enter'], () => {
        const idx = (list as blessed.Widgets.ListElement & { selected: number }).selected;
        const pipeline = pipelines[idx];
        if (pipeline) {
          this.data.onResume(pipeline.id);
        }
      });

      this.widgets.push({ destroy: () => list.destroy() });

      list.focus();
    }

    const hint = blessed.box({
      parent: this.parent,
      bottom: 0,
      tags: true,
      height: 1,
      shrink: true,
      content:
        `${fgTag(getTheme().colors.muted)}↑/↓: navigate  Enter: resume  Esc: back{/}`,
    });
    this.widgets.push({ destroy: () => hint.destroy() });

    // Esc → back
    const screen = this.parent.screen;
    if (screen) {
      const escHandler = () => { this.data.onBack(); };
      screen.key(['escape'], escHandler);
      this.widgets.push({
        destroy: () => {
          screen.unkey(['escape'], escHandler);
        },
      });
    }

    this.parent.screen?.render();
  }
}
