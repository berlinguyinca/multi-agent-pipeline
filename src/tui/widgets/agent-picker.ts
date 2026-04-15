import blessed from 'neo-blessed';
import type { WidgetController } from './types.js';
import { getTheme, fgTag } from '../theme.js';

export interface AgentPickerData {
  stages: Array<{ name: string; agent: string }>;
  availableAgents: string[];
  focusedStage: number;
}

export function createAgentPicker(parent: blessed.Widgets.Node): WidgetController<AgentPickerData> & {
  on(event: 'assign', listener: (stage: string, agent: string) => void): void;
} {
  const element = blessed.list({
    parent,
    tags: true,
    keys: true,
    vi: true,
    mouse: false,
    style: {
      selected: { fg: getTheme().colors.accent, bold: true },
      item: { fg: getTheme().colors.panelFg },
    },
    items: [],
  }) as blessed.Widgets.ListElement;

  let currentData: AgentPickerData = { stages: [], availableAgents: [], focusedStage: 0 };
  const listeners: Array<(stage: string, agent: string) => void> = [];

  function buildItems(data: AgentPickerData): string[] {
    const theme = getTheme();
    const header = `{bold}${'STAGE'.padEnd(16)}AGENT{/bold}`;
    const rows = data.stages.map((stage, i) => {
      const cursor = i === data.focusedStage ? `${fgTag(theme.colors.accent)}>{/}` : ' ';
      const name = `${cursor} ${stage.name}`.padEnd(16);
      return `${name}${fgTag(theme.colors.muted)}${stage.agent}{/}`;
    });
    return [header, ...rows];
  }

  function update(data: AgentPickerData): void {
    const theme = getTheme();
    element.style = {
      ...(element.style ?? {}),
      selected: { fg: theme.colors.accent, bold: true },
      item: { fg: theme.colors.panelFg },
      fg: theme.colors.panelFg,
      bg: theme.colors.panelBg,
    };
    currentData = data;
    const items = buildItems(data);
    element.setItems(items as unknown as string[]);
    element.select(data.focusedStage + 1); // +1 for header row
    element.screen?.render();
  }

  // Enter key cycles agent for the focused stage
  element.key(['enter'], () => {
    const { stages, availableAgents, focusedStage } = currentData;
    if (!stages.length || !availableAgents.length) return;
    const stage = stages[focusedStage];
    if (!stage) return;
    const currentIdx = availableAgents.indexOf(stage.agent);
    const nextAgent = availableAgents[(currentIdx + 1) % availableAgents.length] ?? availableAgents[0];
    if (nextAgent) {
      listeners.forEach((fn) => fn(stage.name, nextAgent));
    }
  });

  function on(event: 'assign', listener: (stage: string, agent: string) => void): void {
    if (event === 'assign') listeners.push(listener);
  }

  return {
    element: element as unknown as blessed.Widgets.BoxElement,
    update,
    destroy: () => element.destroy(),
    on,
  };
}
