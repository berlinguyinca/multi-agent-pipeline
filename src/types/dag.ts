// src/types/dag.ts

export interface DAGStep {
  id: string;
  agent: string;
  task: string;
  dependsOn: string[];
}

export interface DAGPlan {
  plan: DAGStep[];
}

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface StepResult {
  id: string;
  agent: string;
  task: string;
  status: StepStatus;
  outputType?: 'answer' | 'data' | 'files';
  output?: string;
  filesCreated?: string[];
  pipeline?: Array<{ stage: string; status: string; duration: number }>;
  duration?: number;
  error?: string;
  reason?: string;
}

export interface DAGNode {
  id: string;
  agent: string;
  status: string;
  duration: number;
}

export interface DAGEdge {
  from: string;
  to: string;
}

export interface DAGResult {
  nodes: DAGNode[];
  edges: DAGEdge[];
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateDAGPlan(plan: DAGPlan): ValidationResult {
  if (plan.plan.length === 0) {
    return { valid: false, error: 'Plan is empty' };
  }

  const ids = new Set<string>();
  for (const step of plan.plan) {
    if (ids.has(step.id)) {
      return { valid: false, error: `Plan has duplicate step id: ${step.id}` };
    }
    ids.add(step.id);
  }

  for (const step of plan.plan) {
    for (const dep of step.dependsOn) {
      if (!ids.has(dep)) {
        return { valid: false, error: `Step ${step.id} depends on unknown step: ${dep}` };
      }
    }
  }

  if (hasCycle(plan)) {
    return { valid: false, error: 'Plan has a cycle in dependencies' };
  }

  return { valid: true };
}

function hasCycle(plan: DAGPlan): boolean {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const adjMap = new Map<string, string[]>();

  for (const step of plan.plan) {
    adjMap.set(step.id, step.dependsOn);
  }

  function dfs(id: string): boolean {
    if (inStack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    inStack.add(id);
    for (const dep of adjMap.get(id) ?? []) {
      if (dfs(dep)) return true;
    }
    inStack.delete(id);
    return false;
  }

  for (const step of plan.plan) {
    if (dfs(step.id)) return true;
  }
  return false;
}

export function topologicalSort(plan: DAGPlan): DAGStep[] {
  const inDegree = new Map<string, number>();
  const stepMap = new Map<string, DAGStep>();
  const dependents = new Map<string, string[]>();

  for (const step of plan.plan) {
    stepMap.set(step.id, step);
    inDegree.set(step.id, step.dependsOn.length);
    for (const dep of step.dependsOn) {
      const existing = dependents.get(dep) ?? [];
      existing.push(step.id);
      dependents.set(dep, existing);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: DAGStep[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(stepMap.get(id)!);
    for (const dep of dependents.get(id) ?? []) {
      const newDegree = (inDegree.get(dep) ?? 1) - 1;
      inDegree.set(dep, newDegree);
      if (newDegree === 0) queue.push(dep);
    }
  }

  return sorted;
}

export function getReadySteps(plan: DAGPlan, completed: Set<string>): DAGStep[] {
  // Compute the topological depth of each step (0 = no deps).
  const depth = new Map<string, number>();
  const stepMap = new Map<string, DAGStep>();
  for (const step of plan.plan) {
    stepMap.set(step.id, step);
  }

  function getDepth(id: string): number {
    if (depth.has(id)) return depth.get(id)!;
    const step = stepMap.get(id)!;
    if (step.dependsOn.length === 0) {
      depth.set(id, 0);
      return 0;
    }
    const d = 1 + Math.max(...step.dependsOn.map(getDepth));
    depth.set(id, d);
    return d;
  }
  for (const step of plan.plan) getDepth(step.id);

  // Find the lowest depth that still has incomplete steps.
  const incompleteDepths = plan.plan
    .filter((s) => !completed.has(s.id))
    .map((s) => depth.get(s.id)!);

  if (incompleteDepths.length === 0) return [];

  const targetDepth = Math.min(...incompleteDepths);

  // All steps at targetDepth must have their deps satisfied (they will
  // by definition since all lower depths are complete).
  // Ensure ALL steps at targetDepth - 1 are completed (wave boundary).
  if (targetDepth > 0) {
    const prevWave = plan.plan.filter((s) => depth.get(s.id) === targetDepth - 1);
    if (prevWave.some((s) => !completed.has(s.id))) return [];
  }

  // Check that the ENTIRE current wave (targetDepth) hasn't been partially started.
  // If some steps at targetDepth are already completed but others aren't, we are
  // mid-wave: return only those not yet completed.
  // However, if the current wave is mixed (some done, some not), that means we
  // advanced into this wave but not all peers finished — return nothing (mid-wave).
  const currentWave = plan.plan.filter((s) => depth.get(s.id) === targetDepth);
  const currentWaveDone = currentWave.filter((s) => completed.has(s.id));
  const currentWaveNotDone = currentWave.filter((s) => !completed.has(s.id));

  // If some in this wave are done and some are not, we're mid-wave → nothing ready.
  if (currentWaveDone.length > 0 && currentWaveNotDone.length > 0) return [];

  // All in this wave are not done (fresh wave) → return all.
  return currentWaveNotDone;
}

export function buildDAGResult(results: StepResult[], plan: DAGPlan): DAGResult {
  const resultMap = new Map(results.map((r) => [r.id, r]));

  const nodes: DAGNode[] = plan.plan.map((step) => {
    const result = resultMap.get(step.id);
    return {
      id: step.id,
      agent: step.agent,
      status: result?.status ?? 'pending',
      duration: result?.duration ?? 0,
    };
  });

  const edges: DAGEdge[] = [];
  for (const step of plan.plan) {
    for (const dep of step.dependsOn) {
      edges.push({ from: dep, to: step.id });
    }
  }

  return { nodes, edges };
}
