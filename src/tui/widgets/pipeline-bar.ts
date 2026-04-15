import blessed from 'neo-blessed';
import type { WidgetController } from './types.js';
import { getTheme } from '../theme.js';
import { truncateText } from '../../utils/terminal-text.js';

export interface PipelineBarData {
  stages: Array<{ name: string; status: 'waiting' | 'active' | 'complete'; agent: string }>;
  iteration: number;
}

const STATUS_ICONS: Record<string, string> = {
  waiting: '○',
  active: '●',
  complete: '✓',
};

export function createPipelineBar(parent: blessed.Widgets.Node): WidgetController<PipelineBarData> {
  const element = blessed.box({
    parent,
    tags: true,
    height: 3,
    left: 0,
    right: 0,
  });

  function update(data: PipelineBarData): void {
    const theme = getTheme();
    const width = Math.max(20, Number(element.screen?.width ?? 80) - 2);
    const stageCount = Math.max(1, data.stages.length);
    const stageWidth = Math.max(8, Math.floor((width - (stageCount - 1) * 4) / stageCount) - 1);
    element.style = {
      ...(element.style ?? {}),
      fg: theme.colors.panelFg,
      bg: theme.colors.panelBg,
    };

    const headerText = truncateText(`MAP Pipeline Iteration ${data.iteration}`, width);
    const header = `{bold}${headerText}{/bold}`;

    const stageParts = data.stages.map((stage) => {
      const icon = STATUS_ICONS[stage.status] ?? '?';
      const name = truncateText(stage.name, stageWidth);
      return `${icon} ${name}`;
    });

    const stageRow = truncateText(stageParts.join('  →  '), width);

    const agentRow = data.stages
      .map((s) => truncateText(s.agent, stageWidth))
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
