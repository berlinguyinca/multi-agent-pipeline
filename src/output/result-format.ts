import { stringify as stringifyYaml } from 'yaml';
import { getPreferredTerminalStepIds } from '../dag/final-step.js';
import { renderSimplifiedGraph } from '../dag/graph-renderer.js';
import type { DAGPlan } from '../types/dag.js';
import { normalizeScientificNotation } from '../utils/scientific-notation.js';

export type MapOutputFormat = 'json' | 'yaml' | 'markdown' | 'html' | 'text';

export interface FormatMapOutputOptions {
  compact?: boolean;
}

const OUTPUT_FORMATS = new Set<MapOutputFormat>(['json', 'yaml', 'markdown', 'html', 'text']);
const OUTPUT_FORMAT_LIST = 'json, yaml, markdown, html, text';

export function parseMapOutputFormat(value: string | undefined): MapOutputFormat {
  if (value === undefined) return 'json';
  const normalized = value.trim().toLowerCase();
  if (OUTPUT_FORMATS.has(normalized as MapOutputFormat)) {
    return normalized as MapOutputFormat;
  }
  throw new Error(`--output-format must be one of: ${OUTPUT_FORMAT_LIST}`);
}

export function formatMapOutput(
  result: unknown,
  format: MapOutputFormat,
  options: FormatMapOutputOptions = {},
): string {
  const normalizedResult = format === 'html' ? result : normalizeResultScientificNotation(result);
  const data = options.compact ? buildCompactData(normalizedResult) : normalizedResult;
  switch (format) {
    case 'json':
      return `${JSON.stringify(data, null, 2)}\n`;
    case 'yaml':
      return stringifyYaml(data);
    case 'markdown':
      return options.compact ? formatCompactMarkdownResult(normalizedResult) : formatMarkdownResult(normalizedResult);
    case 'html':
      return options.compact ? formatCompactHtmlResult(result) : formatHtmlResult(result);
    case 'text':
      return options.compact ? formatCompactTextResult(normalizedResult) : formatTextResult(normalizedResult);
  }
}


function normalizeResultScientificNotation(value: unknown): unknown {
  if (typeof value === 'string') return normalizeScientificNotation(value);
  if (Array.isArray(value)) return value.map(normalizeResultScientificNotation);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeResultScientificNotation(entry)]),
    );
  }
  return value;
}

export function formatCompactMapOutput(result: unknown): string {
  return formatCompactMarkdownResult(result);
}

function buildCompactData(result: unknown): Record<string, unknown> {
  const data = isRecord(result) ? result : { result };
  return {
    ...(data['success'] !== undefined ? { success: data['success'] } : {}),
    ...(data['outcome'] !== undefined ? { outcome: data['outcome'] } : {}),
    agentGraph: buildSimplifiedGraph(data),
    finalResult: extractFinalResult(data) ?? '',
    ...buildErrorData(data),
  };
}


function buildErrorData(data: Record<string, unknown>): { errors?: string[] } {
  const errors = collectErrors(data);
  return errors.length > 0 ? { errors } : {};
}

function collectErrors(data: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (typeof data['error'] === 'string' && data['error'].trim()) {
    errors.push(data['error'].trim());
  }

  const steps = Array.isArray(data['steps']) ? data['steps'].filter(isRecord) : [];
  for (const step of steps) {
    const message = typeof step['error'] === 'string' && step['error'].trim()
      ? step['error'].trim()
      : typeof step['reason'] === 'string' && step['reason'].trim()
        ? step['reason'].trim()
        : '';
    if (!message) continue;
    errors.push(`${String(step['id'] ?? 'step')} [${String(step['agent'] ?? 'unknown')}]: ${message}`);
  }

  return [...new Set(errors)];
}

function appendErrors(lines: string[], data: Record<string, unknown>): void {
  const errors = collectErrors(data);
  if (errors.length === 0) return;
  lines.push('', '## Errors', '');
  for (const error of errors) {
    lines.push(`- ${error}`);
  }
}

function appendPlainErrors(lines: string[], data: Record<string, unknown>): void {
  const errors = collectErrors(data);
  if (errors.length === 0) return;
  lines.push('Errors', '------', ...errors.map((error) => `- ${error}`), '');
}

function renderHtmlErrors(data: Record<string, unknown>): string[] {
  const errors = collectErrors(data);
  if (errors.length === 0) return [];
  return ['<h2>Errors</h2>', `<ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul>`];
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

function formatCompactMarkdownResult(result: unknown): string {
  const data = isRecord(result) ? result : { result };
  const lines = ['# MAP Compact Result', ''];
  appendAgentGraph(lines, data);
  appendErrors(lines, data);
  appendFinalResult(lines, data);
  return `${lines.join('\n').trimEnd()}\n`;
}

function formatTextResult(result: unknown): string {
  const data = isRecord(result) ? result : { result };
  const lines = ['MAP Result', ''];
  appendSummary(lines, data);
  appendPlainGraph(lines, data);
  appendPlainErrors(lines, data);
  appendPlainFinalResult(lines, data);
  return `${lines.join('\n').trimEnd()}\n`;
}

function formatCompactTextResult(result: unknown): string {
  const data = isRecord(result) ? result : { result };
  const lines = ['MAP Compact Result', ''];
  appendPlainGraph(lines, data);
  appendPlainFinalResult(lines, data);
  return `${lines.join('\n').trimEnd()}\n`;
}

function formatHtmlResult(result: unknown): string {
  const data = isRecord(result) ? result : { result };
  return buildHtmlDocument('MAP Result', data, false, result);
}

function formatCompactHtmlResult(result: unknown): string {
  const data = isRecord(result) ? result : { result };
  return buildHtmlDocument('MAP Compact Result', data, true, result);
}

function buildHtmlDocument(
  title: string,
  data: Record<string, unknown>,
  compact: boolean,
  rawResult: unknown,
): string {
  const graph = buildSimplifiedGraph(data);
  const final = extractFinalResult(data) ?? '';
  const summary = [
    ['Version', data['version']],
    ['Success', data['success']],
    ['Outcome', data['outcome']],
    ['Output directory', data['outputDir']],
    ['Duration', formatDuration(data['duration'])],
    ['Error', data['error']],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');
  const steps = Array.isArray(data['steps']) ? data['steps'].filter(isRecord) : [];

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    '<style>body{font-family:system-ui,sans-serif;line-height:1.5;margin:2rem;max-width:1100px}pre{white-space:pre-wrap;background:#f6f8fa;padding:1rem;border-radius:6px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4rem;text-align:left}code{background:#f6f8fa;padding:.1rem .2rem}</style>',
    '</head>',
    '<body>',
    `<h1>${escapeHtml(title)}</h1>`,
    ...(compact ? [] : ['<h2>Summary</h2>', '<ul>', ...summary.map(([label, value]) => `<li><strong>${escapeHtml(String(label))}:</strong> ${escapeHtml(String(value))}</li>`), '</ul>']),
    '<h2>Agent Graph</h2>',
    graph.length > 0 ? `<ul>${graph.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : '<p>No graph available.</p>',
    ...renderHtmlErrors(data),
    ...(compact || steps.length === 0 ? [] : ['<h2>Steps</h2>', renderHtmlStepTable(steps)]),
    '<h2>Final Result</h2>',
    `<pre>${escapeHtml(final || 'No final result captured.')}</pre>`,
    ...(compact ? [] : ['<h2>Result Data</h2>', `<pre>${escapeHtml(JSON.stringify(rawResult, null, 2))}</pre>`]),
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function renderHtmlStepTable(steps: Record<string, unknown>[]): string {
  const rows = steps.map((step) => [
    step['id'],
    step['agent'],
    step['status'],
    formatHandoff(step),
    formatSpecConformance(step),
    step['task'],
  ]);
  return [
    '<table>',
    '<thead><tr><th>Step</th><th>Agent</th><th>Status</th><th>Handoff</th><th>Spec</th><th>Task</th></tr></thead>',
    '<tbody>',
    ...rows.map((row) => `<tr>${row.map((cellValue) => `<td>${escapeHtml(String(cellValue ?? ''))}</td>`).join('')}</tr>`),
    '</tbody>',
    '</table>',
  ].join('\n');
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

function appendPlainGraph(lines: string[], data: Record<string, unknown>): void {
  const graph = buildSimplifiedGraph(data);
  if (graph.length === 0) return;

  lines.push('Agent Graph', '-----------');
  lines.push(...graph.map((line) => `- ${line}`), '');
}

function appendSteps(lines: string[], data: Record<string, unknown>): void {
  const steps = Array.isArray(data['steps']) ? data['steps'].filter(isRecord) : [];
  if (steps.length === 0) return;

  lines.push('', '## Steps', '', '| Step | Agent | Status | Handoff | Spec | Task |', '| --- | --- | --- | --- | --- | --- |');
  for (const step of steps) {
    lines.push(
      `| ${cell(step['id'])} | ${cell(step['agent'])} | ${cell(step['status'])} | ${cell(formatHandoff(step))} | ${cell(formatSpecConformance(step))} | ${cell(step['task'])} |`,
    );
  }
}

function formatHandoff(step: Record<string, unknown>): string {
  if (step['handoffPassed'] === true) return 'pass';
  if (step['handoffPassed'] === false) return 'fail';
  return 'not checked';
}

function formatSpecConformance(step: Record<string, unknown>): string {
  const conformance = isRecord(step['specConformance']) ? step['specConformance'] : undefined;
  if (!conformance || conformance['checked'] !== true) return 'not checked';
  return conformance['passed'] === true ? 'pass' : 'missing criteria';
}

function appendFinalResult(lines: string[], data: Record<string, unknown>): void {
  const final = extractFinalResult(data);
  if (!final) return;
  lines.push('', '## Final Result', '', final);
}

function appendPlainFinalResult(lines: string[], data: Record<string, unknown>): void {
  const final = extractFinalResult(data);
  if (!final) return;
  lines.push('Final Result', '------------', final, '');
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
  if (nodes.length > 0) {
    return renderSimplifiedGraph({
      nodes: nodes.map((node) => ({
        id: String(node['id'] ?? ''),
        agent: String(node['agent'] ?? ''),
        status: String(node['status'] ?? ''),
        duration: typeof node['duration'] === 'number' ? node['duration'] : 0,
        ...(node['final'] === true ? { final: true } : {}),
      })),
      edges: edges.map((edge) => ({
        from: String(edge['from'] ?? ''),
        to: String(edge['to'] ?? ''),
        type: edge['type'] === 'handoff' || edge['type'] === 'recovery' || edge['type'] === 'spawned'
          ? edge['type']
          : 'planned',
      })),
    });
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
  const terminalIds = getPreferredTerminalStepIds(toDagPlan(data));

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]!;
    if (terminalIds.size > 0 && !terminalIds.has(String(step['id'] ?? ''))) continue;
    if (step['status'] !== 'completed' && step['status'] !== 'recovered') continue;
    const output = typeof step['output'] === 'string' ? step['output'].trim() : '';
    if (output) return output;
  }

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

function toDagPlan(data: Record<string, unknown>): DAGPlan {
  const dag = isRecord(data['dag']) ? data['dag'] : undefined;
  const nodes = Array.isArray(dag?.['nodes']) ? dag['nodes'].filter(isRecord) : [];
  const edges = Array.isArray(dag?.['edges']) ? dag['edges'].filter(isRecord) : [];
  return {
    plan: nodes.map((node) => {
      const id = String(node['id'] ?? '');
      return {
        id,
        agent: String(node['agent'] ?? ''),
        task: '',
        dependsOn: edges
          .filter((edge) => String(edge['to'] ?? '') === id)
          .map((edge) => String(edge['from'] ?? '')),
        ...(node['final'] === true ? { final: true } : {}),
      };
    }),
  };
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
