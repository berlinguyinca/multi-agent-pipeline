import type { AgentDefinition } from '../types/agent-definition.js';
import type { DAGPlan, StepResult } from '../types/dag.js';

export interface FactCheckOptions {
  step: DAGPlan['plan'][number];
  result: StepResult;
  plan: DAGPlan;
  allIds: Set<string>;
  agents: Map<string, AgentDefinition>;
  results: Map<string, StepResult>;
  settled: Set<string>;
}

const FACT_CHECKERS: Record<string, string> = {
  'usage-classification-tree': 'usage-classification-fact-checker',
  researcher: 'research-fact-checker',
};

export function maybeScheduleFactCheck(options: FactCheckOptions): void {
  const factChecker = FACT_CHECKERS[options.step.agent];
  if (!factChecker || !shouldFactCheck(options, factChecker)) return;

  const factCheckId = nextAvailableId(`${options.step.id}-fact-check`, options.allIds);
  const task = buildFactCheckTask(options.step, options.result.output ?? '');
  const factCheckStep = {
    id: factCheckId,
    agent: factChecker,
    task,
    dependsOn: [options.step.id],
    parentStepId: options.step.id,
  };

  const stepIndex = options.plan.plan.findIndex((candidate) => candidate.id === options.step.id);
  if (stepIndex === -1) {
    options.plan.plan.push(factCheckStep);
  } else {
    options.plan.plan.splice(stepIndex + 1, 0, factCheckStep);
  }
  options.allIds.add(factCheckId);

  for (const candidate of options.plan.plan) {
    if (
      candidate.id === options.step.id ||
      candidate.id === factCheckId ||
      options.settled.has(candidate.id)
    ) {
      continue;
    }
    if (!candidate.dependsOn.includes(options.step.id)) continue;
    candidate.dependsOn = replaceDependencyWithPair(candidate.dependsOn, options.step.id, factCheckId);
  }

  options.results.set(factCheckId, {
    id: factCheckId,
    agent: factChecker,
    task,
    dependsOn: [options.step.id],
    status: 'pending',
    parentStepId: options.step.id,
    edgeType: 'handoff',
    spawnedByAgent: options.step.agent,
  });
}

export function isFactCheckerAgent(agent: string): boolean {
  return Object.values(FACT_CHECKERS).includes(agent);
}

function shouldFactCheck(options: FactCheckOptions, factChecker: string): boolean {
  if (!options.agents.has(factChecker)) return false;
  if (options.step.agent === factChecker) return false;
  if (options.result.outputType !== 'answer' && options.result.outputType !== 'data') return false;
  return Boolean(options.result.output?.trim());
}

function replaceDependencyWithPair(dependsOn: string[], original: string, factCheckId: string): string[] {
  const next: string[] = [];
  for (const dep of dependsOn) {
    next.push(dep);
    if (dep === original && !dependsOn.includes(factCheckId)) {
      next.push(factCheckId);
    }
  }
  return [...new Set(next)];
}

function buildFactCheckTask(step: DAGPlan['plan'][number], output: string): string {
  return [
    `Fact-check the ${step.agent} report below using independent evidence and strict claim checking.`,
    'Use the verdict labels exactly: supported, rejected, or needs-review.',
    'Reject unsupported, contradicted, fabricated, or overconfident factual claims.',
    'Use needs-review for claims that are plausible but insufficiently supported.',
    'Return a concise verification report, not a rewritten version of the source report.',
    '',
    'Required output structure:',
    'Fact-check verdict: <supported | rejected | needs-review>',
    '',
    '| Claim | Verdict | Evidence/caveat |',
    '| --- | --- | --- |',
    '| <claim> | <supported | rejected | needs-review> | <short reason> |',
    '',
    `Original step: ${step.id}`,
    `Original agent: ${step.agent}`,
    `Original task: ${step.task}`,
    '',
    'Source report to verify:',
    output,
  ].join('\n');
}

function nextAvailableId(base: string, allIds: Set<string>): string {
  for (let index = 1; ; index += 1) {
    const candidate = `${base}-${index}`;
    if (!allIds.has(candidate)) return candidate;
  }
}
