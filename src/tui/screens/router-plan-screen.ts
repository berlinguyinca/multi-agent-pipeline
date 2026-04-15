import blessed from 'neo-blessed';
import { BaseScreen } from './base-screen.js';
import type { DAGPlan, DAGStep } from '../../types/dag.js';
import type { AgentDefinition } from '../../types/agent-definition.js';
import { getTheme, fgTag } from '../theme.js';
import { normalizeTerminalText, truncateText, wrapText } from '../../utils/terminal-text.js';
import { topologicalSort } from '../../types/dag.js';

export interface RouterPlanScreenData {
  plan: DAGPlan;
  agentDetails?: Record<string, Pick<AgentDefinition, 'adapter' | 'model'>>;
  onApprove: () => void;
  onCancel: () => void;
}

export class RouterPlanScreen extends BaseScreen {
  private data: RouterPlanScreenData;
  private titleBox: blessed.Widgets.BoxElement | null = null;
  private separatorBox: blessed.Widgets.BoxElement | null = null;
  private summaryBox: blessed.Widgets.BoxElement | null = null;
  private planBox: blessed.Widgets.BoxElement | null = null;
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

  resize(): void {
    this.deactivate();
    this.activate();
  }

  refreshTheme(): void {
    const theme = getTheme();
    for (const box of [this.titleBox, this.separatorBox, this.summaryBox, this.planBox, this.hintBox]) {
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
    const theme = getTheme();
    const width = Math.max(40, Number(this.parent.screen?.width ?? 80) - 4);
    const layers = buildLayers(this.data.plan);
    const uniqueAgents = [...new Set(this.data.plan.plan.map((step) => step.agent))];
    const dependencyCount = this.data.plan.plan.reduce((count, step) => count + step.dependsOn.length, 0);

    const title = blessed.box({
      parent: this.parent,
      top: 0,
      tags: true,
      height: 1,
      shrink: true,
      content: `{bold}${fgTag(theme.colors.accent)}  Pipeline Plan{/}{/bold}`,
      style: {
        fg: theme.colors.panelFg,
        bg: theme.colors.panelBg,
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
      content: `${fgTag(theme.colors.muted)}  ────────────────────────────────────────{/}`,
    });
    this.separatorBox = separator;
    this.widgets.push({ destroy: () => separator.destroy() });

    const summary = blessed.box({
      parent: this.parent,
      top: 2,
      left: 1,
      right: 1,
      height: 2,
      tags: true,
      shrink: true,
      content: buildSummaryLine({
        steps: this.data.plan.plan.length,
        layers: layers.length,
        agents: uniqueAgents,
        dependencies: dependencyCount,
        width,
        theme,
        agentDetails: this.data.agentDetails ?? {},
      }),
      style: {
        fg: theme.colors.panelFg,
        bg: theme.colors.panelBg,
      },
    });
    this.summaryBox = summary;
    this.widgets.push({ destroy: () => summary.destroy() });

    const planBox = blessed.box({
      parent: this.parent,
      top: 4,
      left: 1,
      right: 1,
      bottom: 2,
      tags: false,
      wrap: true,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: false,
      scrollbar: {
        ch: '│',
        style: { fg: theme.colors.accent },
        track: { bg: theme.colors.scrollbarTrack },
      },
      style: {
        fg: theme.colors.panelFg,
        bg: theme.colors.panelBg,
      },
      content: buildPlanContent(this.data.plan, layers, width, this.data.agentDetails ?? {}),
    });
    this.planBox = planBox;
    this.widgets.push({ destroy: () => planBox.destroy() });

    const hint = blessed.box({
      parent: this.parent,
      bottom: 0,
      left: 1,
      right: 1,
      tags: true,
      height: 1,
      shrink: true,
      content: `${fgTag(theme.colors.muted)}Enter: Execute  |  Esc: Cancel{/}`,
      style: {
        fg: theme.colors.panelFg,
        bg: theme.colors.panelBg,
      },
    });
    this.hintBox = hint;
    this.widgets.push({ destroy: () => hint.destroy() });

    const screen = this.parent.screen;
    if (screen) {
      const enterHandler = () => { this.data.onApprove(); };
      const escHandler = () => { this.data.onCancel(); };
      screen.key('enter', enterHandler);
      screen.key('escape', escHandler);
      this.widgets.push({
        destroy: () => {
          screen.unkey('enter', enterHandler);
          screen.unkey('escape', escHandler);
        },
      });
    }

    this.parent.screen?.render();
  }
}

interface SummaryLineOptions {
  steps: number;
  layers: number;
  agents: string[];
  dependencies: number;
  width: number;
  theme: ReturnType<typeof getTheme>;
  agentDetails: Record<string, Pick<AgentDefinition, 'adapter' | 'model'>>;
}

function buildSummaryLine(options: SummaryLineOptions): string {
  const agentList =
    options.agents.length > 0
      ? options.agents
          .map((agent) => {
            const details = options.agentDetails[agent];
            return details
              ? `${agent} (${details.adapter}${details.model ? `/${details.model}` : ''})`
              : agent;
          })
          .join(', ')
      : 'none';
  const line1 = `Steps: ${options.steps} | Layers: ${options.layers} | Dependencies: ${options.dependencies}`;
  const line2 = `Agents: ${agentList}`;
  return [
    `{bold}${truncateText(line1, options.width)}{/bold}`,
    `${fgTag(options.theme.colors.muted)}${truncateText(line2, options.width)}{/}`,
  ].join('\n');
}

function buildPlanContent(
  plan: DAGPlan,
  layers: DAGStep[][],
  width: number,
  agentDetails: Record<string, Pick<AgentDefinition, 'adapter' | 'model'>>,
): string {
  const cardWidth = Math.max(24, width - 2);
  const stepMap = new Map(plan.plan.map((step) => [step.id, step]));
  const lines: string[] = [];

  const edges = plan.plan.flatMap((step) =>
    step.dependsOn.map((dep) => ({
      from: dep,
      fromAgent: stepMap.get(dep)?.agent ?? '?',
      to: step.id,
      toAgent: step.agent,
    })),
  );

  lines.push('Connections');
  lines.push('');
  if (edges.length === 0) {
    lines.push('  none');
  } else {
    for (const edge of edges) {
      const edgeLine = truncateText(
        `${edge.from} [${formatAgentLabel(edge.fromAgent, agentDetails)}] ─▶ ${edge.to} [${formatAgentLabel(edge.toAgent, agentDetails)}]`,
        cardWidth,
      );
      lines.push(`  ${edgeLine}`);
    }
  }
  lines.push('');

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = layers[layerIndex]!;
    if (layerIndex > 0) {
      lines.push('');
    }

    lines.push(`Layer ${layerIndex + 1}${layer.length > 1 ? ` (${layer.length} parallel)` : ''}`);
    lines.push('');

    for (const step of layer) {
      lines.push(`  ${truncateText(`${step.id}  [${formatAgentLabel(step.agent, agentDetails)}]`, cardWidth)}`);
      lines.push(...renderWrappedLine(step.task, cardWidth, '    '));

      if (step.dependsOn.length > 0) {
        lines.push(...renderWrappedLine(`depends on: ${step.dependsOn.join(', ')}`, cardWidth, '    '));
      } else {
        lines.push('    ready to start');
      }

      lines.push('');
    }
  }

  return lines.join('\n').trim();
}

function formatAgentLabel(
  agentName: string,
  agentDetails: Record<string, Pick<AgentDefinition, 'adapter' | 'model'>>,
): string {
  const details = agentDetails[agentName];
  return details
    ? `${agentName} | ${details.adapter}${details.model ? `/${details.model}` : ''}`
    : agentName;
}

function renderWrappedLine(text: string, width: number, indent: string): string[] {
  const wrapped = wrapText(normalizeTerminalText(text), Math.max(1, width - indent.length), indent);
  return wrapped.split('\n').map((line) => line.trimEnd());
}

function buildLayers(plan: DAGPlan): DAGStep[][] {
  const sorted = topologicalSort(plan);
  const depth = new Map<string, number>();
  const stepMap = new Map(plan.plan.map((step) => [step.id, step]));

  function getDepth(stepId: string): number {
    const cached = depth.get(stepId);
    if (cached !== undefined) return cached;

    const step = stepMap.get(stepId);
    if (!step || step.dependsOn.length === 0) {
      depth.set(stepId, 0);
      return 0;
    }

    const value = Math.max(...step.dependsOn.map((dep) => getDepth(dep))) + 1;
    depth.set(stepId, value);
    return value;
  }

  const layers: DAGStep[][] = [];
  for (const step of sorted) {
    const level = getDepth(step.id);
    if (!layers[level]) {
      layers[level] = [];
    }
    layers[level].push(step);
  }

  return layers.filter((layer): layer is DAGStep[] => Boolean(layer));
}
