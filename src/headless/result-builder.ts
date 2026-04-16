import type { DAGPlan, StepResult } from '../types/dag.js';
import type { ConsensusDiagnostics } from '../types/dag.js';
import type { HeadlessResultV2 } from '../types/headless.js';
import { buildDAGResult } from '../types/dag.js';

export function buildHeadlessResultV2(
  plan: DAGPlan,
  steps: StepResult[],
  duration: number,
  error?: string,
  artifacts: {
    outputDir?: string;
    markdownFiles?: string[];
    consensusDiagnostics?: ConsensusDiagnostics[];
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

  return {
    version: 2,
    success,
    outcome,
    dag,
    steps,
    outputDir: artifacts.outputDir ?? process.cwd(),
    markdownFiles: artifacts.markdownFiles ?? [],
    duration,
    error: error ?? null,
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
