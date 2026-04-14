// src/orchestrator/orchestrator.ts
import type { AgentAdapter, AdapterConfig } from '../types/adapter.js';
import type { AgentDefinition } from '../types/agent-definition.js';
import type { DAGPlan, StepResult, StepStatus } from '../types/dag.js';
import { getReadySteps } from '../types/dag.js';

export interface DAGExecutionResult {
  success: boolean;
  steps: StepResult[];
}

type AdapterFactory = (config: AdapterConfig) => AgentAdapter;

export async function executeDAG(
  plan: DAGPlan,
  agents: Map<string, AgentDefinition>,
  createAdapter: AdapterFactory,
): Promise<DAGExecutionResult> {
  const results = new Map<string, StepResult>();
  const completed = new Set<string>();
  const failed = new Set<string>();
  const running = new Set<string>();
  const allIds = new Set(plan.plan.map((s) => s.id));

  while (completed.size + failed.size < allIds.size) {
    // Mark steps whose dependencies failed as skipped
    for (const step of plan.plan) {
      if (completed.has(step.id) || failed.has(step.id) || running.has(step.id)) continue;
      const depFailed = step.dependsOn.some((dep) => failed.has(dep));
      if (depFailed) {
        const failedDeps = step.dependsOn.filter((dep) => failed.has(dep));
        results.set(step.id, {
          id: step.id,
          agent: step.agent,
          task: step.task,
          status: 'skipped',
          reason: `Dependency failed: ${failedDeps.join(', ')}`,
        });
        failed.add(step.id);
      }
    }

    const ready = getReadySteps(plan, completed).filter(
      (s) => !running.has(s.id) && !failed.has(s.id),
    );

    if (ready.length === 0 && running.size === 0) break;
    if (ready.length === 0) break;

    const executions = ready.map(async (step) => {
      running.add(step.id);
      const agent = agents.get(step.agent)!;
      const startedAt = Date.now();

      try {
        const context = buildStepContext(step.task, step.dependsOn, results);
        const adapter = createAdapter({
          type: agent.adapter,
          model: agent.model,
        });

        let output = '';
        for await (const chunk of adapter.run(context)) {
          output += chunk;
        }

        const result: StepResult = {
          id: step.id,
          agent: step.agent,
          task: step.task,
          status: 'completed',
          outputType: agent.output.type,
          output: output.trim(),
          duration: Date.now() - startedAt,
        };
        results.set(step.id, result);
        completed.add(step.id);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results.set(step.id, {
          id: step.id,
          agent: step.agent,
          task: step.task,
          status: 'failed',
          error: message,
          duration: Date.now() - startedAt,
        });
        failed.add(step.id);
      } finally {
        running.delete(step.id);
      }
    });

    await Promise.all(executions);
  }

  const stepResults = plan.plan.map(
    (step) =>
      results.get(step.id) ?? {
        id: step.id,
        agent: step.agent,
        task: step.task,
        status: 'pending' as StepStatus,
      },
  );

  return {
    success: failed.size === 0,
    steps: stepResults,
  };
}

function buildStepContext(
  task: string,
  dependsOn: string[],
  results: Map<string, StepResult>,
): string {
  let context = `Your task: ${task}`;

  if (dependsOn.length > 0) {
    const depOutputs = dependsOn
      .map((depId) => {
        const result = results.get(depId);
        if (!result || !result.output) return null;
        return `[${depId}: ${result.agent}]\n${result.output}`;
      })
      .filter(Boolean);

    if (depOutputs.length > 0) {
      context += `\n\n--- Context from previous steps ---\n\n${depOutputs.join('\n\n')}`;
    }
  }

  return context;
}
