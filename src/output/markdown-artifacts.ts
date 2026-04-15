import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface ExecutionGraphEntry {
  id: string;
  agent: string;
  provider?: string;
  model?: string;
  task: string;
  status: string;
  duration?: number;
  dependsOn: string[];
}

export interface SaveStageMarkdownOptions {
  outputRoot: string;
  pipelineId: string;
  iteration: number;
  stage: string;
  title: string;
  content: string;
}

export interface SaveStepMarkdownOptions {
  outputRoot: string;
  pipelineId: string;
  order: number;
  stepId: string;
  agent: string;
  task: string;
  status: string;
  content: string;
}

export interface SaveFinalReportMarkdownOptions {
  outputRoot: string;
  pipelineId: string;
  title: string;
  executionGraph: ExecutionGraphEntry[];
  content: string;
  filesCreated?: string[];
  rawLogPath?: string;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'output';
}

function formatDuration(ms?: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

async function writeMarkdown(filePath: string, content: string): Promise<string> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${content.trimEnd()}\n`, 'utf8');
  return filePath;
}

export function buildMarkdownRunDir(outputRoot: string, pipelineId: string): string {
  return path.join(path.resolve(outputRoot), 'map-output', slugify(pipelineId));
}

export async function saveStageMarkdown(options: SaveStageMarkdownOptions): Promise<string> {
  const runDir = buildMarkdownRunDir(options.outputRoot, options.pipelineId);
  const filename = `iter-${options.iteration}-${slugify(options.stage)}.md`;
  const content = [
    `# ${options.title}`,
    '',
    `- Stage: ${options.stage}`,
    `- Iteration: ${options.iteration}`,
    '',
    options.content.trim() || '_No output captured._',
  ].join('\n');

  return writeMarkdown(path.join(runDir, filename), content);
}

export async function saveStepMarkdown(options: SaveStepMarkdownOptions): Promise<string> {
  const runDir = buildMarkdownRunDir(options.outputRoot, options.pipelineId);
  const filename = [
    `step-${String(options.order).padStart(2, '0')}`,
    slugify(options.agent),
    slugify(options.stepId),
  ].join('-') + '.md';
  const content = [
    `# ${options.task}`,
    '',
    `- Step: ${options.stepId}`,
    `- Agent: ${options.agent}`,
    `- Status: ${options.status}`,
    '',
    options.content.trim() || '_No output captured._',
  ].join('\n');

  return writeMarkdown(path.join(runDir, filename), content);
}

export async function saveFinalReportMarkdown(
  options: SaveFinalReportMarkdownOptions,
): Promise<string> {
  const runDir = buildMarkdownRunDir(options.outputRoot, options.pipelineId);
  const edges = options.executionGraph.flatMap((step) =>
    step.dependsOn.map((dep) => `${dep} -> ${step.id}`),
  );
  const graphLines = options.executionGraph.flatMap((step, index) => {
    const duration = step.duration ? ` ${formatDuration(step.duration)}` : '';
    const runtime =
      step.provider !== undefined
        ? ` | ${step.provider}${step.model ? `/${step.model}` : ''}`
        : '';
    return [
      `${index + 1}. ${step.id} [${step.agent}${runtime}] ${step.status}${duration}`,
      `   ${step.task}`,
      step.dependsOn.length > 0
        ? `   depends on: ${step.dependsOn.join(', ')}`
        : '   ready to start',
    ];
  });
  const fileLines = (options.filesCreated ?? []).map((file) => `- ${file}`);

  const content = [
    `# ${options.title}`,
    '',
    '## Execution graph',
    '',
    `Connections: ${edges.length > 0 ? edges.join(', ') : 'none'}`,
    '',
    ...graphLines,
    '',
    '## Generated output',
    '',
    options.content.trim() || '_No output captured._',
    '',
    '## Files created',
    '',
    ...(fileLines.length > 0 ? fileLines : ['_No files reported._']),
    ...(options.rawLogPath ? ['', '## Raw log', '', options.rawLogPath] : []),
  ].join('\n');

  return writeMarkdown(path.join(runDir, 'final-report.md'), content);
}
