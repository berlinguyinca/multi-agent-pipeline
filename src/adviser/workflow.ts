import type { AgentDefinition } from '../types/agent-definition.js';
import type { DAGPlan, DAGStep } from '../types/dag.js';

export interface AdviserWorkflowPayload {
  kind: 'adviser-workflow' | 'adviser-replan';
  refreshAgents?: boolean;
  plan: DAGStep[];
}

export interface AdviserReplanEvent {
  type: 'adviser-replan';
  fromStep: string;
  removedSteps: string[];
  insertedSteps: string[];
  refreshedAgents: boolean;
}

export interface ApplyAdviserWorkflowOptions {
  adviserStepId: string;
  workflow: AdviserWorkflowPayload;
  plan: DAGPlan;
  agents: Map<string, AgentDefinition>;
  completed: Set<string>;
  settled: Set<string>;
  running: Set<string>;
  allIds: Set<string>;
  refreshedAgents?: boolean;
}

export function parseAdviserWorkflow(output: string): AdviserWorkflowPayload | null {
  for (const candidate of sliceJsonObjects(output)) {
    try {
      const parsed = JSON.parse(candidate) as Partial<AdviserWorkflowPayload>;
      if (parsed.kind !== 'adviser-workflow' && parsed.kind !== 'adviser-replan') continue;
      if (!Array.isArray(parsed.plan)) continue;
      if (parsed.plan.some((step) => !isDAGStep(step))) continue;
      return {
        kind: parsed.kind,
        refreshAgents: parsed.refreshAgents === true,
        plan: parsed.plan,
      };
    } catch {
      continue;
    }
  }
  return null;
}

export function applyAdviserWorkflow(options: ApplyAdviserWorkflowOptions): AdviserReplanEvent {
  validateReplacementWorkflow(options.workflow.plan, options.completed, options.agents);

  const removedIds = new Set<string>();
  options.plan.plan = options.plan.plan.filter((step) => {
    if (options.settled.has(step.id) || options.running.has(step.id)) return true;
    removedIds.add(step.id);
    options.allIds.delete(step.id);
    return false;
  });

  for (const step of options.workflow.plan) {
    options.plan.plan.push({
      ...step,
      dependsOn: [...step.dependsOn],
      parentStepId: step.parentStepId ?? options.adviserStepId,
    });
    options.allIds.add(step.id);
  }

  for (const step of options.plan.plan) {
    if (options.settled.has(step.id) || removedIds.has(step.id)) continue;
    step.dependsOn = step.dependsOn.filter((dep) => !removedIds.has(dep));
  }

  return {
    type: 'adviser-replan',
    fromStep: options.adviserStepId,
    removedSteps: [...removedIds],
    insertedSteps: options.workflow.plan.map((step) => step.id),
    refreshedAgents: options.refreshedAgents === true,
  };
}

function isDAGStep(value: unknown): value is DAGStep {
  if (!value || typeof value !== 'object') return false;
  const step = value as Partial<DAGStep>;
  return (
    typeof step.id === 'string' &&
    step.id.trim().length > 0 &&
    typeof step.agent === 'string' &&
    step.agent.trim().length > 0 &&
    typeof step.task === 'string' &&
    step.task.trim().length > 0 &&
    Array.isArray(step.dependsOn) &&
    step.dependsOn.every((dep) => typeof dep === 'string' && dep.trim().length > 0)
  );
}

function validateReplacementWorkflow(
  replacementSteps: DAGStep[],
  completed: Set<string>,
  agents: Map<string, AgentDefinition>,
): void {
  const ids = new Set<string>();
  for (const step of replacementSteps) {
    if (ids.has(step.id)) {
      throw new Error(`Adviser workflow has duplicate step id: ${step.id}`);
    }
    ids.add(step.id);
    if (!agents.has(step.agent)) {
      throw new Error(`Adviser workflow referenced unknown agent: "${step.agent}"`);
    }
  }

  for (const step of replacementSteps) {
    for (const dep of step.dependsOn) {
      if (!ids.has(dep) && !completed.has(dep)) {
        throw new Error(`Adviser workflow step ${step.id} depends on unknown step: ${dep}`);
      }
    }
  }

  if (replacementHasCycle(replacementSteps)) {
    throw new Error('Adviser workflow has a cycle in dependencies');
  }
}

function replacementHasCycle(steps: DAGStep[]): boolean {
  const ids = new Set(steps.map((step) => step.id));
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const adjMap = new Map<string, string[]>();

  for (const step of steps) {
    adjMap.set(
      step.id,
      step.dependsOn.filter((dep) => ids.has(dep)),
    );
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

  for (const step of steps) {
    if (dfs(step.id)) return true;
  }
  return false;
}

function sliceJsonObjects(text: string): string[] {
  const starts: number[] = [];
  const candidates: string[] = [];
  for (let index = text.indexOf('{'); index !== -1; index = text.indexOf('{', index + 1)) {
    starts.push(index);
  }

  for (let i = starts.length - 1; i >= 0; i -= 1) {
    const start = starts[i]!;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let cursor = start; cursor < text.length; cursor += 1) {
      const char = text[cursor]!;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === '{') depth += 1;
      if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          candidates.push(text.slice(start, cursor + 1));
          break;
        }
      }
    }
  }

  return candidates;
}
