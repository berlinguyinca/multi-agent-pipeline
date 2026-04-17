import * as fs from 'node:fs/promises';
import * as path from 'node:path';

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

export async function createReportVisualArtifacts(
  result: unknown,
  options: { outputDir: string },
): Promise<ReportArtifactManifest> {
  const outputDir = path.resolve(options.outputDir);
  const artifactsDir = path.join(outputDir, 'artifacts');
  await fs.mkdir(artifactsDir, { recursive: true });

  const data = isRecord(result) ? result : { result };
  const artifacts: ReportArtifact[] = [];

  const agentNetwork = buildAgentNetworkSvg(data);
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
    src: path.posix.join('artifacts', filename),
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

function buildAgentNetworkSvg(data: Record<string, unknown>): { svg: string; sourceStepIds: string[] } | null {
  const dag = isRecord(data['dag']) ? data['dag'] : undefined;
  const nodes = Array.isArray(dag?.['nodes']) ? dag['nodes'].filter(isRecord) : [];
  const edges = Array.isArray(dag?.['edges']) ? dag['edges'].filter(isRecord) : [];
  if (nodes.length === 0) return null;

  const nodeWidth = 210;
  const nodeHeight = 86;
  const gap = 52;
  const margin = 24;
  const width = Math.max(320, margin * 2 + nodes.length * nodeWidth + (nodes.length - 1) * gap);
  const height = 168;
  const statusColor = (status: string) => ({
    completed: '#22c55e',
    recovered: '#22c55e',
    failed: '#ef4444',
    skipped: '#f59e0b',
    pending: '#94a3b8',
    running: '#3b82f6',
  }[status] ?? '#64748b');

  const cards = nodes.map((node, index) => {
    const x = margin + index * (nodeWidth + gap);
    const y = 42;
    const id = String(node['id'] ?? 'step');
    const agent = String(node['agent'] ?? 'unknown');
    const status = String(node['status'] ?? 'pending').toLowerCase();
    return [
      `<rect x="${x}" y="${y}" width="${nodeWidth}" height="${nodeHeight}" rx="16" fill="#ffffff" stroke="#bfd0e4"/>`,
      `<rect x="${x}" y="${y}" width="8" height="${nodeHeight}" rx="4" fill="${statusColor(status)}"/>`,
      `<text x="${x + 18}" y="${y + 26}" font-size="12" fill="#64748b" font-family="ui-monospace, monospace">${escapeXml(id)}</text>`,
      `<text x="${x + 18}" y="${y + 50}" font-size="14" font-weight="700" fill="#1e293b">${escapeXml(truncate(agent, 26))}</text>`,
      `<text x="${x + 18}" y="${y + 72}" font-size="12" fill="#475569">${escapeXml(status)}</text>`,
    ].join('');
  }).join('');

  const arrows = edges.map((edge) => {
    const from = nodes.findIndex((node) => String(node['id'] ?? '') === String(edge['from'] ?? ''));
    const to = nodes.findIndex((node) => String(node['id'] ?? '') === String(edge['to'] ?? ''));
    if (from < 0 || to < 0 || to <= from) return '';
    const x1 = margin + from * (nodeWidth + gap) + nodeWidth;
    const x2 = margin + to * (nodeWidth + gap);
    const y = 85;
    return `<line x1="${x1 + 8}" y1="${y}" x2="${x2 - 10}" y2="${y}" stroke="#8db5ec" stroke-width="3" marker-end="url(#arrow)"/>`;
  }).join('');

  const sourceStepIds = nodes.map((node) => String(node['id'] ?? '')).filter(Boolean);
  return {
    sourceStepIds,
    svg: svgShell(width, height, 'Agent Network', `
      <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#8db5ec"/></marker></defs>
      <rect width="100%" height="100%" rx="18" fill="#f8fbff"/>
      <text x="24" y="26" font-size="16" font-weight="800" fill="#1f3658">Agent Network</text>
      ${arrows}
      ${cards}
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
