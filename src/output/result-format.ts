import { stringify as stringifyYaml } from 'yaml';
import { marked } from 'marked';
import { getPreferredTerminalStepIds } from '../dag/final-step.js';
import { DAG_RENDER_LAYOUTS, buildDAGLayout, formatConsensusHeadline, formatConsensusParticipant, formatNodeRuntime, renderSimplifiedGraph, resolveDAGRenderLayout } from '../dag/graph-renderer.js';
import type { DAGRenderLayout } from '../dag/graph-renderer.js';
import type { ConsensusParticipant, DAGNodeConsensus, DAGPlan, DAGResult } from '../types/dag.js';
import { normalizeScientificNotation } from '../utils/scientific-notation.js';
import { appendAgentDiscovery, appendPlainAgentDiscovery, renderHtmlAgentDiscovery } from './agent-discovery-format.js';

export type MapOutputFormat = 'json' | 'yaml' | 'markdown' | 'html' | 'text' | 'pdf';

export interface FormatMapOutputOptions {
  compact?: boolean;
  dagLayout?: DAGRenderLayout;
  suppressArtifactIds?: string[];
  printGraphSummary?: boolean;
  suppressSteps?: boolean;
}

const OUTPUT_FORMATS = new Set<MapOutputFormat>(['json', 'yaml', 'markdown', 'html', 'text', 'pdf']);
const OUTPUT_FORMAT_LIST = 'json, yaml, markdown, html, text, pdf';

export function parseDagLayoutOption(value: string | undefined): DAGRenderLayout {
  if (value === undefined) return 'auto';
  const normalized = value.trim().toLowerCase();
  if ((DAG_RENDER_LAYOUTS as string[]).includes(normalized)) return normalized as DAGRenderLayout;
  throw new Error(`--dag-layout must be one of: ${DAG_RENDER_LAYOUTS.join(', ')}`);
}

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
      return options.compact ? formatCompactHtmlResult(result, options) : formatHtmlResult(result, options);
    case 'text':
      return options.compact ? formatCompactTextResult(normalizedResult) : formatTextResult(normalizedResult);
    case 'pdf':
      return options.compact ? formatCompactHtmlResult(result, options) : formatPdfHtmlResult(result, options);
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
    if (step['status'] === 'recovered') continue;
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
  appendEvidenceVerification(lines, data);
  appendJudgePanel(lines, data);
  appendRouterRationale(lines, data);
  appendAgentDiscovery(lines, data);
  appendAgentContributions(lines, data);
  appendAgentComparisons(lines, data);
  appendSelfOptimization(lines, data);
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
  appendPlainJudgePanel(lines, data);
  appendPlainRouterRationale(lines, data);
  appendPlainAgentDiscovery(lines, data);
  appendPlainAgentContributions(lines, data);
  appendPlainAgentComparisons(lines, data);
  appendPlainSelfOptimization(lines, data);
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

function formatHtmlResult(result: unknown, formatOptions: FormatMapOutputOptions = {}): string {
  const data = isRecord(result) ? result : { result };
  return buildHtmlDocument('MAP Result', data, false, result, { dagLayout: formatOptions.dagLayout, suppressArtifactIds: formatOptions.suppressArtifactIds });
}

function formatCompactHtmlResult(result: unknown, formatOptions: FormatMapOutputOptions = {}): string {
  const data = isRecord(result) ? result : { result };
  return buildHtmlDocument('MAP Compact Result', data, true, result, { dagLayout: formatOptions.dagLayout, suppressArtifactIds: formatOptions.suppressArtifactIds });
}

function formatPdfHtmlResult(result: unknown, formatOptions: FormatMapOutputOptions = {}): string {
  const data = isRecord(result) ? result : { result };
  return buildHtmlDocument('MAP Result', data, false, result, {
    includeResultData: false,
    dagLayout: formatOptions.dagLayout,
    suppressArtifactIds: formatOptions.suppressArtifactIds,
    printGraphSummary: formatOptions.printGraphSummary,
    suppressSteps: formatOptions.suppressSteps,
  });
}

function buildHtmlDocument(
  title: string,
  data: Record<string, unknown>,
  compact: boolean,
  rawResult: unknown,
  options: { includeResultData?: boolean; dagLayout?: DAGRenderLayout; suppressArtifactIds?: string[]; printGraphSummary?: boolean; suppressSteps?: boolean } = {},
): string {
  const graph = buildSimplifiedGraph(data);
  const final = extractDisplayFinalResult(data) ?? '';
  const summary = [
    ['Version', data['version']],
    ['Success', data['success']],
    ['Outcome', data['outcome']],
    ['Output directory', data['outputDir']],
    ['Workspace directory', data['workspaceDir']],
    ['Duration', formatDuration(data['duration'])],
    ['Error', data['error']],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');
  const steps = Array.isArray(data['steps']) ? data['steps'].filter(isRecord) : [];
  const includeResultData = options.includeResultData ?? !compact;

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    '<style>body{font-family:system-ui,sans-serif;line-height:1.5;margin:2rem;max-width:1100px}pre{white-space:pre-wrap;background:#f6f8fa;padding:1rem;border-radius:6px}table{border-collapse:collapse;width:100%;margin:.75rem 0 1rem}td,th{border:1px solid #ddd;padding:.4rem;text-align:left}th{background:#f8fafc}code{background:#f6f8fa;padding:.1rem .2rem}.rendered-markdown{border:1px solid #dbe5f2;border-radius:14px;background:#fff;padding:1.1rem;box-shadow:0 8px 24px rgba(15,23,42,.06)}.rendered-markdown h1,.rendered-markdown h2,.rendered-markdown h3{color:#1f3658}.rendered-markdown h1{font-size:1.45rem}.rendered-markdown h2{font-size:1.18rem;border-bottom:1px solid #e2e8f0;padding-bottom:.25rem}.agent-network{margin:1rem 0 1.5rem;padding:1rem;border:1px solid #d8e2ee;border-radius:18px;background:radial-gradient(circle at 20% 10%,#ffffff 0,#eef6ff 38%,#f8fbff 100%);box-shadow:0 14px 36px rgba(30,64,175,.09)}.agent-flow{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.85rem;align-items:start}.agent-stage{border:1px solid #cbd5e1;border-radius:16px;padding:.7rem;background:#f8fafc}.agent-stage.concurrent{background:#eff6ff;border-color:#93c5fd}.agent-stage.sequence{background:#faf5ff;border-color:#c4b5fd}.agent-stage-title{display:flex;justify-content:space-between;gap:.5rem;font-size:.78rem;font-weight:800;color:#334155;text-transform:uppercase;letter-spacing:.04em;margin-bottom:.55rem}.agent-stage-mode{border-radius:999px;padding:.05rem .45rem;background:rgba(255,255,255,.76);color:#1e40af}.agent-stage.sequence .agent-stage-mode{color:#6d28d9}.agent-stage-nodes{display:grid;gap:.65rem}.agent-flow-step{display:flex;align-items:center;gap:.65rem}.agent-node{position:relative;padding:.72rem .8rem .72rem .95rem;border:1px solid #c5d6ea;border-radius:14px;background:linear-gradient(180deg,#fff,#f8fbff);box-shadow:0 8px 22px rgba(30,64,175,.1);break-inside:avoid}.agent-node:before{content:"";position:absolute;inset:0 auto 0 0;width:7px;border-radius:14px 0 0 14px;background:#64748b}.agent-node.completed:before,.agent-node.recovered:before{background:#22c55e}.agent-node.failed:before{background:#ef4444}.agent-node.skipped:before{background:#f59e0b}.agent-node.pending:before{background:#94a3b8}.agent-node.running:before{background:#3b82f6}.agent-node-id{font-size:.72rem;color:#64748b;font-family:ui-monospace,monospace}.agent-node-name{font-weight:800;color:#1e293b;margin:.1rem 0}.agent-node-meta,.agent-node-inputs,.agent-node-consensus{font-size:.75rem;color:#475569}.agent-node-inputs{font-family:ui-monospace,monospace}.agent-node-consensus{margin-top:.25rem;font-weight:700;color:#334155}.agent-consensus-runs{margin:.2rem 0 0;padding-left:1rem;font-size:.72rem;color:#475569}.flow-arrow{display:inline-flex;align-items:center;gap:.15rem;color:#4877bd;font-weight:900}.flow-arrow-line{width:24px;border-top:3px solid #8db5ec}.flow-arrow-head{width:0;height:0;border-top:6px solid transparent;border-bottom:6px solid transparent;border-left:9px solid #8db5ec}.artifact-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem;margin:1rem 0 1.5rem}.artifact-figure{border:1px solid #d8e2ee;border-radius:16px;background:#fff;padding:.8rem;box-shadow:0 8px 24px rgba(15,23,42,.06);break-inside:avoid}.artifact-figure img{max-width:100%;height:auto;display:block}.artifact-figure figcaption{font-size:.8rem;color:#475569;margin-top:.5rem}.agent-network-edges{margin-top:1rem;display:grid;gap:.35rem}.agent-edge{font-family:ui-monospace,monospace;font-size:.78rem;color:#334155;background:rgba(255,255,255,.72);border:1px dashed #bfd0e4;border-radius:999px;padding:.25rem .55rem}.agent-edge.planned{border-color:#8db5ec}.agent-edge.handoff{border-color:#a78bfa}.agent-edge.recovery{border-color:#fca5a5}.agent-edge.spawned{border-color:#fbbf24}.agent-edge.feedback{border-color:#67e8f9}.agent-matrix-network{margin:1rem 0 1.5rem;padding:1rem;border:1px solid #ddd6fe;border-radius:18px;background:linear-gradient(180deg,#fbfaff,#fff);box-shadow:0 14px 36px rgba(88,28,135,.08);overflow:auto}.agent-matrix-network table{min-width:760px;font-size:.78rem}.agent-matrix-network th{background:#f5f3ff;color:#4c1d95}.matrix-role{font-weight:800;color:#334155;white-space:nowrap}.matrix-cell{min-width:72px;vertical-align:top;background:#fff}.matrix-chip{display:block;margin:.12rem 0;padding:.18rem .28rem;border-radius:8px;background:#f5f3ff;border:1px solid #ddd6fe;font-family:ui-monospace,monospace;font-size:.68rem;color:#4c1d95}.matrix-chip.completed,.matrix-chip.recovered{border-color:#86efac;background:#f0fdf4;color:#166534}.matrix-chip.failed{border-color:#fecaca;background:#fef2f2;color:#991b1b}.matrix-chip.running{border-color:#93c5fd;background:#eff6ff;color:#1d4ed8}.matrix-chip.skipped{border-color:#fed7aa;background:#fff7ed;color:#9a3412}.matrix-consensus{display:block;font-size:.62rem;color:#475569;margin-top:.1rem}.agent-metro-network,.agent-cluster-network{margin:1rem 0 1.5rem;padding:1rem;border:1px solid #d8e2ee;border-radius:18px;background:#fff;box-shadow:0 14px 36px rgba(15,23,42,.08);overflow:auto}.pipeline-summary{border:1px solid #cbd5e1;border-radius:12px;padding:.65rem .75rem;background:#f8fafc;margin:.75rem 0 1rem}.pipeline-summary-meta{font-size:.78rem;color:#475569;margin:.1rem 0 .45rem}.pipeline-summary-flow{display:flex;flex-wrap:wrap;gap:.25rem;align-items:center}.pipeline-step-chip{display:inline-flex;gap:.25rem;align-items:center;border:1px solid #cbd5e1;border-radius:999px;background:#fff;padding:.16rem .42rem;font-size:.72rem;line-height:1.2}.pipeline-step-chip.completed,.pipeline-step-chip.recovered{border-color:#86efac;background:#f0fdf4}.pipeline-step-chip.failed{border-color:#fecaca;background:#fef2f2}.pipeline-step-chip.running{border-color:#93c5fd;background:#eff6ff}.pipeline-step-chip.skipped{border-color:#fed7aa;background:#fff7ed}.pipeline-arrow{color:#94a3b8;font-size:.7rem}.pipeline-legend{margin:.45rem 0 0;font-size:.7rem;color:#475569}.pipeline-legend strong{color:#334155}.pipeline-legend span{display:inline-block;margin-right:.65rem}.agent-metro-svg{min-width:760px;width:100%;height:auto;display:block}.metro-stop{filter:drop-shadow(0 2px 4px rgba(15,23,42,.12))}.cluster-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:.8rem}.cluster-card{border:1px solid #fed7aa;background:#fff7ed;border-radius:16px;padding:.75rem}.cluster-card h4{margin:.1rem 0 .35rem;color:#9a3412}.cluster-chip{display:inline-block;margin:.12rem;padding:.2rem .38rem;border-radius:999px;background:#fff;border:1px solid #fdba74;font-family:ui-monospace,monospace;font-size:.7rem;color:#7c2d12}</style>',
    '</head>',
    '<body>',
    `<h1>${escapeHtml(title)}</h1>`,
    ...(compact ? [] : ['<h2>Summary</h2>', '<ul>', ...summary.map(([label, value]) => `<li><strong>${escapeHtml(String(label))}:</strong> ${escapeHtml(String(value))}</li>`), '</ul>']),
    ...(options.printGraphSummary === true
      ? ['<h2>Pipeline Summary</h2>', renderHtmlPipelineSummary(data)]
      : [
          '<h2>Agent Graph</h2>',
          graph.length > 0 ? `<ul>${graph.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : '<p>No graph available.</p>',
          renderHtmlAgentNetwork(data, options.dagLayout ?? 'auto'),
        ]),
    renderHtmlVisualArtifacts(data, options.suppressArtifactIds ?? []),
    ...renderHtmlEvidenceVerification(data),
    ...(compact ? [] : [
      renderHtmlJudgePanel(data),
      renderHtmlRouterRationale(data),
      renderHtmlAgentDiscovery(data),
      renderHtmlAgentContributions(data),
      renderHtmlAgentComparisons(data),
      renderHtmlSelfOptimization(data),
    ]),
    ...renderHtmlConsensusDiagnostics(data),
    ...renderHtmlErrors(data),
    ...renderHtmlWarnings(data),
    ...(compact || options.suppressSteps === true || steps.length === 0 ? [] : ['<h2>Steps</h2>', renderHtmlStepTable(steps)]),
    '<h2>Final Result</h2>',
    renderFinalResultHtml(final),
    ...(includeResultData ? ['<h2>Result Data</h2>', `<pre>${escapeHtml(JSON.stringify(rawResult, null, 2))}</pre>`] : []),
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function renderHtmlPipelineSummary(data: Record<string, unknown>): string {
  const dag = buildRenderableDag(data);
  if (dag.nodes.length === 0) return '<p>No pipeline summary available.</p>';
  const agentCount = new Set(dag.nodes.map((node) => node.agent).filter(Boolean)).size;
  const failed = dag.nodes.filter((node) => node.status === 'failed').length;
  const recovered = dag.nodes.filter((node) => node.status === 'recovered').length;
  const abbreviations = buildAgentAbbreviations(dag.nodes.map((node) => node.agent).filter(Boolean));
  const chips = dag.nodes.map((node, index) => {
    const status = String(node.status ?? '').toLowerCase();
    const consensus = node.consensus ? ` ${node.consensus.runs}x` : '';
    const abbreviation = abbreviations.get(node.agent) ?? abbreviationBase(node.agent);
    const chip = `<span class="pipeline-step-chip ${escapeHtml(status)}"><strong>${escapeHtml(node.id)}</strong> [${escapeHtml(abbreviation)}]${escapeHtml(consensus)}</span>`;
    return index === 0 ? chip : `<span class="pipeline-arrow">→</span>${chip}`;
  }).join('');
  const notes = [
    `${dag.nodes.length} steps`,
    `${agentCount} agents`,
    `${dag.edges.length} links`,
    failed > 0 ? `${failed} failed` : '',
    recovered > 0 ? `${recovered} recovered` : '',
  ].filter(Boolean).join(' · ');
  const legend = [...abbreviations.entries()]
    .sort(([, a], [, b]) => a.localeCompare(b))
    .map(([agent, abbreviation]) => `<span><strong>${escapeHtml(abbreviation)}</strong> = ${escapeHtml(agent)}</span>`)
    .join('');
  return `<section class="pipeline-summary"><p class="pipeline-summary-meta">${escapeHtml(notes)}</p><div class="pipeline-summary-flow">${chips}</div>${legend ? `<p class="pipeline-legend"><strong>Agent legend:</strong> ${legend}</p>` : ''}</section>`;
}

function buildAgentAbbreviations(agents: string[]): Map<string, string> {
  const uniqueAgents = [...new Set(agents)];
  const used = new Set<string>();
  const result = new Map<string, string>();
  for (const agent of uniqueAgents) {
    const base = abbreviationBase(agent);
    let abbreviation = base;
    let suffix = 2;
    while (used.has(abbreviation)) {
      abbreviation = `${base}${suffix}`;
      suffix += 1;
    }
    used.add(abbreviation);
    result.set(agent, abbreviation);
  }
  return result;
}

function abbreviationBase(agent: string): string {
  const parts = agent.split(/[-_\s]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('').slice(0, 4);
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

function renderHtmlVisualArtifacts(data: Record<string, unknown>, suppressArtifactIds: string[] = []): string {
  const suppressed = new Set(suppressArtifactIds);
  const artifacts = Array.isArray(data['artifacts'])
    ? data['artifacts'].filter(isRecord).filter((artifact) => !suppressed.has(String(artifact['id'] ?? '')))
    : [];
  if (artifacts.length === 0) return '';

  const figures = artifacts
    .map((artifact) => {
      const src = safeArtifactSrc(artifact);
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

function safeArtifactSrc(artifact: Record<string, unknown>): string {
  if (typeof artifact['src'] !== 'string') return '';
  const src = artifact['src'].trim();
  if (/^[A-Za-z0-9._-]+$/.test(src)) {
    const artifactPath = typeof artifact['path'] === 'string' ? artifact['path'].trim() : '';
    return artifactPath && artifactPath.split(/[\/]/).at(-1) === src ? src : '';
  }
  if (!/^artifacts\/[A-Za-z0-9._/-]+$/.test(src)) return '';
  const segments = src.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return '';
  return src;
}

function renderHtmlAgentNetwork(data: Record<string, unknown>, requestedLayout: DAGRenderLayout = 'auto'): string {
  const dag = buildRenderableDag(data);
  if (dag.nodes.length === 0) return '';
  const resolvedLayout = resolveDAGRenderLayout(dag, requestedLayout);
  if (resolvedLayout === 'matrix') return renderHtmlAgentMatrixNetwork(dag);
  if (resolvedLayout === 'metro') return renderHtmlAgentMetroNetwork(dag);
  if (resolvedLayout === 'cluster') return renderHtmlAgentClusterNetwork(dag);

  const layout = buildDAGLayout(dag);
  if (layout.layers.length === 0) return '';

  const stages = layout.layers.map((layer, layerPosition) => {
    const nodes = layer.nodes.map((entry) => {
      const node = entry.node;
      const id = String(node.id ?? '');
      const agent = String(node.agent ?? 'unknown');
      const status = String(node.status ?? 'pending').toLowerCase();
      const runtime = formatNodeRuntime(node);
      const duration = formatDuration(node.duration);
      const meta = [status, runtime, duration].filter(Boolean).join(' | ');
      const inputs = entry.inputs.length > 0 ? `${id} inputs: ${entry.inputs.join(', ')}` : `${id} inputs: none`;
      const consensusHeadline = formatConsensusHeadline(node.consensus);
      const consensusRuns = node.consensus?.participants?.map((participant) => `<li>${escapeHtml(formatConsensusParticipant(participant))}</li>`) ?? [];
      return [
        `<article class="agent-node ${escapeHtml(status)}">`,
        `<div class="agent-node-id">${escapeHtml(id)}</div>`,
        `<div class="agent-node-name">${escapeHtml(agent)}</div>`,
        `<div class="agent-node-meta">${escapeHtml(meta)}</div>`,
        `<div class="agent-node-inputs">${escapeHtml(inputs)}</div>`,
        ...(consensusHeadline ? [`<div class="agent-node-consensus">Consensus: ${escapeHtml(consensusHeadline)}</div>`] : []),
        ...(consensusRuns.length > 0 ? ['<ul class="agent-consensus-runs">', ...consensusRuns, '</ul>'] : []),
        '</article>',
      ].join('');
    }).join('');

    const connector = layerPosition < layout.layers.length - 1
      ? '<span class="flow-arrow" aria-hidden="true"><span class="flow-arrow-line"></span><span class="flow-arrow-head"></span></span>'
      : '';

    return [
      `<section class="agent-stage ${layer.mode}">`,
      `<div class="agent-stage-title"><span>Stage ${layer.index + 1}</span><span class="agent-stage-mode">${layer.mode}</span></div>`,
      '<div class="agent-stage-nodes">',
      nodes,
      '</div>',
      connector,
      '</section>',
    ].join('');
  });

  const edgeLines = layout.edges
    .map((edge) => {
      const from = String(edge.from ?? '');
      const to = String(edge.to ?? '');
      const type = String(edge.type ?? 'planned');
      if (!from || !to) return '';
      return `<div class="agent-edge ${escapeHtml(type)}">${escapeHtml(`${from} -> ${to}`)} <span>(${escapeHtml(type)})</span></div>`;
    })
    .filter(Boolean);

  return [
    '<section class="agent-network" aria-label="Agent network visualization">',
    '<h3>Agent Network</h3>',
    '<div class="agent-flow">',
    ...stages,
    '</div>',
    ...(edgeLines.length > 0 ? ['<div class="agent-network-edges">', ...edgeLines, '</div>'] : []),
    '</section>',
  ].join('');
}

function renderHtmlAgentMetroNetwork(dag: DAGResult): string {
  const layout = buildDAGLayout(dag);
  const width = Math.max(760, 110 + layout.layers.length * 120);
  const lanes = [...new Set(dag.nodes.map((node) => node.agent || 'unknown'))];
  const laneY = new Map(lanes.map((lane, index) => [lane, 70 + index * 54]));
  const nodePositions = new Map<string, { x: number; y: number }>();
  for (const layer of layout.layers) {
    for (const entry of layer.nodes) {
      nodePositions.set(entry.node.id, {
        x: 80 + layer.index * 120,
        y: laneY.get(entry.node.agent || 'unknown') ?? 70,
      });
    }
  }
  const height = 112 + Math.max(1, lanes.length) * 54;
  const edgeLines = dag.edges.map((edge) => {
    const from = nodePositions.get(edge.from);
    const to = nodePositions.get(edge.to);
    if (!from || !to) return '';
    const color = edge.type === 'recovery'
      ? '#ef4444'
      : edge.type === 'handoff'
        ? '#8b5cf6'
        : edge.type === 'spawned'
          ? '#f59e0b'
          : edge.type === 'feedback'
            ? '#06b6d4'
            : '#10b981';
    return `<path d="M ${from.x} ${from.y} C ${from.x + 45} ${from.y}, ${to.x - 45} ${to.y}, ${to.x} ${to.y}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" opacity=".78"/>`;
  }).join('');
  const stops = dag.nodes.map((node) => {
    const pos = nodePositions.get(node.id);
    if (!pos) return '';
    const consensus = formatConsensusHeadline(node.consensus);
    const ticks = node.consensus ? '<g stroke="#334155" stroke-width="2"><line x1="-7" y1="-19" x2="-7" y2="-10"/><line x1="0" y1="-21" x2="0" y2="-10"/><line x1="7" y1="-19" x2="7" y2="-10"/></g>' : '';
    return `<g class="metro-stop" transform="translate(${pos.x} ${pos.y})"><circle r="13" fill="#fff" stroke="#059669" stroke-width="4"/>${ticks}<text x="-28" y="32" font-size="10" fill="#334155">${escapeHtml(node.id)}</text>${consensus ? `<text x="-28" y="45" font-size="9" fill="#475569">${escapeHtml(consensus)}</text>` : ''}</g>`;
  }).join('');
  const laneLabels = lanes.map((lane) => `<text x="18" y="${(laneY.get(lane) ?? 70) + 4}" font-size="11" font-weight="700" fill="#475569">${escapeHtml(lane)}</text>`).join('');

  return [
    '<section class="agent-metro-network" aria-label="Agent metro visualization">',
    '<h3>Agent Metro</h3>',
    '<p class="agent-node-meta">Metro mode: routes show branch and join flow; consensus runs appear as ticks above stops.</p>',
    `<svg class="agent-metro-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Agent Metro">`,
    `<rect width="100%" height="100%" rx="16" fill="#f7fffb"/>`,
    laneLabels,
    edgeLines,
    stops,
    '</svg>',
    '</section>',
  ].join('');
}

function renderHtmlAgentClusterNetwork(dag: DAGResult): string {
  const layout = buildDAGLayout(dag);
  const cards = layout.layers.map((layer) => {
    const agents = new Map<string, typeof dag.nodes>();
    for (const entry of layer.nodes) {
      const key = entry.node.agent || 'unknown';
      const nodes = agents.get(key) ?? [];
      nodes.push(entry.node);
      agents.set(key, nodes);
    }
    const groups = [...agents.entries()].map(([agent, nodes]) => [
      `<div><strong>${escapeHtml(agent)}</strong></div>`,
      `<div>${nodes.map((node) => `<span class="cluster-chip">${escapeHtml(node.id)}${node.consensus ? ` ${escapeHtml(formatConsensusHeadline(node.consensus))}` : ''}</span>`).join('')}</div>`,
    ].join('')).join('');
    return `<article class="cluster-card"><h4>Stage ${layer.index + 1} ${layer.mode}</h4>${groups}</article>`;
  }).join('');
  return [
    '<section class="agent-cluster-network" aria-label="Agent cluster visualization">',
    '<h3>Agent Clusters</h3>',
    '<p class="agent-node-meta">Cluster mode: repeated parallel work is grouped by stage and agent for summary-first reports.</p>',
    '<div class="cluster-grid">',
    cards,
    '</div>',
    '</section>',
  ].join('');
}


function renderHtmlAgentMatrixNetwork(dag: DAGResult): string {
  const layout = buildDAGLayout(dag);
  const roles = [...new Set(dag.nodes.map((node) => node.agent || 'unknown'))];
  const byRoleAndStage = new Map<string, typeof dag.nodes>();
  for (const layer of layout.layers) {
    for (const entry of layer.nodes) {
      const key = `${entry.node.agent || 'unknown'}:${layer.index}`;
      const nodes = byRoleAndStage.get(key) ?? [];
      nodes.push(entry.node);
      byRoleAndStage.set(key, nodes);
    }
  }

  const header = [
    '<tr><th>Role / Stage</th>',
    ...layout.layers.map((layer) => `<th>Stage ${layer.index + 1}<br><small>${escapeHtml(layer.mode)}</small></th>`),
    '</tr>',
  ].join('');

  const rows = roles.map((role) => {
    const cells = layout.layers.map((layer) => {
      const nodes = byRoleAndStage.get(`${role}:${layer.index}`) ?? [];
      const chips = nodes.map((node) => {
        const consensus = formatConsensusHeadline(node.consensus);
        return [
          `<span class="matrix-chip ${escapeHtml(String(node.status ?? '').toLowerCase())}">`,
          escapeHtml(node.id),
          consensus ? `<span class="matrix-consensus">${escapeHtml(consensus)}</span>` : '',
          '</span>',
        ].join('');
      }).join('');
      return `<td class="matrix-cell">${chips}</td>`;
    }).join('');
    return `<tr><th class="matrix-role">${escapeHtml(role)}</th>${cells}</tr>`;
  }).join('');

  const edgeSummary = dag.edges.length > 0
    ? `<div class="agent-network-edges">${dag.edges.map((edge) => `<div class="agent-edge ${escapeHtml(edge.type)}">${escapeHtml(`${edge.from} -> ${edge.to}`)} <span>(${escapeHtml(edge.type)})</span></div>`).join('')}</div>`
    : '';

  return [
    '<section class="agent-matrix-network" aria-label="Agent matrix visualization">',
    '<h3>Agent Matrix</h3>',
    '<p class="agent-node-meta">Large DAG compact mode: rows are agent roles, columns are dependency stages.</p>',
    '<table>',
    '<thead>', header, '</thead>',
    '<tbody>', rows, '</tbody>',
    '</table>',
    edgeSummary,
    '</section>',
  ].join('');
}


function appendSummary(lines: string[], data: Record<string, unknown>): void {
  lines.push('## Summary', '');
  appendField(lines, 'Version', data['version']);
  appendField(lines, 'Success', data['success']);
  appendField(lines, 'Outcome', data['outcome']);
  appendField(lines, 'Output directory', data['outputDir']);
  appendField(lines, 'Workspace directory', data['workspaceDir']);
  appendField(lines, 'Duration', formatDuration(data['duration']));
  appendField(lines, 'Error', data['error']);

  if (lines.at(-1) === '') {
    lines.push('- Result: see data below');
  }
}

function appendAgentGraph(lines: string[], data: Record<string, unknown>): void {
  const graph = buildSimplifiedGraph(data);
  if (graph.length === 0) return;

  lines.push('', '## Agent Graph', '', '```text', ...graph, '```');
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

function appendEvidenceVerification(lines: string[], data: Record<string, unknown>): void {
  const rows = collectEvidenceVerificationRows(data);
  if (rows.length === 0) return;
  const coverage = collectEvidenceCoverage(data);
  lines.push(
    '',
    '## Evidence Verification',
    '',
    `- Evidence coverage: ${coverage.supported} supported / ${coverage.total} total claims`,
    `- Needs review: ${coverage.needsReview}`,
    `- Rejected: ${coverage.rejected}`,
    '',
    '| Step | Agent | Status | Claim | Severity | Finding | Sources |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const row of rows) {
    lines.push(`| ${cell(row.step)} | ${cell(row.agent)} | ${cell(row.status)} | ${cell(row.claimId)} | ${cell(row.severity)} | ${cell(row.message)} | ${cell(row.sources)} |`);
  }
}

function renderHtmlEvidenceVerification(data: Record<string, unknown>): string[] {
  const rows = collectEvidenceVerificationRows(data);
  if (rows.length === 0) return [];
  const coverage = collectEvidenceCoverage(data);
  return [
    '<h2>Evidence Verification</h2>',
    `<p><strong>Evidence coverage:</strong> ${coverage.supported} supported / ${coverage.total} total claims · Needs review: ${coverage.needsReview} · Rejected: ${coverage.rejected}</p>`,
    '<table>',
    '<thead><tr><th>Step</th><th>Agent</th><th>Status</th><th>Claim</th><th>Severity</th><th>Finding</th><th>Sources</th></tr></thead>',
    '<tbody>',
    ...rows.map((row) => `<tr><td>${escapeHtml(row.step)}</td><td>${escapeHtml(row.agent)}</td><td>${escapeHtml(row.status)}</td><td>${escapeHtml(row.claimId)}</td><td>${escapeHtml(row.severity)}</td><td>${escapeHtml(row.message)}</td><td>${escapeHtml(row.sources)}</td></tr>`),
    '</tbody>',
    '</table>',
  ];
}

function collectEvidenceCoverage(data: Record<string, unknown>): {
  total: number;
  supported: number;
  needsReview: number;
  rejected: number;
} {
  const steps = effectiveEvidenceSteps(data);
  let total = 0;
  let rejected = 0;
  let needsReview = 0;
  for (const step of steps) {
    const gate = isRecord(step['evidenceGate']) ? step['evidenceGate'] : undefined;
    if (!gate || gate['checked'] !== true) continue;
    const claims = Array.isArray(gate['claims']) ? gate['claims'].filter(isRecord) : [];
    const findings = Array.isArray(gate['findings']) ? gate['findings'].filter(isRecord) : [];
    total += claims.length;
    const rejectedClaimIds = new Set(findings.filter((finding) => finding['severity'] === 'high').map((finding) => String(finding['claimId'] ?? '')));
    const reviewClaimIds = new Set(findings.filter((finding) => finding['severity'] !== 'high').map((finding) => String(finding['claimId'] ?? '')));
    rejected += [...rejectedClaimIds].filter(Boolean).length;
    needsReview += [...reviewClaimIds].filter((id) => id && !rejectedClaimIds.has(id)).length;
  }
  return {
    total,
    rejected,
    needsReview,
    supported: Math.max(0, total - rejected - needsReview),
  };
}


function effectiveEvidenceSteps(data: Record<string, unknown>): Record<string, unknown>[] {
  const steps = Array.isArray(data['steps']) ? data['steps'].filter(isRecord) : [];
  const byId = new Map(steps.map((step) => [String(step['id'] ?? ''), step]));
  return steps.filter((step) => !isSupersededRecoveredEvidenceStep(step, byId));
}

function isSupersededRecoveredEvidenceStep(
  step: Record<string, unknown>,
  byId: Map<string, Record<string, unknown>>,
  seen = new Set<string>(),
): boolean {
  if (step['status'] !== 'recovered') return false;
  const replacementId = typeof step['replacementStepId'] === 'string' ? step['replacementStepId'].trim() : '';
  if (!replacementId || seen.has(replacementId)) return false;
  const replacement = byId.get(replacementId);
  if (!replacement) return false;
  seen.add(replacementId);
  if (isSupersededRecoveredEvidenceStep(replacement, byId, seen)) return true;
  if (replacement['status'] !== 'completed' && replacement['status'] !== 'recovered') return false;
  const replacementGate = isRecord(replacement['evidenceGate']) ? replacement['evidenceGate'] : undefined;
  return !replacementGate || replacementGate['passed'] === true;
}

function collectEvidenceVerificationRows(data: Record<string, unknown>): Array<{
  step: string;
  agent: string;
  status: string;
  claimId: string;
  severity: string;
  message: string;
  sources: string;
}> {
  const steps = effectiveEvidenceSteps(data);
  return steps.flatMap((step) => {
    const gate = isRecord(step['evidenceGate']) ? step['evidenceGate'] : undefined;
    if (!gate || gate['checked'] !== true) return [];
    const findings = Array.isArray(gate['findings']) ? gate['findings'].filter(isRecord) : [];
    const claims = Array.isArray(gate['claims']) ? gate['claims'].filter(isRecord) : [];
    const sourcesForClaim = (claimId: string): string => {
      const claim = claims.find((candidate) => String(candidate['id'] ?? '') === claimId);
      const evidence = Array.isArray(claim?.['evidence']) ? claim['evidence'].filter(isRecord) : [];
      return evidence.map(formatEvidenceSourceSummary).filter(Boolean).join('; ');
    };
    if (findings.length === 0) {
      return [{
        step: String(step['id'] ?? ''),
        agent: String(step['agent'] ?? ''),
        status: gate['passed'] === true ? 'pass' : 'fail',
        claimId: '',
        severity: '',
        message: gate['passed'] === true ? 'All evidence-gate checks passed.' : 'Evidence gate failed.',
        sources: '',
      }];
    }
    return findings.map((finding) => ({
      step: String(step['id'] ?? ''),
      agent: String(step['agent'] ?? ''),
      status: gate['passed'] === true ? 'pass' : 'fail',
      claimId: String(finding['claimId'] ?? ''),
      severity: String(finding['severity'] ?? ''),
      message: String(finding['message'] ?? ''),
      sources: sourcesForClaim(String(finding['claimId'] ?? '')),
    }));
  });
}

function formatEvidenceSourceSummary(source: Record<string, unknown>): string {
  const title = String(source['title'] ?? source['sourceType'] ?? 'source');
  const publishedAt = typeof source['publishedAt'] === 'string' && source['publishedAt'].trim()
    ? `published ${source['publishedAt']}`
    : '';
  const retrievedAt = typeof source['retrievedAt'] === 'string' && source['retrievedAt'].trim()
    ? `retrieved ${source['retrievedAt']}`
    : '';
  const dates = [publishedAt, retrievedAt].filter(Boolean).join(', ');
  return dates ? `${title} (${dates})` : title;
}

function appendJudgePanel(lines: string[], data: Record<string, unknown>): void {
  const panel = normalizeJudgePanel(data);
  if (!panel) return;
  lines.push('', '## LLM Judge Panel', '');
  lines.push(`- Verdict: ${panel.verdict}`);
  lines.push(`- Votes: ${panel.voteCount}`);
  lines.push(`- Steering applied: ${panel.steeringApplied ? 'yes' : 'no'}`);
  if (panel.improvements.length > 0) {
    lines.push('- Improvements:', ...panel.improvements.map((entry) => `  - ${entry}`));
  }
  if (panel.rounds.length > 0) {
    lines.push('- Rounds:', ...panel.rounds.map((round) => `  - Round ${round.round}: ${round.verdict} (${round.voteCount} vote${round.voteCount === 1 ? '' : 's'})`));
  }
  lines.push('', '| Run | Role | Model | Verdict | Confidence | Steering | Rationale |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const vote of panel.votes) {
    lines.push(`| ${cell(vote.run)} | ${cell(vote.role ?? '')} | ${cell(vote.model ?? vote.provider ?? 'unknown')} | ${cell(vote.verdict)} | ${cell(formatPercent(vote.confidence))} | ${cell(vote.shouldSteer ? 'yes' : 'no')} | ${cell(vote.rationale)} |`);
  }
}

function appendPlainJudgePanel(lines: string[], data: Record<string, unknown>): void {
  const panel = normalizeJudgePanel(data);
  if (!panel) return;
  lines.push('LLM Judge Panel', '---------------');
  lines.push(`- Verdict: ${panel.verdict}`);
  lines.push(`- Votes: ${panel.voteCount}`);
  lines.push(`- Steering applied: ${panel.steeringApplied ? 'yes' : 'no'}`);
  for (const round of panel.rounds) lines.push(`- Round ${round.round}: ${round.verdict}`);
  for (const improvement of panel.improvements) lines.push(`- Improvement: ${improvement}`);
  lines.push('');
}

function renderHtmlJudgePanel(data: Record<string, unknown>): string {
  const panel = normalizeJudgePanel(data);
  if (!panel) return '';
  const rows = panel.votes.map((vote) => [
    vote.run,
    vote.role ?? '',
    vote.model ?? vote.provider ?? 'unknown',
    vote.verdict,
    formatPercent(vote.confidence),
    vote.shouldSteer ? 'yes' : 'no',
    vote.rationale,
  ]);
  return [
    '<h2>LLM Judge Panel</h2>',
    `<p><strong>Verdict:</strong> ${escapeHtml(panel.verdict)} · <strong>Votes:</strong> ${panel.voteCount} · <strong>Steering applied:</strong> ${panel.steeringApplied ? 'yes' : 'no'}</p>`,
    panel.rounds.length > 0 ? `<p><strong>Rounds:</strong> ${escapeHtml(panel.rounds.map((round) => `Round ${round.round}: ${round.verdict}`).join(' · '))}</p>` : '',
    panel.improvements.length > 0 ? `<ul>${panel.improvements.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul>` : '',
    '<table>',
    '<thead><tr><th>Run</th><th>Role</th><th>Model</th><th>Verdict</th><th>Confidence</th><th>Steering</th><th>Rationale</th></tr></thead>',
    '<tbody>',
    ...rows.map((row) => `<tr>${row.map((cellValue) => `<td>${escapeHtml(String(cellValue ?? ''))}</td>`).join('')}</tr>`),
    '</tbody>',
    '</table>',
  ].join('\n');
}

function normalizeJudgePanel(data: Record<string, unknown>): {
  verdict: string;
  voteCount: number;
  steeringApplied: boolean;
  improvements: string[];
  votes: Array<{
    run: number;
    role?: string;
    provider?: string;
    model?: string;
    verdict: string;
    confidence: number;
    rationale: string;
    shouldSteer: boolean;
  }>;
  rounds: Array<{ round: number; verdict: string; voteCount: number }>;
} | null {
  const panel = isRecord(data['judgePanel']) ? data['judgePanel'] : undefined;
  if (!panel) return null;
  const votes = Array.isArray(panel['votes']) ? panel['votes'].filter(isRecord).map((vote) => ({
    run: Number(vote['run'] ?? 0),
    ...(typeof vote['role'] === 'string' ? { role: vote['role'] } : {}),
    ...(typeof vote['provider'] === 'string' ? { provider: vote['provider'] } : {}),
    ...(typeof vote['model'] === 'string' ? { model: vote['model'] } : {}),
    verdict: String(vote['verdict'] ?? ''),
    confidence: Number(vote['confidence'] ?? 0),
    rationale: String(vote['rationale'] ?? ''),
    shouldSteer: vote['shouldSteer'] === true,
  })) : [];
  return {
    verdict: String(panel['verdict'] ?? 'unknown'),
    voteCount: Number(panel['voteCount'] ?? votes.length),
    steeringApplied: panel['steeringApplied'] === true,
    improvements: Array.isArray(panel['improvements']) ? panel['improvements'].map(String) : [],
    votes,
    rounds: Array.isArray(panel['rounds'])
      ? panel['rounds'].filter(isRecord).map((round) => ({
        round: Number(round['round'] ?? 0),
        verdict: String(round['verdict'] ?? ''),
        voteCount: Number(round['voteCount'] ?? 0),
      }))
      : [],
  };
}

function appendRouterRationale(lines: string[], data: Record<string, unknown>): void {
  const rationale = normalizeRouterRationale(data);
  if (!rationale) return;
  lines.push('', '## Router Rationale', '');
  if (rationale.selectedAgents.length > 0) {
    lines.push('Selected agents:');
    for (const entry of rationale.selectedAgents) lines.push(`- ${entry.agent}: ${entry.reason}`);
  }
  if (rationale.rejectedAgents.length > 0) {
    lines.push('', 'Rejected or skipped agents:');
    for (const entry of rationale.rejectedAgents) lines.push(`- ${entry.agent}: ${entry.reason}`);
  }
}

function appendPlainRouterRationale(lines: string[], data: Record<string, unknown>): void {
  const rationale = normalizeRouterRationale(data);
  if (!rationale) return;
  lines.push('Router Rationale', '----------------');
  for (const entry of rationale.selectedAgents) lines.push(`- selected ${entry.agent}: ${entry.reason}`);
  for (const entry of rationale.rejectedAgents) lines.push(`- skipped ${entry.agent}: ${entry.reason}`);
  lines.push('');
}

function renderHtmlRouterRationale(data: Record<string, unknown>): string {
  const rationale = normalizeRouterRationale(data);
  if (!rationale) return '';
  const selected = rationale.selectedAgents.map((entry) => `<li><strong>${escapeHtml(entry.agent)}:</strong> ${escapeHtml(entry.reason)}</li>`).join('');
  const rejected = rationale.rejectedAgents.map((entry) => `<li><strong>${escapeHtml(entry.agent)}:</strong> ${escapeHtml(entry.reason)}</li>`).join('');
  return [
    '<h2>Router Rationale</h2>',
    selected ? `<h3>Selected agents</h3><ul>${selected}</ul>` : '',
    rejected ? `<h3>Rejected or skipped agents</h3><ul>${rejected}</ul>` : '',
  ].join('\n');
}

function normalizeRouterRationale(data: Record<string, unknown>): {
  selectedAgents: Array<{ agent: string; reason: string }>;
  rejectedAgents: Array<{ agent: string; reason: string }>;
} | null {
  const rationale = isRecord(data['routerRationale']) ? data['routerRationale'] : undefined;
  if (!rationale) return null;
  const selectedAgents = normalizeRationaleEntries(rationale['selectedAgents']);
  const rejectedAgents = normalizeRationaleEntries(rationale['rejectedAgents']);
  if (selectedAgents.length === 0 && rejectedAgents.length === 0) return null;
  return { selectedAgents, rejectedAgents };
}

function normalizeRationaleEntries(value: unknown): Array<{ agent: string; reason: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((entry) => ({
      agent: String(entry['agent'] ?? '').trim(),
      reason: String(entry['reason'] ?? '').trim(),
    }))
    .filter((entry) => entry.agent.length > 0 && entry.reason.length > 0);
}

interface AgentContributionSummary {
  agent: string;
  steps: Record<string, unknown>[];
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  recoveredSteps: number;
  status: string;
  tasks: string[];
  benefits: string[];
  evidence: string[];
  disableCommand?: string;
  selfOptimizationReason?: string;
}

function appendAgentComparisons(lines: string[], data: Record<string, unknown>): void {
  const comparisons = collectAgentComparisons(data);
  if (comparisons.length === 0) return;
  lines.push(
    '',
    '## Agent Comparison Runs',
    '',
    '| Disabled agent | Baseline | Variant | Similarity | Recommendation |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const comparison of comparisons) {
    lines.push(`| ${cell(comparison.disabledAgent)} | ${cell(comparison.baselineSuccess ? 'success' : 'failed')} | ${cell(comparison.variantSuccess ? 'success' : 'failed')} | ${cell(formatPercent(comparison.finalSimilarity))} | ${cell(comparison.recommendation)} |`);
  }
}

function appendPlainAgentComparisons(lines: string[], data: Record<string, unknown>): void {
  const comparisons = collectAgentComparisons(data);
  if (comparisons.length === 0) return;
  lines.push('Agent Comparison Runs', '---------------------');
  for (const comparison of comparisons) {
    lines.push(`- without ${comparison.disabledAgent}: ${comparison.variantSuccess ? 'success' : 'failed'}, similarity ${formatPercent(comparison.finalSimilarity)}; ${comparison.recommendation}`);
  }
  lines.push('');
}

function renderHtmlAgentComparisons(data: Record<string, unknown>): string {
  const comparisons = collectAgentComparisons(data);
  if (comparisons.length === 0) return '';
  return [
    '<h2>Agent Comparison Runs</h2>',
    '<table>',
    '<thead><tr><th>Disabled agent</th><th>Baseline</th><th>Variant</th><th>Similarity</th><th>Recommendation</th></tr></thead>',
    '<tbody>',
    ...comparisons.map((comparison) => `<tr><td>${escapeHtml(comparison.disabledAgent)}</td><td>${comparison.baselineSuccess ? 'success' : 'failed'}</td><td>${comparison.variantSuccess ? 'success' : 'failed'}</td><td>${escapeHtml(formatPercent(comparison.finalSimilarity))}</td><td>${escapeHtml(comparison.recommendation)}</td></tr>`),
    '</tbody>',
    '</table>',
  ].join('\n');
}

function collectAgentComparisons(data: Record<string, unknown>): Array<{
  disabledAgent: string;
  baselineSuccess: boolean;
  variantSuccess: boolean;
  finalSimilarity: number;
  recommendation: string;
}> {
  const comparisons = Array.isArray(data['agentComparisons']) ? data['agentComparisons'].filter(isRecord) : [];
  return comparisons.map((comparison) => ({
    disabledAgent: String(comparison['disabledAgent'] ?? ''),
    baselineSuccess: comparison['baselineSuccess'] === true,
    variantSuccess: comparison['variantSuccess'] === true,
    finalSimilarity: Number(comparison['finalSimilarity'] ?? 0),
    recommendation: String(comparison['recommendation'] ?? ''),
  })).filter((comparison) => comparison.disabledAgent.length > 0);
}

function appendAgentContributions(lines: string[], data: Record<string, unknown>): void {
  const contributions = collectAgentContributions(data);
  if (contributions.length === 0) return;
  lines.push(
    '',
    '## Agent Contributions',
    '',
    'This section explains why each agent was useful, how it improved the result, and how to rerun the same prompt while disabling a role for comparison.',
    '',
    '| Agent | Steps | Status | Tasks | How it improved the result | Rerun without agent |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const contribution of contributions) {
    lines.push(
      `| ${cell(contribution.agent)} | ${cell(contribution.totalSteps)} | ${cell(contribution.status)} | ${cell(contribution.tasks.join('; '))} | ${cell(contribution.benefits.join(' '))} | ${cell(contribution.disableCommand ?? 'unavailable')} |`,
    );
  }
}

function appendPlainAgentContributions(lines: string[], data: Record<string, unknown>): void {
  const contributions = collectAgentContributions(data);
  if (contributions.length === 0) return;
  lines.push('Agent Contributions', '-------------------');
  for (const contribution of contributions) {
    lines.push(`- ${contribution.agent}: ${contribution.totalSteps} step(s), ${contribution.status}`);
    lines.push(`  Tasks: ${contribution.tasks.join('; ') || 'none recorded'}`);
    lines.push(`  Benefit: ${contribution.benefits.join(' ')}`);
    if (contribution.disableCommand) {
      lines.push(`  Compare by rerunning without it: ${contribution.disableCommand}`);
    }
  }
  lines.push('');
}

function renderHtmlAgentContributions(data: Record<string, unknown>): string {
  const contributions = collectAgentContributions(data);
  if (contributions.length === 0) return '';
  const rows = contributions.map((contribution) => [
    contribution.agent,
    contribution.totalSteps,
    contribution.status,
    contribution.tasks.join('; '),
    contribution.benefits.join(' '),
    contribution.disableCommand ?? 'unavailable',
  ]);
  return [
    '<h2>Agent Contributions</h2>',
    '<p>This section explains why each agent was useful, how it improved the result, and how to rerun the same prompt while disabling a role for comparison.</p>',
    '<table>',
    '<thead><tr><th>Agent</th><th>Steps</th><th>Status</th><th>Tasks</th><th>How it improved the result</th><th>Rerun without agent</th></tr></thead>',
    '<tbody>',
    ...rows.map((row) => `<tr>${row.map((cellValue) => `<td>${escapeHtml(String(cellValue ?? ''))}</td>`).join('')}</tr>`),
    '</tbody>',
    '</table>',
  ].join('\n');
}

function appendSelfOptimization(lines: string[], data: Record<string, unknown>): void {
  const contributions = collectAgentContributions(data);
  if (contributions.length === 0) return;
  lines.push('', '## Rerun and self-optimization', '');
  const base = getRerunCommand(data);
  if (base) {
    lines.push(`- Original rerun: \`${base}\``);
  }
  lines.push('- To test whether an agent is helping, rerun with `--disable-agent <agent-name>` and compare the final answer, errors, consensus diagnostics, and agent graph.');
  const candidates = contributions.filter((entry) => entry.selfOptimizationReason);
  if (candidates.length === 0) {
    lines.push('- Network self-check: no agent showed step-level failure or validation trouble in this run; keep the current network unless manual comparison shows lower quality or unnecessary cost.');
    return;
  }
  lines.push('- Network self-check candidates:');
  for (const candidate of candidates) {
    lines.push(`  - ${candidate.agent}: ${candidate.selfOptimizationReason}${candidate.disableCommand ? ` Try: \`${candidate.disableCommand}\`` : ''}`);
  }
}

function appendPlainSelfOptimization(lines: string[], data: Record<string, unknown>): void {
  const contributions = collectAgentContributions(data);
  if (contributions.length === 0) return;
  lines.push('Rerun and self-optimization', '---------------------------');
  const base = getRerunCommand(data);
  if (base) lines.push(`- Original rerun: ${base}`);
  lines.push('- To test whether an agent is helping, rerun with --disable-agent <agent-name> and compare the final answer, errors, consensus diagnostics, and agent graph.');
  const candidates = contributions.filter((entry) => entry.selfOptimizationReason);
  if (candidates.length === 0) {
    lines.push('- Network self-check: no agent showed step-level failure or validation trouble in this run; keep the current network unless manual comparison shows lower quality or unnecessary cost.', '');
    return;
  }
  for (const candidate of candidates) {
    lines.push(`- ${candidate.agent}: ${candidate.selfOptimizationReason}${candidate.disableCommand ? ` Try: ${candidate.disableCommand}` : ''}`);
  }
  lines.push('');
}

function renderHtmlSelfOptimization(data: Record<string, unknown>): string {
  const contributions = collectAgentContributions(data);
  if (contributions.length === 0) return '';
  const base = getRerunCommand(data);
  const candidates = contributions.filter((entry) => entry.selfOptimizationReason);
  const candidateLines = candidates.length === 0
    ? ['<li>Network self-check: no agent showed step-level failure or validation trouble in this run; keep the current network unless manual comparison shows lower quality or unnecessary cost.</li>']
    : candidates.map((candidate) =>
      `<li><strong>${escapeHtml(candidate.agent)}:</strong> ${escapeHtml(candidate.selfOptimizationReason ?? '')}${candidate.disableCommand ? ` Try: <code>${escapeHtml(candidate.disableCommand)}</code>` : ''}</li>`,
    );
  return [
    '<h2>Rerun and self-optimization</h2>',
    '<ul>',
    ...(base ? [`<li>Original rerun: <code>${escapeHtml(base)}</code></li>`] : []),
    '<li>To test whether an agent is helping, rerun with <code>--disable-agent &lt;agent-name&gt;</code> and compare the final answer, errors, consensus diagnostics, and agent graph.</li>',
    ...candidateLines,
    '</ul>',
  ].join('\n');
}

function collectAgentContributions(data: Record<string, unknown>): AgentContributionSummary[] {
  const steps = Array.isArray(data['steps']) ? data['steps'].filter(isRecord) : [];
  if (steps.length === 0) return [];
  const dag = buildRenderableDag(data);
  const dependents = new Map<string, string[]>();
  for (const edge of dag.edges) {
    const existing = dependents.get(edge.from) ?? [];
    existing.push(edge.to);
    dependents.set(edge.from, existing);
  }
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const step of steps) {
    const agent = String(step['agent'] ?? '').trim() || 'unknown';
    const existing = grouped.get(agent) ?? [];
    existing.push(step);
    grouped.set(agent, existing);
  }

  return [...grouped.entries()].map(([agent, agentSteps]) => {
    const completedSteps = agentSteps.filter((step) => step['status'] === 'completed').length;
    const failedSteps = agentSteps.filter((step) => step['status'] === 'failed').length;
    const recoveredSteps = agentSteps.filter((step) => step['status'] === 'recovered').length;
    const status = failedSteps > 0
      ? 'failed'
      : recoveredSteps > 0
        ? 'recovered'
        : completedSteps === agentSteps.length
          ? 'completed'
          : 'mixed';
    const tasks = uniqueStrings(agentSteps.map((step) => String(step['task'] ?? '').trim()).filter(Boolean));
    const benefits = inferAgentBenefits(agent, agentSteps, dependents);
    const evidence = agentSteps.map((step) => `${String(step['id'] ?? 'step')} ${String(step['status'] ?? 'unknown')}`);
    const disableCommand = buildDisableAgentCommand(data, agent);
    const selfOptimizationReason = inferSelfOptimizationReason(agentSteps);
    return {
      agent,
      steps: agentSteps,
      totalSteps: agentSteps.length,
      completedSteps,
      failedSteps,
      recoveredSteps,
      status,
      tasks,
      benefits,
      evidence,
      ...(disableCommand ? { disableCommand } : {}),
      ...(selfOptimizationReason ? { selfOptimizationReason } : {}),
    };
  });
}

function inferAgentBenefits(
  agent: string,
  steps: Record<string, unknown>[],
  dependents: Map<string, string[]>,
): string[] {
  const benefits: string[] = [];
  const completed = steps.filter((step) => step['status'] === 'completed' || step['status'] === 'recovered').length;
  if (completed > 0) {
    benefits.push(`Completed ${completed}/${steps.length} planned step${steps.length === 1 ? '' : 's'}.`);
  }
  const downstream = uniqueStrings(steps.flatMap((step) => dependents.get(String(step['id'] ?? '')) ?? []));
  if (downstream.length > 0) {
    benefits.push(`Prepared inputs for downstream step${downstream.length === 1 ? '' : 's'} (${downstream.join(', ')}).`);
  } else if (completed > 0) {
    benefits.push('Contributed terminal output or validation evidence.');
  }
  const outputTypes = uniqueStrings(steps.map((step) => String(step['outputType'] ?? '')).filter(Boolean));
  for (const outputType of outputTypes) {
    benefits.push(outputTypeBenefit(outputType));
  }
  if (steps.some((step) => step['handoffPassed'] === true)) {
    benefits.push('Handoff validation passed, reducing downstream loss or distortion.');
  }
  if (steps.some((step) => isRecord(step['specConformance']) && step['specConformance']['passed'] === true)) {
    benefits.push('Spec conformance passed against reviewed criteria.');
  }
  const consensus = steps
    .map((step) => isRecord(step['consensus']) ? step['consensus'] : undefined)
    .filter((entry): entry is Record<string, unknown> => entry !== undefined);
  if (consensus.length > 0) {
    const avgAgreement = consensus.reduce((sum, entry) => sum + Number(entry['agreement'] ?? 0), 0) / consensus.length;
    benefits.push(`Consensus improved confidence (${formatPercent(avgAgreement)} average agreement).`);
  }
  if (steps.some((step) => step['status'] === 'failed')) {
    benefits.push('The run exposed a weak or blocked role that the network can question before future reruns.');
  }
  if (benefits.length === 0) {
    benefits.push(defaultAgentBenefit(agent));
  }
  return uniqueStrings(benefits);
}

function outputTypeBenefit(outputType: string): string {
  switch (outputType) {
    case 'data':
      return 'Produced structured data for deterministic downstream use.';
    case 'files':
      return 'Produced file changes or artifacts instead of prose-only guidance.';
    case 'presentation':
      return 'Produced presentation-ready deliverables.';
    case 'answer':
      return 'Produced analysis or review text for downstream synthesis.';
    default:
      return `Produced ${outputType} output.`;
  }
}

function defaultAgentBenefit(agent: string): string {
  if (agent.includes('grammar')) return 'Improved readability while preserving technical meaning.';
  if (agent.includes('research')) return 'Added evidence, context, or fact-checking to reduce hallucination risk.';
  if (agent.includes('judge') || agent.includes('review')) return 'Questioned candidate quality before final selection.';
  if (agent.includes('test') || agent.includes('qa')) return 'Checked correctness and regression risk.';
  if (agent.includes('coder') || agent.includes('build')) return 'Moved the result from plan to executable implementation.';
  return 'Contributed a specialized role in the agent network.';
}

function inferSelfOptimizationReason(steps: Record<string, unknown>[]): string | undefined {
  const failed = steps.filter((step) => step['status'] === 'failed');
  if (failed.length > 0) {
    const firstMessage = failed
      .map((step) => String(step['error'] ?? step['reason'] ?? '').trim())
      .filter(Boolean)[0];
    return `failed ${failed.length}/${steps.length} step${steps.length === 1 ? '' : 's'}${firstMessage ? ` (${firstMessage})` : ''}`;
  }
  const handoffFailed = steps.find((step) => step['handoffPassed'] === false);
  if (handoffFailed) {
    return 'failed handoff validation, so compare a rerun without this role or with a replacement';
  }
  const specFailed = steps.find((step) => isRecord(step['specConformance']) && step['specConformance']['passed'] === false);
  if (specFailed) {
    return 'missed reviewed spec criteria, so the network should question this role before reusing it';
  }
  return undefined;
}

function buildDisableAgentCommand(data: Record<string, unknown>, agent: string): string | undefined {
  const command = getRerunCommand(data);
  if (!command) return undefined;
  return `${command} --disable-agent ${agent}`;
}

function getRerunCommand(data: Record<string, unknown>): string | undefined {
  const rerun = isRecord(data['rerun']) ? data['rerun'] : undefined;
  const command = typeof rerun?.['command'] === 'string' ? rerun['command'].trim() : '';
  return command || undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function appendPlainGraph(lines: string[], data: Record<string, unknown>): void {
  const graph = buildSimplifiedGraph(data);
  if (graph.length === 0) return;

  lines.push('Agent Graph', '-----------');
  lines.push(...graph, '');
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
  const dag = buildRenderableDag(data);
  if (dag.nodes.length > 0) return renderSimplifiedGraph(dag);

  const steps = Array.isArray(data['steps']) ? data['steps'].filter(isRecord) : [];
  if (steps.length === 0) return [];
  return [steps.map((step) => {
    const id = String(step['id'] ?? '').trim();
    const agent = String(step['agent'] ?? '').trim();
    return agent ? `${id} [${agent}]` : id;
  }).join(' -> ')];
}

function buildRenderableDag(data: Record<string, unknown>): DAGResult {
  const dag = isRecord(data['dag']) ? data['dag'] : undefined;
  const nodes = Array.isArray(dag?.['nodes']) ? dag['nodes'].filter(isRecord) : [];
  const edges = Array.isArray(dag?.['edges']) ? dag['edges'].filter(isRecord) : [];
  const steps = Array.isArray(data['steps']) ? data['steps'].filter(isRecord) : [];
  const stepById = new Map(steps.map((step) => [String(step['id'] ?? ''), step]));

  return {
    nodes: nodes.map((node) => {
      const id = String(node['id'] ?? '');
      const step = stepById.get(id);
      const consensus = normalizeNodeConsensus(isRecord(node['consensus']) ? node['consensus'] : isRecord(step?.['consensus']) ? step['consensus'] : undefined);
      return {
        id,
        agent: String(node['agent'] ?? step?.['agent'] ?? ''),
        provider: typeof node['provider'] === 'string' ? node['provider'] : typeof step?.['provider'] === 'string' ? step['provider'] : undefined,
        model: typeof node['model'] === 'string' ? node['model'] : typeof step?.['model'] === 'string' ? step['model'] : undefined,
        status: String(node['status'] ?? step?.['status'] ?? ''),
        duration: typeof node['duration'] === 'number' ? node['duration'] : typeof step?.['duration'] === 'number' ? step['duration'] : 0,
        ...(node['final'] === true ? { final: true } : {}),
        ...(consensus ? { consensus } : {}),
      };
    }),
    edges: edges.map((edge) => ({
      from: String(edge['from'] ?? ''),
      to: String(edge['to'] ?? ''),
      type: edge['type'] === 'handoff' || edge['type'] === 'recovery' || edge['type'] === 'spawned' || edge['type'] === 'feedback'
        ? edge['type']
        : 'planned',
    })),
  };
}

function normalizeNodeConsensus(value: Record<string, unknown> | undefined): DAGNodeConsensus | undefined {
  if (!value) return undefined;
  const method = String(value['method'] ?? 'exact-majority');
  if (method !== 'exact-majority' && method !== 'medoid-token-similarity' && method !== 'worktree-best-passing-diff') return undefined;
  return {
    enabled: value['enabled'] !== false,
    runs: typeof value['runs'] === 'number' ? value['runs'] : Number(value['runs'] ?? 0),
    candidateCount: typeof value['candidateCount'] === 'number' ? value['candidateCount'] : Number(value['candidateCount'] ?? value['runs'] ?? 0),
    selectedRun: typeof value['selectedRun'] === 'number' ? value['selectedRun'] : Number(value['selectedRun'] ?? 0),
    agreement: typeof value['agreement'] === 'number' ? value['agreement'] : Number(value['agreement'] ?? 0),
    method,
    ...(value['isolation'] === 'git-worktree' ? { isolation: 'git-worktree' as const } : {}),
    ...(typeof value['verificationPassed'] === 'boolean' ? { verificationPassed: value['verificationPassed'] } : {}),
    ...(Array.isArray(value['changedFiles']) ? { changedFiles: value['changedFiles'].filter((file): file is string => typeof file === 'string') } : {}),
    ...(Array.isArray(value['participants']) ? { participants: value['participants'].filter(isRecord).map(normalizeConsensusParticipant) } : {}),
  };
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

function normalizeConsensusParticipant(value: Record<string, unknown>): ConsensusParticipant {
  return {
    run: typeof value['run'] === 'number' ? value['run'] : Number(value['run'] ?? 0),
    ...(typeof value['provider'] === 'string' ? { provider: value['provider'] } : {}),
    ...(typeof value['model'] === 'string' ? { model: value['model'] } : {}),
    status: value['status'] === 'selected' || value['status'] === 'contributed' || value['status'] === 'valid' || value['status'] === 'rejected' || value['status'] === 'failed'
      ? value['status']
      : 'valid',
    contribution: typeof value['contribution'] === 'number' ? value['contribution'] : Number(value['contribution'] ?? 0),
    ...(typeof value['detail'] === 'string' ? { detail: value['detail'] } : {}),
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
  if (combined) return appendFactCheckVerification(data, normalizeUsageReportTables(combined));
  const final = extractFinalResult(data);
  return final ? appendFactCheckVerification(data, normalizeUsageReportTables(final)) : null;
}

function appendFactCheckVerification(data: Record<string, unknown>, final: string): string {
  const factChecks = collectFactCheckOutputs(data);
  if (factChecks.length === 0) return final;
  return `${final}\n\n---\n\n## Fact-check Verification\n\n${factChecks.join('\n\n')}`;
}

function normalizeUsageReportTables(markdown: string): string {
  return normalizeUsageTreeRowIdentifiers(addMissingLcbRowsToCommonnessRanking(markdown));
}

interface LcbExposureRow {
  category: string;
  examples: string;
  caveat: string;
}

function addMissingLcbRowsToCommonnessRanking(markdown: string): string {
  const reportedScenarios = dedupeLcbExposureRows([
    ...extractPositiveLcbExposureRows(markdown),
    ...extractUsageTreeScenarioRows(markdown),
  ]);
  if (reportedScenarios.length === 0) return markdown;

  const lines = markdown.split('\n');
  const headingIndex = lines.findIndex((line) => /^##\s+Usage Commonness Ranking\s*$/i.test(line.trim()));
  if (headingIndex < 0) return markdown;

  const tableStart = findNextTableLine(lines, headingIndex + 1);
  if (tableStart < 0 || tableStart + 1 >= lines.length) return markdown;
  const header = parseMarkdownTableCells(lines[tableStart]!);
  if (header.length === 0 || !isMarkdownSeparatorRow(lines[tableStart + 1]!)) return markdown;

  let tableEnd = tableStart + 2;
  while (tableEnd < lines.length && parseMarkdownTableCells(lines[tableEnd]!).length > 0) {
    tableEnd += 1;
  }

  const bodyRows = lines.slice(tableStart + 2, tableEnd).map(parseMarkdownTableCells).filter((row) => row.length > 0);
  const usageIndex = header.findIndex((cell) => /usage|application|exposure origin/i.test(cell));
  if (usageIndex < 0) return markdown;

  const representedScenarios = bodyRows
    .map((row) => row[usageIndex] ?? '')
    .filter(Boolean);
  const missingRows = reportedScenarios.filter((row) =>
    !isUsageScenarioRepresented(row.examples || row.category, representedScenarios),
  );
  if (missingRows.length === 0) return markdown;

  const rankIndex = header.findIndex((cell) => /^rank$/i.test(cell));
  const nextRankStart = nextCommonnessRank(bodyRows, rankIndex);
  const appended = missingRows.map((row, index) =>
    formatMarkdownTableRow(buildMissingCommonnessCells({
      header,
      lcb: row,
      rank: nextRankStart + index,
    })),
  );

  return [
    ...lines.slice(0, tableEnd),
    ...appended,
    ...lines.slice(tableEnd),
  ].join('\n');
}

function extractPositiveLcbExposureRows(markdown: string): LcbExposureRow[] {
  const lines = markdown.split('\n');
  const headingIndex = lines.findIndex((line) => /^##\s+LCB Exposure Summary\s*$/i.test(line.trim()));
  if (headingIndex < 0) return [];
  const tableStart = findNextTableLine(lines, headingIndex + 1);
  if (tableStart < 0 || tableStart + 1 >= lines.length) return [];
  const header = parseMarkdownTableCells(lines[tableStart]!);
  if (header.length === 0 || !isMarkdownSeparatorRow(lines[tableStart + 1]!)) return [];

  const categoryIndex = header.findIndex((cell) => /category/i.test(cell));
  const applicableIndex = header.findIndex((cell) => /applicable|classification|yes/i.test(cell));
  const examplesIndex = header.findIndex((cell) => /example/i.test(cell));
  const caveatIndex = header.findIndex((cell) => /evidence|caveat/i.test(cell));
  if (categoryIndex < 0 || applicableIndex < 0) return [];

  const rows: LcbExposureRow[] = [];
  for (let index = tableStart + 2; index < lines.length; index += 1) {
    const cells = parseMarkdownTableCells(lines[index]!);
    if (cells.length === 0) break;
    const applicable = (cells[applicableIndex] ?? '').trim().toLowerCase();
    if (applicable !== 'yes') continue;
    const category = (cells[categoryIndex] ?? '').trim();
    if (!category) continue;
    const examples = splitUsageScenarios(examplesIndex >= 0 ? (cells[examplesIndex] ?? '').trim() : '');
    const scenarios = examples.length > 0 ? examples : [category];
    for (const scenario of scenarios) {
      rows.push({
        category,
        examples: scenario,
        caveat: caveatIndex >= 0 ? (cells[caveatIndex] ?? '').trim() : '',
      });
    }
  }
  return rows;
}

function extractUsageTreeScenarioRows(markdown: string): LcbExposureRow[] {
  const lines = markdown.split('\n');
  const headingIndex = lines.findIndex((line) => /^##\s+Usage Tree\s*$/i.test(line.trim()));
  if (headingIndex < 0) return [];
  const tableStart = findNextTableLine(lines, headingIndex + 1);
  if (tableStart < 0 || tableStart + 1 >= lines.length) return [];
  const header = parseMarkdownTableCells(lines[tableStart]!);
  if (header.length === 0 || !isMarkdownSeparatorRow(lines[tableStart + 1]!)) return [];

  const levelIndex = header.findIndex((cell) => /level/i.test(cell));
  const classificationIndex = header.findIndex((cell) => /usage|classification/i.test(cell));
  if (levelIndex < 0 || classificationIndex < 0) return [];

  const rows: LcbExposureRow[] = [];
  for (let index = tableStart + 2; index < lines.length; index += 1) {
    const cells = parseMarkdownTableCells(lines[index]!);
    if (cells.length === 0) break;
    const level = usageTreeDepth(cells[levelIndex] ?? '');
    if (level === undefined || level < 3) continue;
    const scenario = (cells[classificationIndex] ?? '').trim();
    if (!meaningfulLcbValue(scenario)) continue;
    rows.push({
      category: inferUsageScenarioCategory(scenario),
      examples: scenario,
      caveat: 'reported in Usage Tree',
    });
  }
  return rows;
}

function splitUsageScenarios(value: string): string[] {
  if (!meaningfulLcbValue(value)) return [];
  return value
    .split(/\s*;\s*/)
    .map((entry) => entry.trim())
    .filter(meaningfulLcbValue);
}

function usageTreeDepth(value: string): number | undefined {
  const match = /\bLevel\s+(\d+)/i.exec(value);
  if (!match) return undefined;
  const depth = Number.parseInt(match[1]!, 10);
  return Number.isFinite(depth) ? depth : undefined;
}

function inferUsageScenarioCategory(scenario: string): string {
  const normalized = normalizeScenarioText(scenario);
  if (/\b(toxicology|forensic|screening|biomarker|metabolite|monitoring|benzoylecgonine)\b/.test(normalized)) {
    return 'other exposure origins';
  }
  if (/\b(anesthesia|anaesthesia|surgery|diagnostic|clinical pharmacology|vasoconstrict)\b/.test(normalized)) {
    return 'drug / drug metabolite';
  }
  return 'usage tree';
}

function dedupeLcbExposureRows(rows: LcbExposureRow[]): LcbExposureRow[] {
  const seen = new Set<string>();
  const result: LcbExposureRow[] = [];
  for (const row of rows) {
    const key = `${normalizeLcbCategory(row.category)}:${normalizeScenarioText(row.examples || row.category)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

function buildMissingCommonnessCells(options: {
  header: string[];
  lcb: LcbExposureRow;
  rank: number;
}): string[] {
  const cells = options.header.map(() => 'unavailable');
  const set = (pattern: RegExp, value: string) => {
    const index = options.header.findIndex((cell) => pattern.test(cell));
    if (index >= 0) cells[index] = value;
  };
  const origin = meaningfulLcbValue(options.lcb.examples) ? options.lcb.examples : options.lcb.category;
  const caveat = [
    meaningfulLcbValue(options.lcb.caveat) ? options.lcb.caveat : '',
    'reported usage scenario; commonness scoring evidence unavailable',
  ].filter(Boolean).join('; ');

  set(/^rank$/i, String(options.rank));
  set(/usage|application|exposure origin/i, origin);
  set(/category/i, options.lcb.category);
  set(/commonness score/i, 'unavailable');
  set(/commonness label/i, 'unavailable');
  set(/timeframe/i, 'unavailable');
  set(/recency|currentness/i, 'reported usage scenario; commonness scoring evidence unavailable');
  set(/^evidence\s*\/?\s*caveat$/i, caveat);
  return cells;
}

function meaningfulLcbValue(value: string): boolean {
  return value.trim().length > 0 && !/^unavailable$/i.test(value.trim());
}

function nextCommonnessRank(rows: string[][], rankIndex: number): number {
  if (rankIndex < 0) return rows.length + 1;
  const ranks = rows
    .map((row) => Number.parseInt(row[rankIndex] ?? '', 10))
    .filter((rank) => Number.isFinite(rank));
  return ranks.length === 0 ? rows.length + 1 : Math.max(...ranks) + 1;
}

function normalizeLcbCategory(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!normalized) return '';
  if (/\bdrug\b|\bmetabolite\b/.test(normalized) && !/\bfood\b/.test(normalized)) return 'drug-metabolite';
  if (/\bfood\b/.test(normalized)) return 'food';
  if (/\bhousehold\b/.test(normalized)) return 'household';
  if (/\bindustrial\b/.test(normalized)) return 'industrial';
  if (/\bpesticide\b/.test(normalized)) return 'pesticide';
  if (/\bpersonal\b|\bcare\b|\bcosmetic\b/.test(normalized)) return 'personal-care';
  if (/\bother\b|\bexposure\b|\bforensic\b|\bworkplace\b/.test(normalized)) return 'other-exposure';
  if (/\bcellular\b|\bendogenous\b/.test(normalized)) return 'endogenous';
  return normalized;
}

function isUsageScenarioRepresented(scenario: string, representedScenarios: string[]): boolean {
  const normalizedScenario = normalizeScenarioText(scenario);
  if (!normalizedScenario) return true;
  return representedScenarios.some((candidate) => {
    const normalizedCandidate = normalizeScenarioText(candidate);
    return normalizedCandidate.includes(normalizedScenario) ||
      normalizedScenario.includes(normalizedCandidate);
  });
}

function normalizeScenarioText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bent\b/g, 'otorhinolaryngological')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bunavailable\b/g, '')
    .trim();
}

function findNextTableLine(lines: string[], start: number): number {
  for (let index = start; index < lines.length; index += 1) {
    if (parseMarkdownTableCells(lines[index]!).length > 0) return index;
    if (/^##\s+\S/.test(lines[index]!.trim())) return -1;
  }
  return -1;
}

function parseMarkdownTableCells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return [];
  return trimmed.slice(1, -1).split('|').map((cell) => cell.trim());
}

function isMarkdownSeparatorRow(line: string): boolean {
  const cells = parseMarkdownTableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function formatMarkdownTableRow(cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function normalizeUsageTreeRowIdentifiers(markdown: string): string {
  const lines = markdown.split('\n');
  const result: string[] = [];
  let section: string[] = [];
  let inUsageTree = false;

  const flushSection = () => {
    if (section.length === 0) return;
    result.push(...dedupeUsageTreeSectionRows(section));
    section = [];
  };

  for (const line of lines) {
    if (/^##\s+Usage Tree\s*$/i.test(line.trim())) {
      flushSection();
      inUsageTree = true;
      section.push(line);
      continue;
    }
    if (inUsageTree && /^##\s+\S/.test(line.trim())) {
      flushSection();
      inUsageTree = false;
      result.push(line);
      continue;
    }
    if (inUsageTree) {
      section.push(line);
    } else {
      result.push(line);
    }
  }
  flushSection();

  return result.join('\n');
}

function dedupeUsageTreeSectionRows(lines: string[]): string[] {
  const identifiers = lines
    .map((line) => parseUsageTreeRowIdentifier(line)?.identifier)
    .filter((identifier): identifier is string => Boolean(identifier));
  const totals = identifiers.reduce((counts, identifier) => {
    counts.set(identifier, (counts.get(identifier) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  if (![...totals.values()].some((count) => count > 1)) return lines;

  const seen = new Map<string, number>();
  return lines.map((line) => {
    const parsed = parseUsageTreeRowIdentifier(line);
    if (!parsed || (totals.get(parsed.identifier) ?? 0) < 2) return line;
    const occurrence = (seen.get(parsed.identifier) ?? 0) + 1;
    seen.set(parsed.identifier, occurrence);
    const uniqueIdentifier = `${parsed.identifier}.${occurrence}`;
    const cells = [...parsed.cells];
    cells[0] = uniqueIdentifier;
    return `${parsed.leading}| ${cells.join(' | ')} |${parsed.trailing}`;
  });
}

function parseUsageTreeRowIdentifier(line: string): {
  identifier: string;
  cells: string[];
  leading: string;
  trailing: string;
} | null {
  const match = /^(\s*)\|(.*)\|(\s*)$/.exec(line);
  if (!match) return null;
  const cells = match[2]!
    .split('|')
    .map((cell) => cell.trim());
  const firstCell = cells[0] ?? '';
  if (!/^Level\s+\d+$/i.test(firstCell)) return null;
  return {
    identifier: firstCell,
    cells,
    leading: match[1] ?? '',
    trailing: match[3] ?? '',
  };
}

function collectFactCheckOutputs(data: Record<string, unknown>): string[] {
  const steps = Array.isArray(data['steps']) ? data['steps'].filter(isRecord) : [];
  return steps
    .filter((step) => {
      const agent = String(step['agent'] ?? '');
      return (agent === 'usage-classification-fact-checker' || agent === 'research-fact-checker') &&
        (step['status'] === 'completed' || step['status'] === 'recovered');
    })
    .map((step) => usableStepOutput(step))
    .filter((output): output is string => Boolean(output));
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
