import type { DAGPlan, StepResult } from '../types/dag.js';

export function selectFinalCompletedStep(plan: DAGPlan, steps: StepResult[]): StepResult | undefined {
  const terminalIds = getPreferredTerminalStepIds(plan);
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]!;
    if (terminalIds.size > 0 && !terminalIds.has(step.id)) continue;
    if (step.status === 'completed' && step.output?.trim()) return step;
  }
  return [...steps].reverse().find((step) => step.status === 'completed' && step.output?.trim());
}

export function getPreferredTerminalStepIds(plan: DAGPlan): Set<string> {
  const explicitFinalIds = plan.plan.filter((step) => step.final === true).map((step) => step.id);
  if (explicitFinalIds.length > 0) return new Set(explicitFinalIds);

  const ids = new Set(plan.plan.map((step) => step.id));
  const hasIncoming = new Set<string>();
  const hasOutgoing = new Set<string>();
  for (const step of plan.plan) {
    for (const dep of step.dependsOn) {
      if (ids.has(dep)) hasOutgoing.add(dep);
      if (ids.has(step.id)) hasIncoming.add(step.id);
    }
  }
  const sinks = [...ids].filter((id) => !hasOutgoing.has(id));
  const connectedSinks = sinks.filter((id) => hasIncoming.has(id));
  return new Set(connectedSinks.length > 0 ? connectedSinks : sinks);
}
