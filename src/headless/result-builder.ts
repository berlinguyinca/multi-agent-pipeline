import type { DAGPlan, StepResult } from '../types/dag.js';
import type { HeadlessResultV2 } from '../types/headless.js';
import { buildDAGResult } from '../types/dag.js';

export function buildHeadlessResultV2(
  plan: DAGPlan,
  steps: StepResult[],
  duration: number,
  error?: string,
  artifacts: { outputDir?: string; markdownFiles?: string[] } = {},
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
  };
}
