import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DAG_RENDER_LAYOUTS, buildDAGLayout, formatConsensusHeadline, formatNodeRuntime, resolveDAGRenderLayout } from '../dag/graph-renderer.js';
import type { DAGRenderLayout } from '../dag/graph-renderer.js';
import type { ConsensusParticipant, DAGNodeConsensus, DAGResult } from '../types/dag.js';

const execFileAsync = promisify(execFile);

export type ReportArtifactKind = 'flowchart' | 'plot' | 'diagram' | 'image' | 'other';

export interface ReportArtifact {
  id: string;
  kind: ReportArtifactKind;
  path: string;
  src: string;
  mimeType: string;
  format: string;
  title: string;
  description: string;
  deterministic: boolean;
  producerStepId?: string;
  producerAgent?: string;
  sourceStepIds: string[];
}

export interface ReportArtifactManifest {
  version: 1;
  manifestPath: string;
  artifacts: ReportArtifact[];
}

export interface GraphPngArtifactManifest extends ReportArtifactManifest {
  warnings: string[];
}

export async function createReportVisualArtifacts(
  result: unknown,
  options: { outputDir: string; dagLayout?: DAGRenderLayout },
): Promise<ReportArtifactManifest> {
  const outputDir = path.resolve(options.outputDir);
  const artifactsDir = outputDir;
  await fs.mkdir(artifactsDir, { recursive: true });

  const data = isRecord(result) ? result : { result };
  const artifacts: ReportArtifact[] = [];

  const agentNetwork = buildAgentNetworkSvg(data, options.dagLayout ?? 'auto');
  if (agentNetwork) {
    artifacts.push(await writeSvgArtifact({
      artifactsDir,
      outputDir,
      id: 'agent-network',
      kind: 'flowchart',
      title: 'Agent Network',
      description: 'Executed MAP agent flowchart generated from the runtime DAG.',
      svg: agentNetwork.svg,
      sourceStepIds: agentNetwork.sourceStepIds,
    }));
  }

  const commonness = buildUsageCommonnessSvg(data);
  if (commonness) {
    artifacts.push(await writeSvgArtifact({
      artifactsDir,
      outputDir,
      id: 'usage-commonness-ranking',
      kind: 'plot',
      title: 'Usage Commonness Ranking',
      description: 'Usage applications or exposure origins sorted by commonness score.',
      svg: commonness.svg,
      sourceStepIds: commonness.sourceStepIds,
      producerStepId: commonness.producerStepId,
      producerAgent: commonness.producerAgent,
    }));
  }

  const taxonomy = buildTaxonomyTreeSvg(data);
  if (taxonomy) {
    artifacts.push(await writeSvgArtifact({
      artifactsDir,
      outputDir,
      id: 'taxonomy-tree',
      kind: 'diagram',
      title: 'Taxonomy Tree',
      description: 'ClassyFire/ChemOnt taxonomy hierarchy rendered as a deterministic diagram.',
      svg: taxonomy.svg,
      sourceStepIds: taxonomy.sourceStepIds,
      producerStepId: taxonomy.producerStepId,
      producerAgent: taxonomy.producerAgent,
    }));
  }

  const manifestPath = path.join(artifactsDir, 'manifest.json');
  const manifest: ReportArtifactManifest = { version: 1, manifestPath, artifacts };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

export async function createAgentGraphPngArtifacts(
  result: unknown,
  options: { outputDir: string; renderPng?: boolean } ,
): Promise<GraphPngArtifactManifest> {
  const outputDir = path.resolve(options.outputDir);
  const artifactsDir = outputDir;
  await fs.mkdir(artifactsDir, { recursive: true });

  const data = isRecord(result) ? result : { result };
  const warnings: string[] = [];
  const artifacts: ReportArtifact[] = [];
  const shouldRenderPng = options.renderPng !== false;
  const browser = shouldRenderPng ? await findHeadlessBrowser() : null;

  if (!shouldRenderPng) {
    warnings.push('PNG rendering disabled; wrote SVG graph artifacts instead.');
  } else if (!browser) {
    warnings.push('No Chrome/Chromium-compatible browser was found; wrote SVG graph artifacts instead.');
  }

  for (const layout of DAG_RENDER_LAYOUTS) {
    const graph = buildAgentNetworkSvg(data, layout);
    if (!graph) continue;
    const id = `agent-network-${layout}`;
    const svgPath = path.join(artifactsDir, `${id}.svg`);
    const svg = sanitizeSvg(graph.svg);
    await fs.writeFile(svgPath, svg, 'utf8');

    if (browser && shouldRenderPng) {
      const pngPath = path.join(artifactsDir, `${id}.png`);
      try {
        await renderSvgToPng({ browser, svgPath, pngPath, svg });
        artifacts.push({
          id,
          kind: 'flowchart',
          path: pngPath,
          src: `${id}.png`,
          mimeType: 'image/png',
          format: 'png',
          title: `Agent Network (${layout})`,
          description: `Executed MAP agent flowchart rendered with the ${layout} layout.`,
          deterministic: true,
          sourceStepIds: graph.sourceStepIds,
        });
        continue;
      } catch (error) {
        warnings.push(`PNG rendering failed for ${layout}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    artifacts.push({
      id,
      kind: 'flowchart',
      path: svgPath,
      src: `${id}.svg`,
      mimeType: 'image/svg+xml',
      format: 'svg',
      title: `Agent Network (${layout})`,
      description: `Executed MAP agent flowchart rendered with the ${layout} layout.`,
      deterministic: true,
      sourceStepIds: graph.sourceStepIds,
    });
  }

  const manifestPath = path.join(artifactsDir, 'agent-graph-manifest.json');
  const manifest: GraphPngArtifactManifest = { version: 1, manifestPath, artifacts, warnings };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

async function renderSvgToPng(options: {
  browser: string;
  svgPath: string;
  pngPath: string;
  svg: string;
}): Promise<void> {
  const size = parseSvgSize(options.svg);
  const htmlPath = options.svgPath.replace(/\.svg$/i, '.html');
  const html = [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<style>html,body{margin:0;background:#f8fbff;}img{display:block;width:100vw;height:100vh;object-fit:contain;}</style>',
    '</head><body>',
    `<img src="${path.basename(options.svgPath).replace(/"/g, '&quot;')}" alt="Agent graph">`,
    '</body></html>',
  ].join('');
  await fs.writeFile(htmlPath, html, 'utf8');
  await execFileAsync(options.browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--window-size=${size.width},${size.height}`,
    `--screenshot=${options.pngPath}`,
    fileUrl(htmlPath),
  ], { timeout: 60_000, maxBuffer: 1024 * 1024 });
}

function parseSvgSize(svg: string): { width: number; height: number } {
  const width = Number(svg.match(/\bwidth="(\d+)"/)?.[1] ?? 1200);
  const height = Number(svg.match(/\bheight="(\d+)"/)?.[1] ?? 800);
  return {
    width: Math.max(320, Math.min(3000, width)),
    height: Math.max(240, Math.min(2400, height)),
  };
}

async function findHeadlessBrowser(): Promise<string | null> {
  const candidates = [
    process.env['MAP_GRAPH_BROWSER'],
    process.env['MAP_PDF_BROWSER'],
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    'microsoft-edge',
  ].filter((candidate): candidate is string => Boolean(candidate && candidate.trim()));

  for (const candidate of candidates) {
    if (candidate.includes(path.sep)) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        continue;
      }
    }
    try {
      const command = process.platform === 'win32' ? 'where' : 'which';
      const { stdout } = await execFileAsync(command, [candidate], { timeout: 3_000 });
      const resolved = stdout.trim().split(/\r?\n/)[0];
      if (resolved) return resolved;
    } catch {
      continue;
    }
  }
  return null;
}

function fileUrl(filePath: string): string {
  return `file://${filePath.split(path.sep).map(encodeURIComponent).join('/')}`;
}

async function writeSvgArtifact(options: {
  artifactsDir: string;
  outputDir: string;
  id: string;
  kind: ReportArtifactKind;
  title: string;
  description: string;
  svg: string;
  sourceStepIds: string[];
  producerStepId?: string;
  producerAgent?: string;
}): Promise<ReportArtifact> {
  const filename = `${options.id}.svg`;
  const filePath = path.join(options.artifactsDir, filename);
  await fs.writeFile(filePath, sanitizeSvg(options.svg), 'utf8');
  return {
    id: options.id,
    kind: options.kind,
    path: filePath,
    src: filename,
    mimeType: 'image/svg+xml',
    format: 'svg',
    title: options.title,
    description: options.description,
    deterministic: true,
    ...(options.producerStepId ? { producerStepId: options.producerStepId } : {}),
    ...(options.producerAgent ? { producerAgent: options.producerAgent } : {}),
    sourceStepIds: options.sourceStepIds,
  };
}

function buildAgentNetworkSvg(data: Record<string, unknown>, requestedLayout: DAGRenderLayout): { svg: string; sourceStepIds: string[] } | null {
  const dag = buildRenderableDag(data);
  if (dag.nodes.length === 0) return null;

  const resolvedLayout = resolveDAGRenderLayout(dag, requestedLayout);
  if (resolvedLayout === 'matrix') return buildAgentMatrixSvg(dag);
  if (resolvedLayout === 'metro') return buildAgentMetroSvg(dag);
  if (resolvedLayout === 'cluster') return buildAgentClusterSvg(dag);
  if (resolvedLayout === 'circular') return buildAgentCircularSvg(dag);

  const layout = buildDAGLayout(dag);
  if (layout.layers.length === 0) return null;

  const nodeWidth = 248;
  const stageGap = 34;
  const nodeGap = 18;
  const margin = 24;
  const headerHeight = 56;
  const stageWidth = nodeWidth + 34;
  const nodeHeight = (node: DAGResult['nodes'][number]) => 100 + Math.min(node.consensus?.participants?.length ?? 0, 3) * 17;
  const layerHeights = layout.layers.map((layer) => {
    const totalNodes = layer.nodes.reduce((sum, entry) => sum + nodeHeight(entry.node), 0);
    return headerHeight + totalNodes + Math.max(0, layer.nodes.length - 1) * nodeGap + 24;
  });
  const width = Math.max(360, margin * 2 + layout.layers.length * stageWidth + Math.max(0, layout.layers.length - 1) * stageGap);
  const height = Math.max(180, margin * 2 + Math.max(...layerHeights));
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();

  const statusColor = (status: string) => ({
    completed: '#22c55e',
    recovered: '#22c55e',
    failed: '#ef4444',
    skipped: '#f59e0b',
    pending: '#94a3b8',
    running: '#3b82f6',
  }[status] ?? '#64748b');

  const stageBackground = (mode: string) => mode === 'concurrent' ? '#eff6ff' : '#faf5ff';
  const stageStroke = (mode: string) => mode === 'concurrent' ? '#93c5fd' : '#c4b5fd';
  const edgeColor = (type: string) => ({
    planned: '#8db5ec',
    handoff: '#a78bfa',
    recovery: '#ef4444',
    spawned: '#f59e0b',
  }[type] ?? '#8db5ec');

  const stageBodies = layout.layers.map((layer, layerPosition) => {
    const stageX = margin + layerPosition * (stageWidth + stageGap);
    const stageY = margin + 32;
    let cursorY = stageY + headerHeight;
    const stageHeight = layerHeights[layerPosition] ?? 0;
    const cards = layer.nodes.map((entry) => {
      const node = entry.node;
      const cardHeight = nodeHeight(node);
      const x = stageX + 17;
      const y = cursorY;
      cursorY += cardHeight + nodeGap;
      positions.set(node.id, { x, y, width: nodeWidth, height: cardHeight });
      const status = String(node.status ?? 'pending').toLowerCase();
      const runtime = formatNodeRuntime(node);
      const meta = [status, runtime].filter(Boolean).join(' | ');
      const inputText = entry.inputs.length > 0 ? `inputs: ${entry.inputs.join(', ')}` : 'inputs: none';
      const consensus = node.consensus ? [
        `<text x="${x + 18}" y="${y + 78}" font-size="11" font-weight="700" fill="#334155">${escapeXml(`Consensus ${formatConsensusHeadline(node.consensus)}`)}</text>`,
        ...(node.consensus.participants ?? []).slice(0, 3).map((participant, index) =>
          `<text x="${x + 18}" y="${y + 95 + index * 17}" font-size="10" fill="#475569">${escapeXml(formatSvgConsensusParticipant(participant))}</text>`),
      ].join('') : '';
      return [
        `<rect x="${x}" y="${y}" width="${nodeWidth}" height="${cardHeight}" rx="14" fill="#ffffff" stroke="#bfd0e4"/>`,
        `<rect x="${x}" y="${y}" width="8" height="${cardHeight}" rx="4" fill="${statusColor(status)}"/>`,
        `<text x="${x + 18}" y="${y + 24}" font-size="12" fill="#64748b" font-family="ui-monospace, monospace">${escapeXml(node.id)}</text>`,
        `<text x="${x + 18}" y="${y + 45}" font-size="14" font-weight="700" fill="#1e293b">${escapeXml(truncate(node.agent, 28))}</text>`,
        `<text x="${x + 18}" y="${y + 62}" font-size="11" fill="#475569">${escapeXml(meta)}</text>`,
        `<text x="${x + 18}" y="${y + cardHeight - 12}" font-size="10" fill="#64748b">${escapeXml(truncate(inputText, 36))}</text>`,
        consensus,
      ].join('');
    }).join('');

    return [
      `<rect x="${stageX}" y="${stageY}" width="${stageWidth}" height="${stageHeight}" rx="18" fill="${stageBackground(layer.mode)}" stroke="${stageStroke(layer.mode)}"/>`,
      `<text x="${stageX + 16}" y="${stageY + 25}" font-size="13" font-weight="800" fill="#334155">${escapeXml(`Stage ${layer.index + 1} ${layer.mode}`)}</text>`,
      `<text x="${stageX + 16}" y="${stageY + 43}" font-size="10" fill="#64748b">${layer.mode === 'concurrent' ? 'ready together' : 'dependency sequence'}</text>`,
      cards,
    ].join('');
  }).join('');

  const arrows = layout.edges.map((edge, index) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return '';
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    const x2 = to.x;
    const y2 = to.y + to.height / 2;
    const mid = Math.max(14, (x2 - x1) / 2);
    const color = edgeColor(edge.type);
    const markerId = `arrow-${index}`;
    return [
      `<defs><marker id="${markerId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/></marker></defs>`,
      `<path d="M ${x1 + 4} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2 - 6} ${y2}" fill="none" stroke="${color}" stroke-width="2.5" marker-end="url(#${markerId})"><title>${escapeXml(`${edge.from} to ${edge.to}`)}</title></path>`,
      `<text x="${Math.round((x1 + x2) / 2) - 20}" y="${Math.round((y1 + y2) / 2) - 6}" font-size="9" fill="#475569">${escapeXml(edge.type)}</text>`,
    ].join('');
  }).join('');

  const sourceStepIds = dag.nodes.map((node) => node.id).filter(Boolean);
  return {
    sourceStepIds,
    svg: svgShell(width, height, 'Agent Network', `
      <rect width="100%" height="100%" rx="18" fill="#f8fbff"/>
      <text x="24" y="28" font-size="16" font-weight="800" fill="#1f3658">Agent Network</text>
      ${stageBodies}
      ${arrows}
    `),
  };
}

function buildAgentMatrixSvg(dag: DAGResult): { svg: string; sourceStepIds: string[] } | null {
  const layout = buildDAGLayout(dag);
  if (layout.layers.length === 0) return null;
  const roles = [...new Set(dag.nodes.map((node) => node.agent || 'unknown'))];
  const roleWidth = 170;
  const colWidth = 74;
  const rowHeight = 54;
  const headerHeight = 72;
  const margin = 24;
  const width = Math.max(520, margin * 2 + roleWidth + layout.layers.length * colWidth);
  const height = margin * 2 + headerHeight + roles.length * rowHeight;
  const byRoleAndStage = new Map<string, DAGResult['nodes']>();
  for (const layer of layout.layers) {
    for (const entry of layer.nodes) {
      const key = `${entry.node.agent || 'unknown'}:${layer.index}`;
      const nodes = byRoleAndStage.get(key) ?? [];
      nodes.push(entry.node);
      byRoleAndStage.set(key, nodes);
    }
  }
  const gridX = margin + roleWidth;
  const gridY = margin + headerHeight;
  const columns = layout.layers.map((layer, index) => {
    const x = gridX + index * colWidth;
    return [
      `<rect x="${x}" y="${margin + 34}" width="${colWidth}" height="${headerHeight - 34 + roles.length * rowHeight}" fill="${layer.mode === 'concurrent' ? '#eff6ff' : '#faf5ff'}" opacity=".62"/>`,
      `<text x="${x + 10}" y="${margin + 54}" font-size="10" font-weight="700" fill="#4c1d95">S${layer.index + 1}</text>`,
    ].join('');
  }).join('');
  const rows = roles.map((role, rowIndex) => {
    const y = gridY + rowIndex * rowHeight;
    const cells = layout.layers.map((layer, colIndex) => {
      const x = gridX + colIndex * colWidth;
      const nodes = byRoleAndStage.get(`${role}:${layer.index}`) ?? [];
      const chips = nodes.slice(0, 3).map((node, chipIndex) => {
        const chipY = y + 9 + chipIndex * 15;
        return `<rect x="${x + 7}" y="${chipY}" width="${colWidth - 14}" height="12" rx="4" fill="#ffffff" stroke="#7c3aed"/><text x="${x + 11}" y="${chipY + 9}" font-size="8" fill="#4c1d95">${escapeXml(truncate(node.id, 9))}</text>`;
      }).join('');
      return `<rect x="${x}" y="${y}" width="${colWidth}" height="${rowHeight}" fill="none" stroke="#e2e8f0"/>${chips}`;
    }).join('');
    return `<text x="${margin}" y="${y + 30}" font-size="11" font-weight="700" fill="#334155">${escapeXml(truncate(role, 23))}</text>${cells}`;
  }).join('');
  return {
    sourceStepIds: dag.nodes.map((node) => node.id).filter(Boolean),
    svg: svgShell(width, height, 'Agent Matrix', `
      <rect width="100%" height="100%" rx="18" fill="#fbfaff"/>
      <text x="24" y="28" font-size="16" font-weight="800" fill="#4c1d95">Agent Matrix</text>
      <text x="24" y="54" font-size="11" font-weight="700" fill="#64748b">Role / Stage</text>
      ${columns}
      ${rows}
    `),
  };
}

function buildAgentMetroSvg(dag: DAGResult): { svg: string; sourceStepIds: string[] } | null {
  const layout = buildDAGLayout(dag);
  if (layout.layers.length === 0) return null;
  const lanes = [...new Set(dag.nodes.map((node) => node.agent || 'unknown'))];
  const width = Math.max(760, 140 + layout.layers.length * 110);
  const height = 100 + lanes.length * 58;
  const laneY = new Map(lanes.map((lane, index) => [lane, 76 + index * 58]));
  const positions = new Map<string, { x: number; y: number }>();
  for (const layer of layout.layers) {
    for (const entry of layer.nodes) {
      positions.set(entry.node.id, { x: 150 + layer.index * 110, y: laneY.get(entry.node.agent || 'unknown') ?? 76 });
    }
  }
  const edgeColor = (type: string) => type === 'recovery' ? '#ef4444' : type === 'handoff' ? '#8b5cf6' : type === 'spawned' ? '#f59e0b' : '#10b981';
  const edges = dag.edges.map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return '';
    return `<path d="M ${from.x} ${from.y} C ${from.x + 42} ${from.y}, ${to.x - 42} ${to.y}, ${to.x} ${to.y}" fill="none" stroke="${edgeColor(edge.type)}" stroke-width="5" stroke-linecap="round" opacity=".8"><title>${escapeXml(`${edge.from} to ${edge.to}`)}</title></path>`;
  }).join('');
  const stops = dag.nodes.map((node) => {
    const pos = positions.get(node.id);
    if (!pos) return '';
    const ticks = node.consensus ? '<line x1="-7" y1="-21" x2="-7" y2="-11" stroke="#334155" stroke-width="2"/><line x1="0" y1="-23" x2="0" y2="-11" stroke="#334155" stroke-width="2"/><line x1="7" y1="-21" x2="7" y2="-11" stroke="#334155" stroke-width="2"/>' : '';
    return `<g transform="translate(${pos.x} ${pos.y})"><circle r="13" fill="#fff" stroke="#059669" stroke-width="4"/>${ticks}<text x="-24" y="33" font-size="10" fill="#334155">${escapeXml(node.id)}</text></g>`;
  }).join('');
  const labels = lanes.map((lane) => `<text x="24" y="${(laneY.get(lane) ?? 76) + 4}" font-size="11" font-weight="700" fill="#475569">${escapeXml(lane)}</text>`).join('');
  return {
    sourceStepIds: dag.nodes.map((node) => node.id).filter(Boolean),
    svg: svgShell(width, height, 'Agent Metro', `
      <rect width="100%" height="100%" rx="18" fill="#f7fffb"/>
      <text x="24" y="28" font-size="16" font-weight="800" fill="#065f46">Agent Metro</text>
      ${labels}
      ${edges}
      ${stops}
    `),
  };
}

function buildAgentClusterSvg(dag: DAGResult): { svg: string; sourceStepIds: string[] } | null {
  const layout = buildDAGLayout(dag);
  if (layout.layers.length === 0) return null;
  const cardWidth = 160;
  const cardHeight = 98;
  const gap = 20;
  const margin = 24;
  const width = Math.max(520, margin * 2 + layout.layers.length * cardWidth + Math.max(0, layout.layers.length - 1) * gap);
  const height = 190;
  const cards = layout.layers.map((layer, index) => {
    const x = margin + index * (cardWidth + gap);
    const agents = new Map<string, number>();
    for (const entry of layer.nodes) agents.set(entry.node.agent, (agents.get(entry.node.agent) ?? 0) + 1);
    const lines = [...agents.entries()].slice(0, 4).map(([agent, count], lineIndex) => `<text x="${x + 14}" y="${86 + lineIndex * 16}" font-size="10" fill="#7c2d12">${escapeXml(truncate(agent, 16))} x${count}</text>`).join('');
    return `<rect x="${x}" y="50" width="${cardWidth}" height="${cardHeight}" rx="16" fill="#fff7ed" stroke="#fb923c"/><text x="${x + 14}" y="73" font-size="12" font-weight="800" fill="#9a3412">Stage ${layer.index + 1}</text>${lines}`;
  }).join('');
  return {
    sourceStepIds: dag.nodes.map((node) => node.id).filter(Boolean),
    svg: svgShell(width, height, 'Agent Clusters', `
      <rect width="100%" height="100%" rx="18" fill="#fffaf5"/>
      <text x="24" y="28" font-size="16" font-weight="800" fill="#9a3412">Agent Clusters</text>
      ${cards}
    `),
  };
}

function buildAgentCircularSvg(dag: DAGResult): { svg: string; sourceStepIds: string[] } | null {
  const layout = buildDAGLayout(dag);
  if (layout.layers.length === 0) return null;
  const width = Math.max(1100, 620 + dag.nodes.length * 42);
  const height = Math.max(860, 620 + dag.nodes.length * 26);
  const centerX = width / 2;
  const centerY = height / 2 + 28;
  const radius = Math.max(260, Math.min(width, height) / 2 - 150);
  const nodeRadius = 30;
  const orderedNodes = layout.layers.flatMap((layer) => layer.nodes.map((entry) => entry.node));
  const positions = new Map<string, { x: number; y: number; angle: number }>();
  orderedNodes.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(1, orderedNodes.length)) * Math.PI * 2;
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      angle,
    });
  });
  const statusColor = (status: string) => ({
    completed: '#22c55e',
    recovered: '#16a34a',
    failed: '#ef4444',
    skipped: '#f59e0b',
    pending: '#94a3b8',
    running: '#3b82f6',
  }[status] ?? '#64748b');
  const edgeColor = (type: string) => ({
    planned: '#60a5fa',
    handoff: '#a78bfa',
    recovery: '#ef4444',
    spawned: '#f59e0b',
    feedback: '#06b6d4',
    review: '#14b8a6',
    judge: '#7c3aed',
  }[type] ?? '#60a5fa');
  const rings = layout.layers.map((layer, index) => {
    const ringRadius = Math.max(72, radius - (layout.layers.length - 1 - index) * 38);
    return `<circle cx="${centerX}" cy="${centerY}" r="${ringRadius}" fill="none" stroke="${layer.mode === 'concurrent' ? '#bfdbfe' : '#ddd6fe'}" stroke-width="1.4" stroke-dasharray="6 8" opacity=".75"/>`;
  }).join('');
  const arrows = dag.edges.map((edge, index) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return '';
    const color = edgeColor(edge.type);
    const markerId = `circular-arrow-${index}`;
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const spread = ((index % 5) - 2) * 18;
    const controlX = centerX + (midX - centerX) * 0.28 + spread;
    const controlY = centerY + (midY - centerY) * 0.28 - spread;
    return [
      `<defs><marker id="${markerId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/></marker></defs>`,
      `<path class="circular-edge" d="M ${from.x} ${from.y} Q ${controlX} ${controlY} ${to.x} ${to.y}" fill="none" stroke="${color}" stroke-width="2.7" stroke-linecap="round" opacity=".74" marker-end="url(#${markerId})"><title>${escapeXml(`${edge.from} to ${edge.to} (${edge.type})`)}</title></path>`,
    ].join('');
  }).join('');
  const nodes = orderedNodes.map((node, index) => {
    const pos = positions.get(node.id);
    if (!pos) return '';
    const status = String(node.status ?? 'pending').toLowerCase();
    const labelRight = Math.cos(pos.angle) >= 0;
    const labelAnchor = labelRight ? 'start' : 'end';
    const labelX = pos.x + Math.cos(pos.angle) * 62;
    const labelY = pos.y + Math.sin(pos.angle) * 62;
    const labelWidth = 190;
    const labelBoxX = labelRight ? labelX - 8 : labelX - labelWidth + 8;
    const labelBoxY = labelY - 16;
    const consensus = node.consensus ? `<text x="${labelX}" y="${labelY + 25}" font-size="9" text-anchor="${labelAnchor}" fill="#475569">${escapeXml(formatConsensusHeadline(node.consensus))}</text>` : '';
    return [
      `<g class="circular-node" transform="translate(${pos.x} ${pos.y})">`,
      `<circle r="${nodeRadius + 7}" fill="#ffffff" opacity=".84"/>`,
      `<circle r="${nodeRadius}" fill="#ffffff" stroke="${statusColor(status)}" stroke-width="5"/>`,
      `<text y="-3" font-size="10" text-anchor="middle" font-weight="800" fill="#1e293b">${escapeXml(String(index + 1))}</text>`,
      `<text y="11" font-size="8.5" text-anchor="middle" fill="#64748b">${escapeXml(truncate(node.id, 10))}</text>`,
      `</g>`,
      `<rect class="circular-label-bg" x="${labelBoxX}" y="${labelBoxY}" width="${labelWidth}" height="${node.consensus ? 48 : 34}" rx="9" fill="#ffffff" stroke="#dbeafe" opacity=".92"/>`,
      `<text x="${labelX}" y="${labelY}" font-size="11" text-anchor="${labelAnchor}" font-weight="800" fill="#1e293b">${escapeXml(truncate(node.agent || 'unknown', 24))}</text>`,
      `<text x="${labelX}" y="${labelY + 13}" font-size="9" text-anchor="${labelAnchor}" fill="#64748b">${escapeXml(`${node.id} | ${status}`)}</text>`,
      consensus,
    ].join('');
  }).join('');
  const legend = [
    ['planned', '#60a5fa'],
    ['feedback', '#06b6d4'],
    ['review', '#14b8a6'],
    ['judge', '#7c3aed'],
    ['recovery', '#ef4444'],
  ].map(([label, color], index) =>
    `<g transform="translate(${24 + index * 116} ${height - 42})"><line x1="0" y1="0" x2="26" y2="0" stroke="${color}" stroke-width="4" stroke-linecap="round"/><text x="34" y="4" font-size="10" fill="#475569">${label}</text></g>`,
  ).join('');
  return {
    sourceStepIds: dag.nodes.map((node) => node.id).filter(Boolean),
    svg: svgShell(width, height, 'Agent Circular Route', `
      <rect width="100%" height="100%" rx="24" fill="#f8fbff"/>
      <circle cx="${centerX}" cy="${centerY}" r="${radius + 62}" fill="url(#circular-bg)" opacity=".82"/>
      <defs>
        <radialGradient id="circular-bg" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="58%" stop-color="#eff6ff"/>
          <stop offset="100%" stop-color="#f5f3ff"/>
        </radialGradient>
      </defs>
      <text x="24" y="30" font-size="18" font-weight="800" fill="#1f3658">Agent Circular Route</text>
      <text x="24" y="50" font-size="11" fill="#64748b">Circular mode: dependency routes wrap around the agent ring; colors distinguish review, feedback, and recovery paths.</text>
      ${rings}
      <circle cx="${centerX}" cy="${centerY}" r="56" fill="#ffffff" stroke="#bfdbfe" stroke-width="2"/>
      <text x="${centerX}" y="${centerY - 4}" text-anchor="middle" font-size="12" font-weight="800" fill="#1f3658">MAP</text>
      <text x="${centerX}" y="${centerY + 14}" text-anchor="middle" font-size="10" fill="#64748b">${dag.nodes.length} agents</text>
      ${arrows}
      ${nodes}
      ${legend}
    `),
  };
}


function buildUsageCommonnessSvg(data: Record<string, unknown>): { svg: string; sourceStepIds: string[]; producerStepId?: string; producerAgent?: string } | null {
  const source = findStepOutput(data, (step, output) => /Usage Commonness Ranking/i.test(output));
  if (!source) return null;
  const rows = parseCommonnessRows(source.output).slice(0, 12);
  if (rows.length === 0) return null;

  const width = 920;
  const rowHeight = 46;
  const height = 76 + rows.length * rowHeight;
  const chartX = 330;
  const chartWidth = 430;
  const body = rows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const score = Math.max(0, Math.min(100, row.score));
    const barWidth = Math.round((score / 100) * chartWidth);
    return [
      `<text x="24" y="${y + 24}" font-size="13" fill="#1e293b">${escapeXml(truncate(`${row.rank}. ${row.usage}`, 42))}</text>`,
      `<rect x="${chartX}" y="${y + 8}" width="${chartWidth}" height="20" rx="10" fill="#e2e8f0"/>`,
      `<rect x="${chartX}" y="${y + 8}" width="${barWidth}" height="20" rx="10" fill="#7c3aed"/>`,
      `<text x="${chartX + chartWidth + 18}" y="${y + 24}" font-size="13" font-weight="700" fill="#312e81">${score}</text>`,
      `<text x="${chartX + chartWidth + 64}" y="${y + 24}" font-size="12" fill="#475569">${escapeXml(row.label)}</text>`,
    ].join('');
  }).join('');

  return {
    sourceStepIds: [source.id],
    producerStepId: source.id,
    producerAgent: source.agent,
    svg: svgShell(width, height, 'Usage Commonness Ranking', `
      <rect width="100%" height="100%" rx="18" fill="#fbfaff"/>
      <text x="24" y="30" font-size="18" font-weight="800" fill="#312e81">Usage Commonness Ranking</text>
      <text x="${chartX}" y="30" font-size="12" fill="#64748b">0-100 ordinal commonness score</text>
      ${body}
    `),
  };
}

function buildTaxonomyTreeSvg(data: Record<string, unknown>): { svg: string; sourceStepIds: string[]; producerStepId?: string; producerAgent?: string } | null {
  const source = findStepOutput(data, (step, output) => /Taxonomy Tree|ClassyFire|ChemOnt/i.test(output));
  if (!source) return null;
  const rows = parseSimpleMarkdownTable(source.output).filter((row) => row.length >= 2 && !/^rank$/i.test(row[0] ?? ''));
  const taxonomyRows = rows.filter((row) => /kingdom|superclass|class|subclass|level/i.test(row[0] ?? '')).slice(0, 8);
  if (taxonomyRows.length === 0) return null;

  const width = 760;
  const rowHeight = 62;
  const height = 72 + taxonomyRows.length * rowHeight;
  const centerX = width / 2;
  const body = taxonomyRows.map((row, index) => {
    const y = 58 + index * rowHeight;
    const boxWidth = Math.max(260, 460 - index * 18);
    const x = centerX - boxWidth / 2;
    const rank = row[0] ?? '';
    const classification = row[1] ?? '';
    const connector = index === 0 ? '' : `<line x1="${centerX}" y1="${y - 18}" x2="${centerX}" y2="${y - 2}" stroke="#9db3ce" stroke-width="2"/>`;
    return [
      connector,
      `<rect x="${x}" y="${y}" width="${boxWidth}" height="42" rx="14" fill="#ffffff" stroke="#bfd0e4"/>`,
      `<text x="${x + 16}" y="${y + 17}" font-size="11" fill="#64748b">${escapeXml(rank)}</text>`,
      `<text x="${x + 16}" y="${y + 33}" font-size="14" font-weight="700" fill="#1e293b">${escapeXml(truncate(classification, 58))}</text>`,
    ].join('');
  }).join('');

  return {
    sourceStepIds: [source.id],
    producerStepId: source.id,
    producerAgent: source.agent,
    svg: svgShell(width, height, 'Taxonomy Tree', `
      <rect width="100%" height="100%" rx="18" fill="#f8fbff"/>
      <text x="24" y="30" font-size="18" font-weight="800" fill="#1f3658">Taxonomy Tree</text>
      ${body}
    `),
  };
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
        status: String(node['status'] ?? step?.['status'] ?? 'pending'),
        duration: typeof node['duration'] === 'number' ? node['duration'] : typeof step?.['duration'] === 'number' ? step['duration'] : 0,
        ...(node['final'] === true ? { final: true } : {}),
        ...(consensus ? { consensus } : {}),
      };
    }),
    edges: edges.map((edge) => {
      const type = String(edge['type'] ?? 'planned');
      return {
        from: String(edge['from'] ?? ''),
        to: String(edge['to'] ?? ''),
        type: type === 'handoff' || type === 'recovery' || type === 'spawned' || type === 'feedback' || type === 'review' || type === 'judge'
          ? type
          : 'planned',
      };
    }),
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

function formatSvgConsensusParticipant(participant: ConsensusParticipant): string {
  const model = participant.provider && participant.model
    ? `${participant.provider}/${participant.model}`
    : participant.model ?? participant.provider ?? 'unknown';
  const contribution = Number.isFinite(participant.contribution) ? `${Math.round(participant.contribution * 100)}%` : '0%';
  return `r${participant.run} ${model} ${participant.status} ${contribution}`;
}

function findStepOutput(
  data: Record<string, unknown>,
  predicate: (step: Record<string, unknown>, output: string) => boolean,
): { id: string; agent: string; output: string } | null {
  const steps = Array.isArray(data['steps']) ? data['steps'].filter(isRecord) : [];
  for (const step of steps) {
    const output = typeof step['output'] === 'string' ? step['output'] : '';
    if (!output || !predicate(step, output)) continue;
    return {
      id: String(step['id'] ?? ''),
      agent: String(step['agent'] ?? ''),
      output,
    };
  }
  return null;
}

function parseCommonnessRows(markdown: string): Array<{ rank: string; usage: string; score: number; label: string }> {
  const rows = parseSimpleMarkdownTable(markdown);
  const headerIndex = rows.findIndex((row) => row.some((cell) => /commonness score/i.test(cell)));
  if (headerIndex < 0) return [];
  const header = rows[headerIndex]!.map((cell) => cell.toLowerCase());
  const rankIndex = header.findIndex((cell) => cell === 'rank');
  const usageIndex = header.findIndex((cell) => /usage|application|exposure/.test(cell));
  const scoreIndex = header.findIndex((cell) => /commonness score/.test(cell));
  const labelIndex = header.findIndex((cell) => /commonness label/.test(cell));
  return rows.slice(headerIndex + 1)
    .filter((row) => row.length >= header.length && !row.every((cell) => /^-+$/.test(cell.replace(/:/g, '').trim())))
    .map((row) => ({
      rank: row[rankIndex] ?? '',
      usage: row[usageIndex] ?? '',
      score: Number.parseInt(row[scoreIndex] ?? '', 10),
      label: row[labelIndex] ?? '',
    }))
    .filter((row) => row.usage && Number.isFinite(row.score))
    .sort((a, b) => b.score - a.score);
}

function parseSimpleMarkdownTable(markdown: string): string[][] {
  return markdown
    .split(/\r?\n/)
    .filter((line) => /^\s*\|.*\|\s*$/.test(line))
    .map((line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()))
    .filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell)));
}

function svgShell(width: number, height: number, title: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">
  <title>${escapeXml(title)}</title>
  <style>text{font-family:-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,sans-serif}</style>
  ${body}
</svg>
`;
}

function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+="[^"]*"/gi, '')
    .replace(/\son[a-z]+='[^']*'/gi, '')
    .replace(/href="https?:\/\/[^"]*"/gi, 'href="#"');
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

function escapeXml(value: string): string {
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
