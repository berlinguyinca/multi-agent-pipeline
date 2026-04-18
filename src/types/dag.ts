// src/types/dag.ts

import type { SecurityFinding } from '../security/types.js';
import type { ClaimEvidence, EvidenceGateResult } from './evidence.js';

export interface DAGStep {
  id: string;
  agent: string;
  task: string;
  dependsOn: string[];
  parentStepId?: string;
  final?: boolean;
}

export interface DAGPlan {
  plan: DAGStep[];
}

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type StepTerminalOutcome = 'success' | 'blocked' | 'failed' | 'cancelled';
export type DAGEdgeType = 'planned' | 'handoff' | 'recovery' | 'spawned';


export interface HandoffFinding {
  severity: 'high' | 'medium' | 'low';
  message: string;
  sourceStepId: string;
  targetStepId?: string;
}

export interface SpecConformance {
  checked: boolean;
  passed: boolean;
  missingCriteria: string[];
  notes: string[];
}

export interface ConsensusParticipant {
  run: number;
  provider?: string;
  model?: string;
  status: 'selected' | 'contributed' | 'valid' | 'rejected' | 'failed';
  contribution: number;
  detail?: string;
}

export interface ConsensusDiagnostics {
  source: 'router' | 'agent';
  stepId?: string;
  agent?: string;
  method: string;
  runs: number;
  selectedRun?: number;
  selectedModel?: string;
  agreement?: number;
  participants: ConsensusParticipant[];
}

export interface RouterAgentRationale {
  agent: string;
  reason: string;
}

export interface RouterRationale {
  selectedAgents: RouterAgentRationale[];
  rejectedAgents: RouterAgentRationale[];
}

export interface DAGNodeConsensus {
  enabled: boolean;
  runs: number;
  candidateCount: number;
  selectedRun: number;
  agreement: number;
  method: 'exact-majority' | 'medoid-token-similarity' | 'worktree-best-passing-diff';
  isolation?: 'git-worktree';
  verificationPassed?: boolean;
  changedFiles?: string[];
  participants?: ConsensusParticipant[];
}

export interface StepResult {
  id: string;
  agent: string;
  provider?: string;
  model?: string;
  task: string;
  dependsOn?: string[];
  status: StepStatus | 'recovered';
  outputType?: 'answer' | 'data' | 'files' | 'presentation';
  output?: string;
  filesCreated?: string[];
  pipeline?: Array<{ stage: string; status: string; duration: number }>;
  duration?: number;
  error?: string;
  reason?: string;
  securityFindings?: SecurityFinding[];
  securityPassed?: boolean;
  attempts?: number;
  parentStepId?: string;
  edgeType?: DAGEdgeType;
  spawnedByAgent?: string;
  failureKind?: 'test' | 'compile' | 'build' | 'lint' | 'tooling' | 'runtime' | 'timeout' | 'unknown';
  blockerKind?: 'credentials' | 'external-service' | 'user-decision' | 'repo-state' | 'no-progress' | 'unknown';
  replacementStepId?: string;
  handoffPassed?: boolean;
  handoffFindings?: HandoffFinding[];
  specConformance?: SpecConformance;
  evidenceClaims?: ClaimEvidence[];
  evidenceGate?: EvidenceGateResult;
  consensus?: DAGNodeConsensus;
}


export interface DAGNode {
  id: string;
  agent: string;
  provider?: string;
  model?: string;
  status: string;
  duration: number;
  final?: boolean;
  consensus?: DAGNodeConsensus;
}

export interface DAGEdge {
  from: string;
  to: string;
  type: DAGEdgeType;
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
  return plan.plan.filter(
    (step) =>
      !completed.has(step.id) &&
      step.dependsOn.every((dep) => completed.has(dep)),
  );
}

export function buildDAGResult(results: StepResult[], plan: DAGPlan): DAGResult {
  const resultMap = new Map(results.map((r) => [r.id, r]));

  const nodes: DAGNode[] = plan.plan.map((step) => {
    const result = resultMap.get(step.id);
    return {
      id: step.id,
      agent: step.agent,
      provider: result?.provider,
      model: result?.model,
      status: result?.status ?? 'pending',
      duration: result?.duration ?? 0,
      ...(step.final === true ? { final: true } : {}),
      ...(result?.consensus ? { consensus: result.consensus } : {}),
    };
  });

  const edges: DAGEdge[] = [];
  for (const step of plan.plan) {
    for (const dep of step.dependsOn) {
      edges.push({ from: dep, to: step.id, type: 'planned' });
    }
  }

  for (const result of results) {
    if (result.parentStepId && result.parentStepId !== result.id) {
      edges.push({
        from: result.parentStepId,
        to: result.id,
        type: result.edgeType ?? 'handoff',
      });
    }
    if (result.replacementStepId) {
      edges.push({
        from: result.id,
        to: result.replacementStepId,
        type: 'recovery',
      });
    }
  }

  return { nodes, edges };
}
