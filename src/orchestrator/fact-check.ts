import type { AgentDefinition } from '../types/agent-definition.js';
import type { VerboseReporter } from '../utils/verbose-reporter.js';
import type { DAGPlan, StepResult } from '../types/dag.js';

export interface FactCheckOptions {
  step: DAGPlan['plan'][number];
  result: StepResult;
  plan: DAGPlan;
  allIds: Set<string>;
  agents: Map<string, AgentDefinition>;
  results: Map<string, StepResult>;
  settled: Set<string>;
  reporter?: Pick<VerboseReporter, 'agentDecision'>;
}

const FACT_CHECKERS: Record<string, string[]> = {
  'usage-classification-tree': [
    'usage-classification-fact-checker',
    'evidence-source-reviewer',
    'commonness-evidence-reviewer',
  ],
  researcher: [
    'research-fact-checker',
    'evidence-source-reviewer',
    'commonness-evidence-reviewer',
  ],
};

export function maybeScheduleFactCheck(options: FactCheckOptions): void {
  const factCheckers = FACT_CHECKERS[options.step.agent] ?? [];
  if (factCheckers.length === 0) return;
  const decision = explainFactCheckDecision(options, factCheckers);
  if (!decision.shouldAdd) {
    options.reporter?.agentDecision?.({
      by: `${options.step.id} [${options.step.agent}]`,
      agent: factCheckers.join(','),
      decision: 'not-needed',
      reason: decision.reason,
    });
    return;
  }

  const scheduled = decision.factCheckers.map((factChecker, index) => {
    const factCheckId = nextAvailableId(`${options.step.id}-fact-check`, options.allIds);
    const task = buildFactCheckTask(options.step, options.result.output ?? '', factChecker, index + 1, decision.factCheckers.length);
    const factCheckStep = {
      id: factCheckId,
      agent: factChecker,
      task,
      dependsOn: [options.step.id],
      parentStepId: options.step.id,
    };
    options.allIds.add(factCheckId);
    return { factChecker, factCheckId, task, factCheckStep };
  });

  const stepIndex = options.plan.plan.findIndex((candidate) => candidate.id === options.step.id);
  if (stepIndex === -1) {
    options.plan.plan.push(...scheduled.map((entry) => entry.factCheckStep));
  } else {
    options.plan.plan.splice(stepIndex + 1, 0, ...scheduled.map((entry) => entry.factCheckStep));
  }

  for (const candidate of options.plan.plan) {
    if (
      candidate.id === options.step.id ||
      scheduled.some((entry) => entry.factCheckId === candidate.id) ||
      options.settled.has(candidate.id)
    ) {
      continue;
    }
    if (!candidate.dependsOn.includes(options.step.id)) continue;
    candidate.dependsOn = replaceDependencyWithFactChecks(
      candidate.dependsOn,
      options.step.id,
      scheduled.map((entry) => entry.factCheckId),
    );
  }

  for (const entry of scheduled) {
    options.results.set(entry.factCheckId, {
      id: entry.factCheckId,
      agent: entry.factChecker,
      task: entry.task,
      dependsOn: [options.step.id],
      status: 'pending',
      parentStepId: options.step.id,
      edgeType: 'handoff',
      spawnedByAgent: options.step.agent,
    });
    options.reporter?.agentDecision?.({
      by: `${options.step.id} [${options.step.agent}]`,
      agent: entry.factChecker,
      decision: 'added',
      stepId: entry.factCheckId,
      reason: decision.reason,
    });
  }
}

export function isFactCheckerAgent(agent: string): boolean {
  return Object.values(FACT_CHECKERS).some((agents) => agents.includes(agent));
}

function explainFactCheckDecision(
  options: FactCheckOptions,
  factCheckers: string[],
): { shouldAdd: boolean; reason: string; factCheckers: string[] } {
  const enabled = factCheckers.filter((factChecker) => options.agents.has(factChecker));
  if (enabled.length === 0) return { shouldAdd: false, reason: `${factCheckers.join(', ')} are not enabled`, factCheckers: [] };
  if (enabled.includes(options.step.agent)) return { shouldAdd: false, reason: 'step is already the fact-checker', factCheckers: [] };
  if (options.result.outputType !== 'answer' && options.result.outputType !== 'data') {
    return { shouldAdd: false, reason: `output type ${options.result.outputType ?? 'unknown'} is not fact-checkable`, factCheckers: [] };
  }
  if (options.result.evidenceGate?.checked && options.result.evidenceGate.passed && options.result.evidenceGate.findings.length === 0) {
    return { shouldAdd: false, reason: 'evidence gate passed cleanly', factCheckers: [] };
  }
  if (!options.result.output?.trim()) return { shouldAdd: false, reason: 'source step produced no output to verify', factCheckers: [] };
  const reasonSuffix = enabled.length >= 3
    ? ' with three independent verification agents'
    : ` with ${enabled.length} enabled verification agent(s); enable ${factCheckers.filter((agent) => !enabled.includes(agent)).join(', ')} for the full three-agent panel`;
  if (options.result.evidenceGate?.findings?.length) {
    return { shouldAdd: true, reason: `evidence findings require independent fact-check review${reasonSuffix}`, factCheckers: enabled };
  }
  return { shouldAdd: true, reason: `fact-critical answer needs independent verification${reasonSuffix}`, factCheckers: enabled };
}

function replaceDependencyWithFactChecks(dependsOn: string[], original: string, factCheckIds: string[]): string[] {
  const next: string[] = [];
  for (const dep of dependsOn) {
    next.push(dep);
    if (dep === original) {
      for (const factCheckId of factCheckIds) {
        if (!dependsOn.includes(factCheckId)) next.push(factCheckId);
      }
    }
  }
  return [...new Set(next)];
}

function buildFactCheckTask(
  step: DAGPlan['plan'][number],
  output: string,
  factChecker: string,
  panelIndex: number,
  panelSize: number,
): string {
  return [
    `Fact-check the ${step.agent} report below using independent evidence and strict claim checking.`,
    `Verification panel lane: ${panelIndex} of ${panelSize} (${factChecker}).`,
    panelInstruction(factChecker),
    'Treat web-search findings as leads, not ground truth. Verify claims against source records, publications, regulatory references, or independent evidence before accepting them.',
    'Use source evidence that is independent from the original report and, where possible, different from the other verification lanes.',
    'Use the verdict labels exactly: supported, rejected, or needs-review.',
    'Reject unsupported, contradicted, fabricated, or overconfident factual claims.',
    'Use needs-review for claims that are plausible but insufficiently supported.',
    'Return a concise verification report, not a rewritten version of the source report.',
    '',
    'Required output structure:',
    'Fact-check verdict: <supported | rejected | needs-review>',
    '',
    '| Claim | Verdict | Evidence | Caveat |',
    '| --- | --- | --- | --- |',
    '| <claim> | <supported | rejected | needs-review> | <supporting evidence or unavailable> | <short limitation or unavailable> |',
    '',
    `Original step: ${step.id}`,
    `Original agent: ${step.agent}`,
    `Original task: ${step.task}`,
    '',
    'Source report to verify:',
    output,
  ].join('\n');
}

function panelInstruction(factChecker: string): string {
  switch (factChecker) {
    case 'usage-classification-fact-checker':
      return 'Focus: usage/LCB category correctness, reported use cases, and whether usage evidence supports each row.';
    case 'research-fact-checker':
      return 'Focus: independent publication, regulatory, and general research corroboration from sources not merely copied from the original report.';
    case 'evidence-source-reviewer':
      return 'Focus: cited database/web/source records, record IDs, URLs, source diversity, and whether web-search findings were independently vetted.';
    case 'commonness-evidence-reviewer':
      return 'Focus: commonness scores, unavailable commonness decisions, prevalence/utilization/adoption/testing-frequency proxy evidence, and currentness.';
    default:
      return 'Focus: independent source verification and claim support.';
  }
}

function nextAvailableId(base: string, allIds: Set<string>): string {
  for (let index = 1; ; index += 1) {
    const candidate = `${base}-${index}`;
    if (!allIds.has(candidate)) return candidate;
  }
}
