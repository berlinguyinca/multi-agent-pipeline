import type { AgentDefinition } from '../types/agent-definition.js';
import type { VerboseReporter } from '../utils/verbose-reporter.js';
import { isFactCheckerAgent } from './fact-check.js';
import type { DAGPlan, StepResult } from '../types/dag.js';

export interface GrammarReviewOptions {
  step: DAGPlan['plan'][number];
  result: StepResult;
  plan: DAGPlan;
  allIds: Set<string>;
  agents: Map<string, AgentDefinition>;
  results: Map<string, StepResult>;
  settled: Set<string>;
  reporter?: Pick<VerboseReporter, 'agentDecision'>;
}

const GRAMMAR_AGENT = 'grammar-spelling-specialist';

export function maybeScheduleGrammarReview(options: GrammarReviewOptions): void {
  const decision = explainGrammarReviewDecision(options.step, options.result, options.agents);
  if (!decision.shouldAdd) {
    if (decision.report) {
      options.reporter?.agentDecision?.({
        by: `${options.step.id} [${options.step.agent}]`,
        agent: GRAMMAR_AGENT,
        decision: 'not-needed',
        reason: decision.reason,
      });
    }
    return;
  }

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
    if (candidate.id === options.step.id || candidate.id === grammarId || isFactCheckerAgent(candidate.agent) || options.settled.has(candidate.id)) {
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
  options.reporter?.agentDecision?.({
    by: `${options.step.id} [${options.step.agent}]`,
    agent: GRAMMAR_AGENT,
    decision: 'added',
    stepId: grammarId,
    reason: decision.reason,
  });
}

function explainGrammarReviewDecision(
  step: DAGPlan['plan'][number],
  result: StepResult,
  agents: Map<string, AgentDefinition>,
): { shouldAdd: boolean; reason: string; report: boolean } {
  if (!agents.has(GRAMMAR_AGENT)) return { shouldAdd: false, reason: `${GRAMMAR_AGENT} is not enabled`, report: false };
  if (step.agent === GRAMMAR_AGENT) return { shouldAdd: false, reason: 'step is already the grammar reviewer', report: false };
  if (step.agent === 'adviser') return { shouldAdd: false, reason: 'adviser output is orchestration control data', report: false };
  if (step.agent === 'classyfire-taxonomy-classifier') return { shouldAdd: false, reason: 'taxonomy output is structured scientific data', report: true };
  if (step.agent === 'usage-classification-tree') return { shouldAdd: false, reason: 'usage classification output is structured scientific data', report: true };
  if (step.agent === 'output-formatter') return { shouldAdd: false, reason: 'formatter output is already terminal presentation', report: true };
  if (isFactCheckerAgent(step.agent)) return { shouldAdd: false, reason: 'fact-checker output should not be grammar-polished before validation', report: true };
  if (result.outputType !== 'answer' && result.outputType !== 'presentation') {
    return { shouldAdd: false, reason: `output type ${result.outputType ?? 'unknown'} is not prose`, report: false };
  }
  const output = result.output?.trim();
  if (!output) return { shouldAdd: false, reason: 'source step produced no output to polish', report: false };
  if (looksMachineReadable(output)) return { shouldAdd: false, reason: 'output is machine-readable data', report: true };
  if (looksStructuredOrScientific(output)) return { shouldAdd: false, reason: 'output is structured or scientific data', report: true };
  return { shouldAdd: true, reason: 'prose answer can benefit from grammar and readability review', report: true };
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
