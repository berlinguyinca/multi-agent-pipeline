import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { StepResult } from '../types/dag.js';
import { normalizeTerminalText } from '../utils/terminal-text.js';

export interface SaveTaskKnowledgeArtifactsOptions {
  outputDir: string;
  steps: StepResult[];
  pipelineId: string;
}

const GOAL_AGENT = 'goal-synthesizer';
const KNOWLEDGE_AGENT = 'project-knowledge-curator';

export async function saveTaskKnowledgeArtifacts(options: SaveTaskKnowledgeArtifactsOptions): Promise<string[]> {
  const knowledgeDir = path.join(path.resolve(options.outputDir), 'knowledge');
  const written: string[] = [];
  const goalStep = options.steps.find((step) => step.agent === GOAL_AGENT && step.status === 'completed' && step.output?.trim());
  if (goalStep?.output?.trim()) {
    const goalPath = path.join(knowledgeDir, 'goal.md');
    await writeKnowledgeFile(goalPath, formatKnowledgeStep(goalStep, options.pipelineId));
    written.push(goalPath);
  }

  const updates = options.steps.filter((step) =>
    step.agent === KNOWLEDGE_AGENT && step.status === 'completed' && step.output?.trim(),
  );
  if (updates.length > 0) {
    const progressPath = path.join(knowledgeDir, 'progress-log.md');
    const content = updates.map((step) => formatKnowledgeStep(step, options.pipelineId)).join('\n\n---\n\n');
    await writeKnowledgeFile(progressPath, content);
    written.push(progressPath);
  }

  return written;
}

function formatKnowledgeStep(step: StepResult, pipelineId: string): string {
  return [
    `# ${step.agent} ${step.id}`,
    '',
    `- Pipeline: ${pipelineId}`,
    `- Step: ${step.id}`,
    `- Agent: ${step.agent}`,
    `- Task: ${step.task}`,
    '',
    normalizeTerminalText(step.output ?? '').trim() || '_No knowledge output captured._',
    '',
  ].join('\n');
}

async function writeKnowledgeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${content.trimEnd()}\n`, 'utf8');
}
