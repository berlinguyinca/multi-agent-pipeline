import blessed from 'neo-blessed';
import type { WidgetController } from './types.js';
import { getTheme, fgTag } from '../theme.js';

export interface PipelineBarData {
  stages: Array<{ name: string; status: 'waiting' | 'active' | 'complete'; agent: string }>;
  iteration: number;
}

const STATUS_ICONS: Record<string, string> = {
  waiting: '○',
  active: '●',
  complete: '✓',
};

const STATUS_COLORS: Record<string, string> = {
  waiting: '{#585858-fg}',
  active: '{#ff8700-fg}',
  complete: '{#d75f00-fg}',
};

export function createPipelineBar(parent: blessed.Widgets.Node): WidgetController<PipelineBarData> {
  const element = blessed.box({
    parent,
    tags: true,
    height: 3,
    left: 0,
    right: 0,
    width: '100%',
  });

  function update(data: PipelineBarData): void {
    const theme = getTheme();
    element.style = {
      ...(element.style ?? {}),
      fg: theme.colors.panelFg,
      bg: theme.colors.panelBg,
    };

    const header = `{bold}MAP Pipeline{/bold} ${fgTag(theme.colors.muted)}Iteration ${data.iteration}{/}`;

    const stageParts = data.stages.map((stage) => {
      const color = STATUS_COLORS[stage.status] ?? fgTag(theme.colors.panelFg);
      const icon = STATUS_ICONS[stage.status] ?? '?';
      return `${color}${icon} ${stage.name}{/}`;
    });

    const stageRow = stageParts.join(`  ${fgTag(theme.colors.muted)}━━{/}  `);

    const agentRow = data.stages
      .map((s) => `${fgTag(theme.colors.muted)}${s.agent.padEnd(s.name.length + 2)}{/}`)
      .join('       ');

    element.setContent(`${header}\n${stageRow}\n${agentRow}`);
    element.screen?.render();
  }

  return {
    element: element as blessed.Widgets.BoxElement,
    update,
    destroy: () => element.destroy(),
  };
}
