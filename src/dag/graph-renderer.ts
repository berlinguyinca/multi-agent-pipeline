import type { DAGEdgeType, DAGResult } from '../types/dag.js';

const EDGE_LABELS: Record<DAGEdgeType, string> = {
  planned: '->',
  handoff: '--handoff-->',
  recovery: '--recovery-->',
  spawned: '--spawned-->',
};

export function renderSimplifiedGraph(dag: DAGResult): string[] {
  const labelById = new Map(dag.nodes.map((node) => [node.id, formatNode(node.id, node.agent)]));

  if (dag.edges.length === 0) {
    return dag.nodes.map((node) => labelById.get(node.id) ?? formatNode(node.id, node.agent));
  }

  return dag.edges.map((edge) => {
    const from = labelById.get(edge.from) ?? edge.from;
    const to = labelById.get(edge.to) ?? edge.to;
    return `${from} ${EDGE_LABELS[edge.type] ?? '->'} ${to}`;
  });
}

function formatNode(id: string, agent?: string): string {
  return agent ? `${id} [${agent}]` : id;
}
