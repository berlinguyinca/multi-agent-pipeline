import type { DAGPlan, StepResult } from '../types/dag.js';
import type { HeadlessResultV2 } from '../types/headless.js';
import { buildDAGResult } from '../types/dag.js';

export function buildHeadlessResultV2(
  plan: DAGPlan,
  steps: StepResult[],
  duration: number,
  error?: string,
): HeadlessResultV2 {
  const dag = buildDAGResult(steps, plan);
  const allCompleted = steps.length > 0 && steps.every((s) => s.status === 'completed');
  const success = error === undefined && allCompleted;

  return {
    version: 2,
    success,
    dag,
    steps,
    duration,
    error: error ?? null,
  };
}
