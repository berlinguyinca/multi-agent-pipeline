import type { ConsensusParticipant, DAGEdge, DAGEdgeType, DAGNode, DAGResult } from '../types/dag.js';

export type DAGRenderLayout = 'auto' | 'stage' | 'metro' | 'matrix' | 'cluster';
export type ResolvedDAGRenderLayout = Exclude<DAGRenderLayout, 'auto'>;
export const DAG_RENDER_LAYOUTS: DAGRenderLayout[] = ['auto', 'stage', 'metro', 'matrix', 'cluster'];
export const LARGE_DAG_MATRIX_THRESHOLD = 12;

const EDGE_LABELS: Record<DAGEdgeType, string> = {
  planned: '->',
  handoff: '--handoff-->',
  recovery: '--recovery-->',
  spawned: '--spawned-->',
};

export interface DAGLayoutNode {
  node: DAGNode;
  inputs: string[];
  layerIndex: number;
}

export interface DAGLayoutLayer {
  index: number;
  mode: 'sequence' | 'concurrent';
  nodes: DAGLayoutNode[];
}

export interface DAGLayout {
  layers: DAGLayoutLayer[];
  edges: DAGEdge[];
}

export function renderSimplifiedGraph(dag: DAGResult): string[] {
  const layout = buildDAGLayout(dag);
  if (layout.layers.length === 0) return [];

  const lines: string[] = [];
  for (const layer of layout.layers) {
    lines.push(`Stage ${layer.index + 1} (${layer.mode}):`);
    for (const entry of layer.nodes) {
      lines.push(`- ${formatNodeWithMetadata(entry.node, entry.inputs)}`);
    }
  }

  if (layout.edges.length > 0) {
    lines.push('Connections:');
    for (const edge of layout.edges) {
      const arrow = EDGE_LABELS[edge.type] ?? '->';
      const connection = edge.type === 'planned'
        ? `${edge.from} ${arrow} ${edge.to} (${edge.type})`
        : `${edge.from} ${arrow} ${edge.to}`;
      lines.push(`- ${connection}`);
    }
  }

  return lines;
}

export function shouldUseMatrixLayout(dag: DAGResult): boolean {
  return dag.nodes.length >= LARGE_DAG_MATRIX_THRESHOLD;
}

export function resolveDAGRenderLayout(
  dag: DAGResult,
  requested: DAGRenderLayout = 'auto',
): ResolvedDAGRenderLayout {
  if (requested === 'auto') return shouldUseMatrixLayout(dag) ? 'matrix' : 'stage';
  return requested;
}

export function buildDAGLayout(dag: DAGResult): DAGLayout {
  const nodes = dag.nodes.filter((node) => node.id.trim().length > 0);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = dag.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  if (nodes.length === 0) return { layers: [], edges };

  const inputs = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const rank = new Map<string, number>();

  for (const node of nodes) {
    inputs.set(node.id, []);
    outgoing.set(node.id, []);
    inDegree.set(node.id, 0);
    rank.set(node.id, 0);
  }

  for (const edge of edges) {
    inputs.get(edge.to)?.push(edge.from);
    outgoing.get(edge.from)?.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const queue = nodes.filter((node) => (inDegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  const visited = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift()!;
    visited.add(id);
    const currentRank = rank.get(id) ?? 0;
    for (const child of outgoing.get(id) ?? []) {
      rank.set(child, Math.max(rank.get(child) ?? 0, currentRank + 1));
      const nextDegree = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, nextDegree);
      if (nextDegree === 0) queue.push(child);
    }
  }

  // Cycles should be rejected before execution, but runtime graph mutations can be imperfect.
  // Keep every node visible by assigning unvisited nodes to a best-effort later layer.
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    const parentRanks = (inputs.get(node.id) ?? []).map((parent) => rank.get(parent) ?? 0);
    rank.set(node.id, parentRanks.length > 0 ? Math.max(...parentRanks) + 1 : 0);
  }

  const groups = new Map<number, DAGLayoutNode[]>();
  for (const node of nodes) {
    const layerIndex = rank.get(node.id) ?? 0;
    const group = groups.get(layerIndex) ?? [];
    group.push({ node, inputs: inputs.get(node.id) ?? [], layerIndex });
    groups.set(layerIndex, group);
  }

  const layers = [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, entries]) => ({
      index,
      mode: entries.length > 1 ? 'concurrent' as const : 'sequence' as const,
      nodes: entries,
    }));

  return { layers, edges };
}

function formatNodeWithMetadata(node: DAGNode, inputs: string[]): string {
  const head = node.status ? `${formatNode(node.id, node.agent)} ${node.status}` : formatNode(node.id, node.agent);
  const parts = [head];
  const runtime = formatNodeRuntime(node);
  if (runtime) parts.push(runtime);
  if (inputs.length > 0) parts.push(`inputs: ${inputs.join(', ')}`);
  const consensus = formatConsensusSummary(node.consensus);
  if (consensus) parts.push(consensus);
  return parts.join(' | ');
}

function formatNode(id: string, agent?: string): string {
  return agent ? `${id} [${agent}]` : id;
}

export function formatNodeRuntime(node: Pick<DAGNode, 'provider' | 'model'>): string {
  if (node.provider && node.model) return `${node.provider}/${node.model}`;
  return node.provider ?? node.model ?? '';
}

export function formatConsensusSummary(consensus: DAGNode['consensus']): string {
  if (!consensus) return '';
  const participants = consensus.participants?.map(formatConsensusParticipant).join('; ') ?? '';
  return `consensus ${consensus.runs}x ${consensus.method}${participants ? `: ${participants}` : ''}`;
}

export function formatConsensusHeadline(consensus: DAGNode['consensus']): string {
  if (!consensus) return '';
  return `${consensus.runs}x ${consensus.method}`;
}

export function formatConsensusParticipant(participant: ConsensusParticipant): string {
  return `${formatParticipantModel(participant)} r${participant.run} ${participant.status} ${formatPercent(participant.contribution)}`;
}

function formatParticipantModel(participant: { provider?: string; model?: string }): string {
  if (participant.provider && participant.model) return `${participant.provider}/${participant.model}`;
  return participant.model ?? participant.provider ?? 'unknown';
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  return `${Math.round(value * 100)}%`;
}
