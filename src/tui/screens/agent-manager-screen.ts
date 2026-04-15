import blessed from 'neo-blessed';
import { BaseScreen } from './base-screen.js';
import type { AgentDefinition } from '../../types/agent-definition.js';
import { getTheme, fgTag } from '../theme.js';

export interface AgentManagerScreenData {
  agents: Map<string, AgentDefinition>;
  installedOllamaModels: string[];
  onBack: () => void;
  onGenerateAgent: () => void;
  onPullModel: (agentName: string) => void;
  onSyncAllModels: () => void;
  onRecommendModel: (agentName: string) => void;
  onSaveAgent: (agentName: string, patch: { enabled?: boolean; model?: string }) => void;
}

export class AgentManagerScreen extends BaseScreen {
  private data: AgentManagerScreenData;
  private list: blessed.Widgets.ListElement | null = null;
  private detail: blessed.Widgets.BoxElement | null = null;
  private names: string[] = [];

  constructor(parent: blessed.Widgets.BoxElement, data: AgentManagerScreenData) {
    super(parent);
    this.data = data;
  }

  updateData(data: Partial<AgentManagerScreenData>): void {
    this.data = { ...this.data, ...data };
    this.refresh();
  }

  activate(): void {
    const theme = getTheme();
    this.names = [...this.data.agents.keys()].sort();

    const title = blessed.box({
      parent: this.parent,
      top: 0,
      left: 0,
      right: 0,
      height: 1,
      tags: true,
      content: `${fgTag(theme.colors.accent)}{bold} Agent Manager{/bold}{/}`,
      style: { fg: theme.colors.panelFg, bg: theme.colors.panelBg },
    });
    this.widgets.push({ destroy: () => title.destroy() });

    const list = blessed.list({
      parent: this.parent,
      top: 2,
      left: 0,
      width: '35%',
      bottom: 2,
      keys: true,
      vi: true,
      mouse: false,
      items: this.names.map((name) => formatAgentListLabel(name, this.data.agents.get(name)!)),
      style: {
        fg: theme.colors.panelFg,
        bg: theme.colors.panelBg,
        selected: { fg: theme.colors.accent, bold: true },
      },
      border: { type: 'line' },
      label: ` ${fgTag(theme.colors.accent)}{bold}Agents{/bold}{/} `,
    }) as blessed.Widgets.ListElement;
    this.list = list;
    this.widgets.push({ destroy: () => list.destroy() });

    const detail = blessed.box({
      parent: this.parent,
      top: 2,
      left: '35%',
      right: 0,
      bottom: 2,
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      border: { type: 'line' },
      label: ` ${fgTag(theme.colors.accent)}{bold}Details{/bold}{/} `,
      style: { fg: theme.colors.panelFg, bg: theme.colors.panelBg },
    });
    this.detail = detail;
    this.widgets.push({ destroy: () => detail.destroy() });

    const hint = blessed.box({
      parent: this.parent,
      bottom: 0,
      left: 1,
      right: 1,
      height: 1,
      tags: true,
      content: `${fgTag(theme.colors.muted)}Enter/j/k: select  g:generate  t:toggle enabled  r:recommend model  p:pull model  u:sync all  Esc:back{/}`,
      style: { fg: theme.colors.panelFg, bg: theme.colors.panelBg },
    });
    this.widgets.push({ destroy: () => hint.destroy() });

    const updateDetail = () => {
      const index = (list as blessed.Widgets.ListElement & { selected: number }).selected ?? 0;
      const agent = this.data.agents.get(this.names[index] ?? '');
      detail.setContent(agent ? buildDetail(agent, this.data.installedOllamaModels) : 'No agent selected');
      this.parent.screen?.render();
    };

    list.on('select item', updateDetail);
    list.on('keypress', updateDetail);
    updateDetail();

    const screen = this.parent.screen;
    if (screen) {
      const back = () => this.data.onBack();
      const generate = () => this.data.onGenerateAgent();
      const syncAll = () => this.data.onSyncAllModels();
      const toggleEnabled = () => {
        const agentName = this.currentAgentName();
        if (!agentName) return;
        const agent = this.data.agents.get(agentName);
        this.data.onSaveAgent(agentName, { enabled: agent?.enabled === false ? true : false });
      };
      const recommend = () => {
        const agentName = this.currentAgentName();
        if (!agentName) return;
        this.data.onRecommendModel(agentName);
      };
      const pull = () => {
        const agentName = this.currentAgentName();
        if (!agentName) return;
        this.data.onPullModel(agentName);
      };
      screen.key('escape', back);
      screen.key('g', generate);
      screen.key('u', syncAll);
      screen.key('t', toggleEnabled);
      screen.key('r', recommend);
      screen.key('p', pull);
      this.widgets.push({
        destroy: () => {
          screen.unkey('escape', back);
          screen.unkey('g', generate);
          screen.unkey('u', syncAll);
          screen.unkey('t', toggleEnabled);
          screen.unkey('r', recommend);
          screen.unkey('p', pull);
        },
      });
    }

    list.focus();
    this.parent.screen?.render();
  }

  private currentAgentName(): string | undefined {
    const index = (this.list as (blessed.Widgets.ListElement & { selected?: number }) | null)?.selected ?? 0;
    return this.names[index];
  }
}

function formatAgentListLabel(name: string, agent: AgentDefinition): string {
  return `${name} [${agent.adapter}${agent.model ? `/${agent.model}` : ''}]`;
}

function buildDetail(agent: AgentDefinition, installedOllamaModels: string[]): string {
  const installed =
    agent.adapter === 'ollama' && agent.model
      ? installedOllamaModels.includes(agent.model)
        ? 'installed'
        : 'missing'
      : 'n/a';

  return [
    `{bold}${agent.name}{/bold}`,
    '',
    `${fgTag(getTheme().colors.muted)}Provider:{/} ${agent.adapter}`,
    `${fgTag(getTheme().colors.muted)}Model:{/} ${agent.model ?? '-'}`,
    `${fgTag(getTheme().colors.muted)}Output:{/} ${agent.output.type}`,
    `${fgTag(getTheme().colors.muted)}Enabled:{/} ${agent.enabled === false ? 'no' : 'yes'}`,
    `${fgTag(getTheme().colors.muted)}Ollama model:{/} ${installed}`,
    '',
    `${fgTag(getTheme().colors.muted)}Handles:{/}`,
    agent.handles,
    '',
    `${fgTag(getTheme().colors.muted)}Pipeline:{/} ${agent.pipeline.map((step) => step.name).join(' -> ')}`,
    `${fgTag(getTheme().colors.muted)}Tools:{/} ${agent.tools.map((tool) => tool.type === 'builtin' ? tool.name : tool.uri).join(', ') || '(none)'}`,
    ...(agent.fallbacks && agent.fallbacks.length > 0
      ? ['', `${fgTag(getTheme().colors.muted)}Fallbacks:{/} ${agent.fallbacks.map((fb) => `${fb.adapter}${fb.model ? `/${fb.model}` : ''}`).join(', ')}`]
      : []),
    '',
    agent.description,
  ].join('\n');
}
