import { stringify as stringifyYaml } from 'yaml';

export type MapOutputFormat = 'json' | 'yaml' | 'markdown';

const OUTPUT_FORMATS = new Set<MapOutputFormat>(['json', 'yaml', 'markdown']);

export function parseMapOutputFormat(value: string | undefined): MapOutputFormat {
  if (value === undefined) return 'json';
  const normalized = value.trim().toLowerCase();
  if (OUTPUT_FORMATS.has(normalized as MapOutputFormat)) {
    return normalized as MapOutputFormat;
  }
  throw new Error('--output-format must be one of: json, yaml, markdown');
}

export function formatMapOutput(result: unknown, format: MapOutputFormat): string {
  switch (format) {
    case 'json':
      return `${JSON.stringify(result, null, 2)}\n`;
    case 'yaml':
      return stringifyYaml(result);
    case 'markdown':
      return formatMarkdownResult(result);
  }
}

export function formatCompactMapOutput(result: unknown): string {
  const data = isRecord(result) ? result : { result };
  const lines = ['# MAP Compact Result', ''];
  appendAgentGraph(lines, data);
  appendFinalResult(lines, data);
  return `${lines.join('\n').trimEnd()}\n`;
}

function formatMarkdownResult(result: unknown): string {
  const data = isRecord(result) ? result : { result };
  const lines = ['# MAP Result', ''];

  appendSummary(lines, data);
  appendAgentGraph(lines, data);
  appendSteps(lines, data);
  appendFinalResult(lines, data);
  appendList(lines, 'Files Created', asStringArray(data['filesCreated']));
  appendList(lines, 'Markdown Files', asStringArray(data['markdownFiles']));

  lines.push('', '## Result Data', '', '```json', JSON.stringify(result, null, 2), '```');
  return `${lines.join('\n').trimEnd()}\n`;
}

function appendSummary(lines: string[], data: Record<string, unknown>): void {
  lines.push('## Summary', '');
  appendField(lines, 'Version', data['version']);
  appendField(lines, 'Success', data['success']);
  appendField(lines, 'Outcome', data['outcome']);
  appendField(lines, 'Output directory', data['outputDir']);
  appendField(lines, 'Duration', formatDuration(data['duration']));
  appendField(lines, 'Error', data['error']);

  if (lines.at(-1) === '') {
    lines.push('- Result: see data below');
  }
}

function appendAgentGraph(lines: string[], data: Record<string, unknown>): void {
  const graph = buildSimplifiedGraph(data);
  if (graph.length === 0) return;

  lines.push('', '## Agent Graph', '');
  for (const line of graph) {
    lines.push(`- ${line}`);
  }
}

function appendSteps(lines: string[], data: Record<string, unknown>): void {
  const steps = Array.isArray(data['steps']) ? data['steps'].filter(isRecord) : [];
  if (steps.length === 0) return;

  lines.push('', '## Steps', '', '| Step | Agent | Status | Task |', '| --- | --- | --- | --- |');
  for (const step of steps) {
    lines.push(
      `| ${cell(step['id'])} | ${cell(step['agent'])} | ${cell(step['status'])} | ${cell(step['task'])} |`,
    );
  }
}

function appendFinalResult(lines: string[], data: Record<string, unknown>): void {
  const final = extractFinalResult(data);
  if (!final) return;
  lines.push('', '## Final Result', '', final);
}

function appendList(lines: string[], title: string, items: string[] | undefined): void {
  if (!items || items.length === 0) return;
  lines.push('', `## ${title}`, '');
  for (const item of items) {
    lines.push(`- ${item}`);
  }
}

function appendField(lines: string[], label: string, value: unknown): void {
  if (value === undefined || value === null || value === '') return;
  lines.push(`- ${label}: ${String(value)}`);
}

function buildSimplifiedGraph(data: Record<string, unknown>): string[] {
  const dag = isRecord(data['dag']) ? data['dag'] : undefined;
  const nodes = Array.isArray(dag?.['nodes']) ? dag['nodes'].filter(isRecord) : [];
  const edges = Array.isArray(dag?.['edges']) ? dag['edges'].filter(isRecord) : [];
  const labelById = new Map<string, string>();

  for (const node of nodes) {
    const id = String(node['id'] ?? '').trim();
    if (!id) continue;
    const agent = String(node['agent'] ?? '').trim();
    labelById.set(id, agent ? `${id} [${agent}]` : id);
  }

  if (edges.length > 0) {
    return edges.map((edge) => {
      const from = String(edge['from'] ?? '');
      const to = String(edge['to'] ?? '');
      return `${labelById.get(from) ?? from} -> ${labelById.get(to) ?? to}`;
    });
  }

  if (nodes.length > 0) {
    return nodes.map((node) => labelById.get(String(node['id'] ?? '')) ?? String(node['id'] ?? ''));
  }

  const steps = Array.isArray(data['steps']) ? data['steps'].filter(isRecord) : [];
  if (steps.length === 0) return [];
  return [steps.map((step) => {
    const id = String(step['id'] ?? '').trim();
    const agent = String(step['agent'] ?? '').trim();
    return agent ? `${id} [${agent}]` : id;
  }).join(' -> ')];
}

function extractFinalResult(data: Record<string, unknown>): string | null {
  const steps = Array.isArray(data['steps']) ? data['steps'].filter(isRecord) : [];
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]!;
    if (step['status'] !== 'completed' && step['status'] !== 'recovered') continue;
    const output = typeof step['output'] === 'string' ? step['output'].trim() : '';
    if (output) return output;
  }

  const documentationResult = isRecord(data['documentationResult']) ? data['documentationResult'] : undefined;
  const rawOutput = documentationResult?.['rawOutput'];
  if (typeof rawOutput === 'string' && rawOutput.trim()) return rawOutput.trim();

  const spec = data['spec'];
  if (typeof spec === 'string' && spec.trim()) return spec.trim();

  const result = data['result'];
  if (typeof result === 'string' && result.trim()) return result.trim();

  return null;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => String(item));
}

function formatDuration(value: unknown): string | undefined {
  if (typeof value !== 'number') return undefined;
  if (value >= 3_600_000) return `${(value / 3_600_000).toFixed(2)}h`;
  if (value >= 60_000) return `${(value / 60_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}s`;
  return `${value}ms`;
}

function cell(value: unknown): string {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
