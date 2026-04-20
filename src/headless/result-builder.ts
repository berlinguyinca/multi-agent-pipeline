import type { DAGPlan, StepResult } from '../types/dag.js';
import type { ConsensusDiagnostics } from '../types/dag.js';
import type { HeadlessAgentComparison, HeadlessAgentContribution, HeadlessResultV2 } from '../types/headless.js';
import { buildDAGResult } from '../types/dag.js';
import { collectCrossReviewLedgers, summarizeCrossReviewLedgers } from '../orchestrator/cross-review.js';

export function buildHeadlessResultV2(
  plan: DAGPlan,
  steps: StepResult[],
  duration: number,
  error?: string,
  artifacts: {
    outputDir?: string;
    workspaceDir?: string;
    markdownFiles?: string[];
    consensusDiagnostics?: ConsensusDiagnostics[];
    rerun?: HeadlessResultV2['rerun'];
    routerRationale?: HeadlessResultV2['routerRationale'];
    agentDiscovery?: HeadlessResultV2['agentDiscovery'];
    agentComparisons?: HeadlessAgentComparison[];
    semanticJudge?: HeadlessResultV2['semanticJudge'];
    judgePanel?: HeadlessResultV2['judgePanel'];
  } = {},
): HeadlessResultV2 {
  const dag = buildDAGResult(steps, plan);
  const successfulStatuses = new Set(['completed', 'recovered']);
  const allCompleted =
    steps.length > 0 && steps.every((s) => successfulStatuses.has(s.status));
  const success = error === undefined && allCompleted;
  const outcome = error
    ? 'failed'
    : steps.some((step) => step.blockerKind)
      ? 'blocked'
      : success
        ? 'success'
        : 'failed';
  const agentContributions = buildAgentContributions(plan, steps, artifacts.rerun);
  const crossReviewLedgers = collectCrossReviewLedgers(steps);
  const crossReview = crossReviewLedgers.length > 0
    ? summarizeCrossReviewLedgers(crossReviewLedgers)
    : undefined;

  return {
    version: 2,
    success,
    outcome,
    dag,
    steps,
    outputDir: artifacts.outputDir ?? process.cwd(),
    ...(artifacts.workspaceDir ? { workspaceDir: artifacts.workspaceDir } : {}),
    markdownFiles: artifacts.markdownFiles ?? [],
    duration,
    error: error ?? null,
    ...(artifacts.rerun ? { rerun: artifacts.rerun } : {}),
    ...(agentContributions.length > 0 ? { agentContributions } : {}),
    ...(artifacts.routerRationale ? { routerRationale: artifacts.routerRationale } : {}),
    ...(artifacts.agentDiscovery && artifacts.agentDiscovery.length > 0 ? { agentDiscovery: artifacts.agentDiscovery } : {}),
    ...(artifacts.agentComparisons ? { agentComparisons: artifacts.agentComparisons } : {}),
    ...(artifacts.semanticJudge ? { semanticJudge: artifacts.semanticJudge } : {}),
    ...(artifacts.judgePanel ? { judgePanel: artifacts.judgePanel } : {}),
    ...(crossReview ? { crossReview } : {}),
    consensusDiagnostics: [
      ...(artifacts.consensusDiagnostics ?? []),
      ...steps
        .filter((step) => step.consensus?.participants && step.consensus.participants.length > 0)
        .map((step) => ({
          source: 'agent' as const,
          stepId: step.id,
          agent: step.agent,
          method: step.consensus!.method,
          runs: step.consensus!.runs,
          selectedRun: step.consensus!.selectedRun,
          agreement: step.consensus!.agreement,
          participants: step.consensus!.participants!,
        })),
    ],
  };
}

function buildAgentContributions(
  plan: DAGPlan,
  steps: StepResult[],
  rerun: HeadlessResultV2['rerun'],
): HeadlessAgentContribution[] {
  if (steps.length === 0) return [];
  const stepById = new Map(steps.map((step) => [step.id, step]));
  const dependents = new Map<string, string[]>();
  for (const planStep of plan.plan) {
    for (const dep of planStep.dependsOn) {
      const existing = dependents.get(dep) ?? [];
      existing.push(planStep.id);
      dependents.set(dep, existing);
    }
  }

  const grouped = new Map<string, StepResult[]>();
  for (const step of steps) {
    const existing = grouped.get(step.agent) ?? [];
    existing.push(step);
    grouped.set(step.agent, existing);
  }

  return [...grouped.entries()].map(([agent, agentSteps]) => {
    const completedSteps = agentSteps.filter((step) => step.status === 'completed').length;
    const failedSteps = agentSteps.filter((step) => step.status === 'failed').length;
    const recoveredSteps = agentSteps.filter((step) => step.status === 'recovered').length;
    const status: HeadlessAgentContribution['status'] = failedSteps > 0
      ? 'failed'
      : recoveredSteps > 0
        ? 'recovered'
        : completedSteps === agentSteps.length
          ? 'completed'
          : 'mixed';
    const tasks = uniqueStrings(agentSteps.map((step) => step.task).filter(Boolean));
    const downstream = uniqueStrings(
      agentSteps.flatMap((step) =>
        (dependents.get(step.id) ?? []).filter((id) => stepById.has(id)),
      ),
    );
    const benefits = [
      completedSteps + recoveredSteps > 0
        ? `Completed ${completedSteps + recoveredSteps}/${agentSteps.length} planned step${agentSteps.length === 1 ? '' : 's'}.`
        : '',
      downstream.length > 0
        ? `Prepared inputs for downstream step${downstream.length === 1 ? '' : 's'} (${downstream.join(', ')}).`
        : completedSteps + recoveredSteps > 0
          ? 'Contributed terminal output or validation evidence.'
          : '',
      agentSteps.some((step) => step.consensus?.participants?.length)
        ? 'Consensus diagnostics quantified agreement and rejected outliers.'
        : '',
      agentSteps.some((step) => step.handoffPassed === true)
        ? 'Handoff validation passed.'
        : '',
      agentSteps.some((step) => step.specConformance?.passed === true)
        ? 'Spec conformance passed.'
        : '',
      failedSteps > 0
        ? 'Network self-check should question this agent before reuse.'
        : '',
    ].filter(Boolean);
    const selfOptimizationReason = inferSelfOptimizationReason(agentSteps);
    return {
      agent,
      totalSteps: agentSteps.length,
      completedSteps,
      failedSteps,
      recoveredSteps,
      status,
      tasks,
      benefits: uniqueStrings(benefits),
      evidence: agentSteps.map((step) => `${step.id} ${step.status}`),
      ...(rerun?.command ? { disableCommand: `${rerun.command} --disable-agent ${agent}` } : {}),
      ...(selfOptimizationReason ? { selfOptimizationReason } : {}),
    };
  });
}

function inferSelfOptimizationReason(steps: StepResult[]): string | undefined {
  const failed = steps.filter((step) => step.status === 'failed');
  if (failed.length > 0) {
    const firstMessage = failed
      .map((step) => (step.error ?? step.reason ?? '').trim())
      .filter(Boolean)[0];
    return `failed ${failed.length}/${steps.length} step${steps.length === 1 ? '' : 's'}${firstMessage ? ` (${firstMessage})` : ''}`;
  }
  if (steps.some((step) => step.handoffPassed === false)) {
    return 'failed handoff validation';
  }
  if (steps.some((step) => step.specConformance?.checked === true && step.specConformance.passed === false)) {
    return 'missed reviewed spec criteria';
  }
  return undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
