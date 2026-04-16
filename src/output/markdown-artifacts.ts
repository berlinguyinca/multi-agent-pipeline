import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { StepResult } from '../types/dag.js';
import { normalizeTerminalText } from '../utils/terminal-text.js';

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
  const normalized = normalizeTerminalText(content);
  await fs.writeFile(filePath, `${normalized.trimEnd()}\n`, 'utf8');
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

export interface GenerateAgentSummaryOptions {
  steps: StepResult[];
  duration: number;
  success: boolean;
  pipelineId: string;
  outputRoot: string;
}

interface AgentStats {
  totalSteps: number;
  succeeded: number;
  failed: number;
  agents: Map<string, {
    adapter: string;
    model: string;
    stepsRun: number;
    errors: string[];
  }>;
}

function groupStepsByAgent(steps: StepResult[]): AgentStats {
  const stats: AgentStats = {
    totalSteps: steps.length,
    succeeded: steps.filter(s => s.status === 'completed').length,
    failed: steps.filter(s => s.status === 'failed').length,
    agents: new Map(),
  };
  
  for (const step of steps) {
    const agentName = step.agent;
    const agentData = stats.agents.get(agentName) || {
      adapter: step.provider ?? 'unknown',
      model: step.model ?? 'unknown',
      stepsRun: 0,
      errors: [],
    };
    
    agentData.stepsRun += 1;
    if (step.status === 'failed') {
      const errorMsg = step.error 
        ? step.error.slice(0, 200).replace(/\n+/g, ' ').trim()
        : 'Unknown error';
      // Avoid duplicate error entries
      if (!agentData.errors.includes(errorMsg)) {
        agentData.errors.push(errorMsg);
      }
    }
    stats.agents.set(agentName, agentData);
  }
  
  return stats;
}

export async function generateAgentSummary(options: GenerateAgentSummaryOptions): Promise<string> {
  // Group steps by agent with better tracking
  const agentMap = new Map<string, {
    adapter: string;
    model: string;
    steps: StepResult[];
    errors: string[];
  }>();
  
  for (const step of options.steps) {
    const agentName = step.agent;
    if (!agentMap.has(agentName)) {
      agentMap.set(agentName, {
        adapter: step.provider ?? 'unknown',
        model: step.model ?? 'unknown',
        steps: [],
        errors: [],
      });
    }
    
    const agentData = agentMap.get(agentName)!;
    agentData.steps.push(step);
    
    if (step.status === 'failed') {
      const errorMsg = step.error 
        ? step.error.slice(0, 200).replace(/\n+/g, ' ').trim()
        : 'Unknown error';
      if (!agentData.errors.includes(errorMsg)) {
        agentData.errors.push(errorMsg);
      }
    }
  }
  
  const duration = options.duration >= 3_600_000
    ? `${(options.duration / 3_600_000).toFixed(2)}h`
    : options.duration >= 60000
      ? `${(options.duration / 60000).toFixed(1)}m`
      : `${options.duration}ms`;
  
  const header = [
    `# Pipeline Execution Summary`,
    '',
    `**Duration:** ${duration}`,
    `**Pipeline ID:** ${options.pipelineId}`,
    `**Status:** ${options.success ? 'Completed' : 'Failed'}`,
    '',
    '## Overall Statistics',
    '',
    `**Total Steps:** ${options.steps.length}`,
    `**Successful:** ${options.steps.filter(s => s.status === 'completed').length}`,
    `**Failed:** ${options.steps.filter(s => s.status === 'failed').length}`,
    '',
    '## Agents Summary',
    '',
  ].join('\n');
  
  const agentSections = Array.from(agentMap.entries()).map(([agentName, data]) => {
    const completedSteps = data.steps.filter(s => s.status === 'completed').length;
    const failedSteps = data.steps.filter(s => s.status === 'failed').length;
    const status = data.steps.length === 0 
      ? '_not used_'
      : failedSteps > 0 
        ? 'had failures'
        : 'fully successful';
    
    const stepHistory = data.steps
      .map((step, idx) => {
        return `   - Step ${idx + 1}: ${step.task} [${step.status}] ${step.duration ? `(${formatDuration(step.duration)})` : ''}`;
      })
      .join('\n');
    
    const errorsSection = data.errors.length > 0 
      ? [
        '',
        `     ## Errors encountered (${data.errors.length})`,
        '',
        ...data.errors.slice(0, 5).map(err => `       - ${err}`),
        '',
      ].join('\n')
      : '';
    
    return [
      `### ${agentName}`,
      '',
      `**Adapter:** ${data.adapter} ${data.model ? `(${data.model})` : ''}`,
      `**Total Steps:** ${data.steps.length}`,
      `**Completed:** ${completedSteps}`,
      `**Failed:** ${failedSteps}`,
      `**Status:** ${status}`,
      '',
      '## Step history',
      '',
      stepHistory,
      '',
      '## Actions taken',
      '',
      `- **Input:** Processed task/output from previous steps`,
      `- **Output:** Generated results for downstream steps`,
      errorsSection,
      '',
    ].join('\n');
  });
  
  const footer = [
    '',
    '## Notes',
    '',
    '- Agents are invoked based on the DAG plan and their dependencies',
    '- Recovery steps are included when failures occur',
    '- Failed steps may trigger recovery attempts before marking as failed',
    '- This summary is generated after each pipeline completes',
    '',
  ].join('\n');
  
  const content = header + agentSections.join('') + footer;
  
  return writeMarkdown(path.join(options.outputRoot, 'AGENTS_SUMMARY.md'), content);
}
