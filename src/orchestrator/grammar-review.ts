import type { AgentDefinition } from '../types/agent-definition.js';
import type { DAGPlan, StepResult } from '../types/dag.js';

export interface GrammarReviewOptions {
  step: DAGPlan['plan'][number];
  result: StepResult;
  plan: DAGPlan;
  allIds: Set<string>;
  agents: Map<string, AgentDefinition>;
  results: Map<string, StepResult>;
  settled: Set<string>;
}

const GRAMMAR_AGENT = 'grammar-spelling-specialist';

export function maybeScheduleGrammarReview(options: GrammarReviewOptions): void {
  if (!shouldGrammarReview(options.step, options.result, options.agents)) return;

  const grammarId = nextAvailableId(`${options.step.id}-grammar`, options.allIds);
  const task = buildGrammarReviewTask(options.step, options.result.output ?? '');
  const grammarStep = {
    id: grammarId,
    agent: GRAMMAR_AGENT,
    task,
    dependsOn: [options.step.id],
    parentStepId: options.step.id,
  };
  const stepIndex = options.plan.plan.findIndex((candidate) => candidate.id === options.step.id);
  if (stepIndex === -1) {
    options.plan.plan.push(grammarStep);
  } else {
    options.plan.plan.splice(stepIndex + 1, 0, grammarStep);
  }
  options.allIds.add(grammarId);

  for (const candidate of options.plan.plan) {
    if (candidate.id === options.step.id || candidate.id === grammarId || options.settled.has(candidate.id)) {
      continue;
    }
    candidate.dependsOn = candidate.dependsOn.map((dep) =>
      dep === options.step.id ? grammarId : dep,
    );
  }

  options.results.set(grammarId, {
    id: grammarId,
    agent: GRAMMAR_AGENT,
    task,
    dependsOn: [options.step.id],
    status: 'pending',
    parentStepId: options.step.id,
    edgeType: 'handoff',
    spawnedByAgent: options.step.agent,
  });
}

function shouldGrammarReview(
  step: DAGPlan['plan'][number],
  result: StepResult,
  agents: Map<string, AgentDefinition>,
): boolean {
  if (!agents.has(GRAMMAR_AGENT)) return false;
  if (step.agent === GRAMMAR_AGENT) return false;
  if (step.agent === 'adviser') return false;
  if (step.agent === 'classyfire-taxonomy-classifier') return false;
  if (step.agent === 'usage-classification-tree') return false;
  if (step.agent === 'output-formatter') return false;
  if (result.outputType !== 'answer' && result.outputType !== 'presentation') return false;
  const output = result.output?.trim();
  if (!output) return false;
  if (looksMachineReadable(output)) return false;
  if (looksStructuredOrScientific(output)) return false;
  return true;
}

function looksMachineReadable(output: string): boolean {
  const trimmed = output.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function looksStructuredOrScientific(output: string): boolean {
  const lines = output.split('\n');
  const markdownHeadings = lines.filter((line) => /^#{1,6}\s+/.test(line)).length;
  const tableLines = lines.filter((line) => /^\s*\|.*\|\s*$/.test(line)).length;
  const codeFences = lines.filter((line) => /^```/.test(line.trim())).length;
  const listItems = lines.filter((line) => /^\s*[-*+]\s+/.test(line)).length;
  const chemistryOrOntology = /\b(ClassyFire|ChemOnt|Taxonomy Tree|Usage Tree|LCB Exposure Summary|Source method|Confidence)\b/.test(output);

  return (
    tableLines >= 2 ||
    codeFences >= 2 ||
    markdownHeadings >= 2 ||
    listItems >= 4 ||
    chemistryOrOntology
  );
}

function nextAvailableId(base: string, allIds: Set<string>): string {
  for (let index = 1; ; index += 1) {
    const candidate = `${base}-${index}`;
    if (!allIds.has(candidate)) return candidate;
  }
}

function buildGrammarReviewTask(
  step: DAGPlan['plan'][number],
  output: string,
): string {
  return [
    'Polish grammar, spelling, punctuation, and readability for the generated text below.',
    'Preserve technical meaning, Markdown structure, citations, code identifiers, URLs, and factual claims.',
    'Return only the corrected text with no commentary.',
    '',
    `Original step: ${step.id}`,
    `Original agent: ${step.agent}`,
    `Original task: ${step.task}`,
    '',
    'Generated text:',
    output,
  ].join('\n');
}
