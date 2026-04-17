import { stringify as stringifyYaml } from 'yaml';
import { marked } from 'marked';
import { getPreferredTerminalStepIds } from '../dag/final-step.js';
import { renderSimplifiedGraph } from '../dag/graph-renderer.js';
import type { DAGPlan } from '../types/dag.js';
import { normalizeScientificNotation } from '../utils/scientific-notation.js';

export type MapOutputFormat = 'json' | 'yaml' | 'markdown' | 'html' | 'text' | 'pdf';

export interface FormatMapOutputOptions {
  compact?: boolean;
}

const OUTPUT_FORMATS = new Set<MapOutputFormat>(['json', 'yaml', 'markdown', 'html', 'text', 'pdf']);
const OUTPUT_FORMAT_LIST = 'json, yaml, markdown, html, text, pdf';

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
    case 'pdf':
      return options.compact ? formatCompactHtmlResult(result) : formatHtmlResult(result);
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
  const consensusDiagnostics = collectConsensusDiagnostics(data);
  return {
    ...(data['success'] !== undefined ? { success: data['success'] } : {}),
    ...(data['outcome'] !== undefined ? { outcome: data['outcome'] } : {}),
    agentGraph: buildSimplifiedGraph(data),
    ...(consensusDiagnostics.length > 0 ? { consensusDiagnostics } : {}),
    finalResult: extractDisplayFinalResult(data) ?? '',
    ...buildErrorData(data),
    ...buildWarningData(data),
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


function buildWarningData(data: Record<string, unknown>): { warnings?: string[] } {
  const warnings = collectWarnings(data);
  return warnings.length > 0 ? { warnings } : {};
}

function collectWarnings(data: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  const steps = Array.isArray(data['steps']) ? data['steps'].filter(isRecord) : [];
  for (const step of steps) {
    const findings = Array.isArray(step['handoffFindings']) ? step['handoffFindings'].filter(isRecord) : [];
    for (const finding of findings) {
      if (finding['severity'] === 'high') continue;
      const message = typeof finding['message'] === 'string' ? finding['message'].trim() : '';
      if (!message) continue;
      warnings.push(`${String(step['id'] ?? 'step')} [${String(step['agent'] ?? 'unknown')}]: ${message}`);
    }
  }
  return [...new Set(warnings)];
}

function appendWarnings(lines: string[], data: Record<string, unknown>): void {
  const warnings = collectWarnings(data);
  if (warnings.length === 0) return;
  lines.push('', '## Warnings', '');
  for (const warning of warnings) {
    lines.push(`- ${warning}`);
  }
}

function appendPlainWarnings(lines: string[], data: Record<string, unknown>): void {
  const warnings = collectWarnings(data);
  if (warnings.length === 0) return;
  lines.push('Warnings', '--------', ...warnings.map((warning) => `- ${warning}`), '');
}

function renderHtmlWarnings(data: Record<string, unknown>): string[] {
  const warnings = collectWarnings(data);
  if (warnings.length === 0) return [];
  return ['<h2>Warnings</h2>', `<ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`];
}

function formatMarkdownResult(result: unknown): string {
  const data = isRecord(result) ? result : { result };
  const lines = ['# MAP Result', ''];

  appendSummary(lines, data);
  appendAgentGraph(lines, data);
  appendConsensusDiagnostics(lines, data);
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
  appendFinalResult(lines, data);
  appendErrors(lines, data);
  appendWarnings(lines, data);
  appendAgentGraph(lines, data);
  appendCompactConsensusDiagnostics(lines, data);
  return `${lines.join('\n').trimEnd()}\n`;
}

function formatTextResult(result: unknown): string {
  const data = isRecord(result) ? result : { result };
  const lines = ['MAP Result', ''];
  appendSummary(lines, data);
  appendPlainFinalResult(lines, data);
  appendPlainErrors(lines, data);
  appendPlainWarnings(lines, data);
  appendPlainGraph(lines, data);
  appendPlainConsensusDiagnostics(lines, data);
  return `${lines.join('\n').trimEnd()}\n`;
}

function formatCompactTextResult(result: unknown): string {
  const data = isRecord(result) ? result : { result };
  const lines = ['MAP Compact Result', ''];
  appendPlainFinalResult(lines, data);
  appendPlainGraph(lines, data);
  appendPlainConsensusDiagnostics(lines, data);
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
  const final = extractDisplayFinalResult(data) ?? '';
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
    '<style>body{font-family:system-ui,sans-serif;line-height:1.5;margin:2rem;max-width:1100px}pre{white-space:pre-wrap;background:#f6f8fa;padding:1rem;border-radius:6px}table{border-collapse:collapse;width:100%;margin:.75rem 0 1rem}td,th{border:1px solid #ddd;padding:.4rem;text-align:left}th{background:#f8fafc}code{background:#f6f8fa;padding:.1rem .2rem}.rendered-markdown{border:1px solid #dbe5f2;border-radius:14px;background:#fff;padding:1.1rem;box-shadow:0 8px 24px rgba(15,23,42,.06)}.rendered-markdown h1,.rendered-markdown h2,.rendered-markdown h3{color:#1f3658}.rendered-markdown h1{font-size:1.45rem}.rendered-markdown h2{font-size:1.18rem;border-bottom:1px solid #e2e8f0;padding-bottom:.25rem}.agent-network{margin:1rem 0 1.5rem;padding:1rem;border:1px solid #d8e2ee;border-radius:18px;background:radial-gradient(circle at 20% 10%,#ffffff 0,#eef6ff 38%,#f8fbff 100%);box-shadow:0 14px 36px rgba(30,64,175,.09)}.agent-flow{display:flex;flex-wrap:wrap;align-items:center;gap:.65rem}.agent-flow-step{display:flex;align-items:center;gap:.65rem}.agent-node{min-width:170px;max-width:230px;position:relative;padding:.85rem 1rem;border:1px solid #c5d6ea;border-radius:16px;background:linear-gradient(180deg,#fff,#f8fbff);box-shadow:0 8px 22px rgba(30,64,175,.11);break-inside:avoid}.agent-node:before{content:"";position:absolute;inset:0 auto 0 0;width:7px;border-radius:16px 0 0 16px;background:#64748b}.agent-node.completed:before,.agent-node.recovered:before{background:#22c55e}.agent-node.failed:before{background:#ef4444}.agent-node.skipped:before{background:#f59e0b}.agent-node.pending:before{background:#94a3b8}.agent-node-id{font-size:.72rem;color:#64748b;font-family:ui-monospace,monospace}.agent-node-name{font-weight:800;color:#1e293b;margin:.1rem 0}.agent-node-meta{font-size:.75rem;color:#475569}.flow-arrow{display:flex;align-items:center;gap:.15rem;color:#4877bd;font-weight:900}.flow-arrow-line{width:34px;border-top:3px solid #8db5ec}.flow-arrow-head{width:0;height:0;border-top:7px solid transparent;border-bottom:7px solid transparent;border-left:10px solid #8db5ec}.artifact-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem;margin:1rem 0 1.5rem}.artifact-figure{border:1px solid #d8e2ee;border-radius:16px;background:#fff;padding:.8rem;box-shadow:0 8px 24px rgba(15,23,42,.06);break-inside:avoid}.artifact-figure img{max-width:100%;height:auto;display:block}.artifact-figure figcaption{font-size:.8rem;color:#475569;margin-top:.5rem}.agent-network-edges{margin-top:1rem;display:grid;gap:.35rem}.agent-edge{font-family:ui-monospace,monospace;font-size:.78rem;color:#334155;background:rgba(255,255,255,.72);border:1px dashed #bfd0e4;border-radius:999px;padding:.25rem .55rem}</style>',
    '</head>',
    '<body>',
    `<h1>${escapeHtml(title)}</h1>`,
    ...(compact ? [] : ['<h2>Summary</h2>', '<ul>', ...summary.map(([label, value]) => `<li><strong>${escapeHtml(String(label))}:</strong> ${escapeHtml(String(value))}</li>`), '</ul>']),
    '<h2>Agent Graph</h2>',
    graph.length > 0 ? `<ul>${graph.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : '<p>No graph available.</p>',
    renderHtmlAgentNetwork(data),
    renderHtmlVisualArtifacts(data),
    ...renderHtmlConsensusDiagnostics(data),
    ...renderHtmlErrors(data),
    ...renderHtmlWarnings(data),
    ...(compact || steps.length === 0 ? [] : ['<h2>Steps</h2>', renderHtmlStepTable(steps)]),
    '<h2>Final Result</h2>',
    renderFinalResultHtml(final),
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

function renderFinalResultHtml(final: string): string {
  if (!final.trim()) return '<p>No final result captured.</p>';
  return `<article class="rendered-markdown">${marked.parse(escapeRawHtmlInMarkdown(final), { async: false }) as string}</article>`;
}

function escapeRawHtmlInMarkdown(markdown: string): string {
  return markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderHtmlVisualArtifacts(data: Record<string, unknown>): string {
  const artifacts = Array.isArray(data['artifacts']) ? data['artifacts'].filter(isRecord) : [];
  if (artifacts.length === 0) return '';

  const figures = artifacts
    .map((artifact) => {
      const src = typeof artifact['src'] === 'string' ? artifact['src'] : typeof artifact['path'] === 'string' ? artifact['path'] : '';
      if (!src) return '';
      const title = String(artifact['title'] ?? artifact['id'] ?? 'Visual artifact');
      const description = String(artifact['description'] ?? title);
      return [
        '<figure class="artifact-figure">',
        `<img src="${escapeHtml(src)}" alt="${escapeHtml(description)}">`,
        `<figcaption><strong>${escapeHtml(title)}</strong><br>${escapeHtml(description)}</figcaption>`,
        '</figure>',
      ].join('');
    })
    .filter(Boolean);

  if (figures.length === 0) return '';
  return ['<h2>Visual Artifacts</h2>', '<section class="artifact-gallery">', ...figures, '</section>'].join('');
}

function renderHtmlAgentNetwork(data: Record<string, unknown>): string {
  const dag = isRecord(data['dag']) ? data['dag'] : undefined;
  const nodes = Array.isArray(dag?.['nodes']) ? dag['nodes'].filter(isRecord) : [];
  const edges = Array.isArray(dag?.['edges']) ? dag['edges'].filter(isRecord) : [];
  if (nodes.length === 0) return '';

  const cards = nodes.flatMap((node, index) => {
    const id = String(node['id'] ?? '');
    const agent = String(node['agent'] ?? 'unknown');
    const status = String(node['status'] ?? 'pending').toLowerCase();
    const provider = String(node['provider'] ?? '').trim();
    const model = String(node['model'] ?? '').trim();
    const duration = formatDuration(node['duration']);
    const meta = [status, provider && model ? `${provider}/${model}` : provider || model, duration].filter(Boolean).join(' | ');

    const card = [
      '<div class="agent-flow-step">',
      `<article class="agent-node ${escapeHtml(status)}">`,
      `<div class="agent-node-id">${escapeHtml(id)}</div>`,
      `<div class="agent-node-name">${escapeHtml(agent)}</div>`,
      `<div class="agent-node-meta">${escapeHtml(meta)}</div>`,
      '</article>',
      index < nodes.length - 1
        ? '<div class="flow-arrow" aria-hidden="true"><span class="flow-arrow-line"></span><span class="flow-arrow-head"></span></div>'
        : '',
      '</div>',
    ].join('');
    return [card];
  });

  const edgeLines = edges
    .map((edge) => {
      const from = String(edge['from'] ?? '');
      const to = String(edge['to'] ?? '');
      const type = String(edge['type'] ?? 'planned');
      if (!from || !to) return '';
      return `<div class="agent-edge">${escapeHtml(`${from} -> ${to}`)} <span>(${escapeHtml(type)})</span></div>`;
    })
    .filter(Boolean);

  return [
    '<section class="agent-network" aria-label="Agent network visualization">',
    '<h3>Agent Network</h3>',
    '<div class="agent-flow">',
    ...cards,
    '</div>',
    ...(edgeLines.length > 0 ? ['<div class="agent-network-edges">', ...edgeLines, '</div>'] : []),
    '</section>',
  ].join('');
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

function appendConsensusDiagnostics(lines: string[], data: Record<string, unknown>): void {
  const diagnostics = collectConsensusDiagnostics(data);
  if (diagnostics.length === 0) return;
  lines.push(
    '',
    '## Consensus Diagnostics',
    '',
    '| Source | Agent | Method | Run | Model | Status | Contribution |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const diagnostic of diagnostics) {
    for (const participant of diagnostic.participants) {
      lines.push(
        `| ${cell(diagnostic.stepId ?? diagnostic.source)} | ${cell(diagnostic.agent ?? diagnostic.source)} | ${cell(diagnostic.method)} | ${cell(participant.run)} | ${cell(formatParticipantModel(participant))} | ${cell(participant.status)} | ${cell(formatPercent(participant.contribution))} |`,
      );
    }
  }
}

function appendCompactConsensusDiagnostics(lines: string[], data: Record<string, unknown>): void {
  const diagnostics = collectConsensusDiagnostics(data);
  if (diagnostics.length === 0) return;
  lines.push('', '## Consensus Diagnostics', '');
  for (const diagnostic of diagnostics) {
    const source = diagnostic.stepId
      ? `${diagnostic.stepId} [${diagnostic.agent ?? diagnostic.source}]`
      : diagnostic.source;
    const participantSummary = diagnostic.participants
      .map((participant) =>
        `${formatParticipantModel(participant)} run ${participant.run} ${participant.status} ${formatPercent(participant.contribution)}`,
      )
      .join('; ');
    lines.push(`- ${source} ${diagnostic.method}: ${participantSummary}`);
  }
}

function appendPlainConsensusDiagnostics(lines: string[], data: Record<string, unknown>): void {
  const diagnostics = collectConsensusDiagnostics(data);
  if (diagnostics.length === 0) return;
  lines.push('Consensus Diagnostics', '---------------------');
  for (const diagnostic of diagnostics) {
    const source = diagnostic.stepId
      ? `${diagnostic.stepId} [${diagnostic.agent ?? diagnostic.source}]`
      : diagnostic.source;
    lines.push(`${source} ${diagnostic.method}`);
    for (const participant of diagnostic.participants) {
      lines.push(`- ${formatParticipantModel(participant)} run ${participant.run}: ${participant.status} ${formatPercent(participant.contribution)}`);
    }
  }
  lines.push('');
}

function renderHtmlConsensusDiagnostics(data: Record<string, unknown>): string[] {
  const diagnostics = collectConsensusDiagnostics(data);
  if (diagnostics.length === 0) return [];
  const rows = diagnostics.flatMap((diagnostic) =>
    diagnostic.participants.map((participant) => [
      diagnostic.stepId ?? diagnostic.source,
      diagnostic.agent ?? diagnostic.source,
      diagnostic.method,
      participant.run,
      formatParticipantModel(participant),
      participant.status,
      formatPercent(participant.contribution),
    ]),
  );
  return [
    '<h2>Consensus Diagnostics</h2>',
    '<table>',
    '<thead><tr><th>Source</th><th>Agent</th><th>Method</th><th>Run</th><th>Model</th><th>Status</th><th>Contribution</th></tr></thead>',
    '<tbody>',
    ...rows.map((row) => `<tr>${row.map((cellValue) => `<td>${escapeHtml(String(cellValue ?? ''))}</td>`).join('')}</tr>`),
    '</tbody>',
    '</table>',
  ];
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
  const final = extractDisplayFinalResult(data);
  if (!final) return;
  lines.push('', '## Final Result', '', final);
}

function appendPlainFinalResult(lines: string[], data: Record<string, unknown>): void {
  const final = extractDisplayFinalResult(data);
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

function collectConsensusDiagnostics(data: Record<string, unknown>): Array<{
  source: string;
  stepId?: string;
  agent?: string;
  method: string;
  participants: Array<{
    run: number;
    provider?: string;
    model?: string;
    status: string;
    contribution: number;
  }>;
}> {
  const explicit = Array.isArray(data['consensusDiagnostics'])
    ? data['consensusDiagnostics'].filter(isRecord)
    : [];
  const explicitDiagnostics = explicit.map(normalizeConsensusDiagnostic).filter((entry): entry is NonNullable<ReturnType<typeof normalizeConsensusDiagnostic>> => entry !== null);

  const steps = Array.isArray(data['steps']) ? data['steps'].filter(isRecord) : [];
  const stepDiagnostics = steps
    .map((step) => {
      const consensus = isRecord(step['consensus']) ? step['consensus'] : undefined;
      if (!consensus) return null;
      const participants = Array.isArray(consensus['participants'])
        ? consensus['participants'].filter(isRecord).map(normalizeConsensusParticipant)
        : [];
      if (participants.length === 0) return null;
      return {
        source: 'agent',
        stepId: String(step['id'] ?? ''),
        agent: String(step['agent'] ?? ''),
        method: String(consensus['method'] ?? 'consensus'),
        participants,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const seen = new Set<string>();
  return [...explicitDiagnostics, ...stepDiagnostics].filter((diagnostic) => {
    const key = `${diagnostic.source}:${diagnostic.stepId ?? ''}:${diagnostic.method}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeConsensusDiagnostic(value: Record<string, unknown>): {
  source: string;
  stepId?: string;
  agent?: string;
  method: string;
  participants: Array<{
    run: number;
    provider?: string;
    model?: string;
    status: string;
    contribution: number;
  }>;
} | null {
  const participants = Array.isArray(value['participants'])
    ? value['participants'].filter(isRecord).map(normalizeConsensusParticipant)
    : [];
  if (participants.length === 0) return null;
  return {
    source: String(value['source'] ?? 'consensus'),
    ...(value['stepId'] !== undefined ? { stepId: String(value['stepId']) } : {}),
    ...(value['agent'] !== undefined ? { agent: String(value['agent']) } : {}),
    method: String(value['method'] ?? 'consensus'),
    participants,
  };
}

function normalizeConsensusParticipant(value: Record<string, unknown>): {
  run: number;
  provider?: string;
  model?: string;
  status: string;
  contribution: number;
} {
  return {
    run: typeof value['run'] === 'number' ? value['run'] : Number(value['run'] ?? 0),
    ...(typeof value['provider'] === 'string' ? { provider: value['provider'] } : {}),
    ...(typeof value['model'] === 'string' ? { model: value['model'] } : {}),
    status: String(value['status'] ?? 'unknown'),
    contribution: typeof value['contribution'] === 'number' ? value['contribution'] : Number(value['contribution'] ?? 0),
  };
}

function formatParticipantModel(participant: { provider?: string; model?: string }): string {
  if (participant.provider && participant.model) return `${participant.provider}/${participant.model}`;
  return participant.model ?? participant.provider ?? 'unknown';
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  return `${Math.round(value * 100)}%`;
}


function extractDisplayFinalResult(data: Record<string, unknown>): string | null {
  const combined = combineComplementaryReports(data);
  return combined ?? extractFinalResult(data);
}

function combineComplementaryReports(data: Record<string, unknown>): string | null {
  const steps = Array.isArray(data['steps']) ? data['steps'].filter(isRecord) : [];
  const taxonomy = findLatestUsefulOutput(
    steps,
    ['classyfire-taxonomy-classifier', 'taxonomy-classifier'],
    ['Taxonomy Tree', 'ChemOnt Taxonomic Classification', 'ClassyFire / ChemOnt'],
    ['result-judge', 'output-formatter'],
  ) ?? findLatestUsefulOutput(
    steps,
    [],
    ['Taxonomy Tree', 'ChemOnt Taxonomic Classification', 'ClassyFire / ChemOnt'],
    ['result-judge', 'output-formatter'],
  );
  const usage = findLatestUsefulOutput(
    steps,
    ['usage-classification-tree'],
    ['Usage Tree', 'Usage Classification Tree', 'LCB Exposure Summary'],
    ['result-judge', 'output-formatter'],
  ) ?? findLatestUsefulOutput(
    steps,
    [],
    ['Usage Tree', 'Usage Classification Tree', 'LCB Exposure Summary'],
    ['result-judge', 'output-formatter'],
  );
  if (!taxonomy || !usage) return null;
  if (taxonomy === usage) return taxonomy;
  return `${taxonomy}\n\n---\n\n${usage}`;
}

function findLatestUsefulOutput(
  steps: Record<string, unknown>[],
  agents: string[],
  requiredMarkers: string[],
  excludedAgents: string[] = [],
): string | null {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]!;
    const agent = String(step['agent'] ?? '');
    if (excludedAgents.some((candidate) => agent.includes(candidate))) continue;
    if (agents.length > 0 && !agents.some((candidate) => agent.includes(candidate))) continue;
    const output = usableStepOutput(step);
    if (!output) continue;
    if (requiredMarkers.some((marker) => output.toLowerCase().includes(marker.toLowerCase()))) {
      return output;
    }
  }
  return null;
}

function extractFinalResult(data: Record<string, unknown>): string | null {
  const steps = Array.isArray(data['steps']) ? data['steps'].filter(isRecord) : [];
  const terminalIds = getPreferredTerminalStepIds(toDagPlan(data));

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]!;
    if (terminalIds.size > 0 && !terminalIds.has(String(step['id'] ?? ''))) continue;
    const output = usableStepOutput(step);
    if (output) return output;
  }

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]!;
    const output = usableStepOutput(step);
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


function usableStepOutput(step: Record<string, unknown>): string | null {
  if (step['status'] !== 'completed' && step['status'] !== 'recovered') return null;
  const output = typeof step['output'] === 'string' ? step['output'].trim() : '';
  if (!output || looksLikeInternalToolTable(output) || looksLikeLossyFormatterTable(step, output)) return null;
  return output;
}

function looksLikeInternalToolTable(output: string): boolean {
  const normalized = output.toLowerCase();
  return (
    normalized.includes('| agent | tool | parameter |') ||
    normalized.includes('--- context from previous steps ---') ||
    (/\|\s*grammar-spelling-specialist\s*\|\s*web-search\s*\|/.test(normalized))
  );
}

function looksLikeLossyFormatterTable(step: Record<string, unknown>, output: string): boolean {
  if (step['agent'] !== 'output-formatter') return false;
  const normalized = output.toLowerCase();
  return (
    normalized.includes('| entity | usage domain | source method | confidence |') ||
    normalized.includes('| level 1 | level 2 | level 3 | level 4 | level 5 | level 6 |') ||
    normalized.includes('no matching knowledge entries found') ||
    normalized.includes('data unavailable')
  );
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
