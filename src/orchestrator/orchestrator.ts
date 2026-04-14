// src/orchestrator/orchestrator.ts
import type { AgentAdapter, AdapterConfig } from '../types/adapter.js';
import type { AgentDefinition } from '../types/agent-definition.js';
import type { DAGPlan, StepResult, StepStatus } from '../types/dag.js';
import { getReadySteps } from '../types/dag.js';
import { createToolRegistry } from '../tools/registry.js';
import { injectToolCatalog } from '../tools/inject.js';
import { runWithFailover } from '../adapters/failover-runner.js';
import type { VerboseReporter } from '../utils/verbose-reporter.js';

export interface DAGExecutionResult {
  success: boolean;
  steps: StepResult[];
}

type AdapterFactory = (config: AdapterConfig) => AgentAdapter;

export async function executeDAG(
  plan: DAGPlan,
  agents: Map<string, AgentDefinition>,
  createAdapter: AdapterFactory,
  reporter?: VerboseReporter,
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
        const reason = `Dependency failed: ${failedDeps.join(', ')}`;
        results.set(step.id, {
          id: step.id,
          agent: step.agent,
          task: step.task,
          status: 'skipped',
          reason,
        });
        failed.add(step.id);
        reporter?.dagStepSkipped(step.id, reason);
      }
    }

    const ready = getReadySteps(plan, completed).filter(
      (s) => !running.has(s.id) && !failed.has(s.id),
    );

    if (ready.length === 0) break;

    const executions = ready.map(async (step) => {
      running.add(step.id);
      const agent = agents.get(step.agent)!;
      const startedAt = Date.now();
      reporter?.dagStepStart(step.id, step.agent, step.task);

      try {
        const tools = createToolRegistry(agent, process.cwd());
        const rawContext = buildStepContext(step.task, step.dependsOn, results);
        const context = injectToolCatalog(rawContext, tools, agent.prompt);

        const configs: AdapterConfig[] = [
          { type: agent.adapter, model: agent.model },
          ...(agent.fallbacks ?? []).map((fb) => ({
            type: fb.adapter,
            model: fb.model,
          })),
        ];

        const output = await runWithFailover(configs, createAdapter, async (adapter) => {
          let out = '';
          for await (const chunk of adapter.run(context)) {
            out += chunk;
            reporter?.onChunk(chunk.length);
          }
          return out.trim();
        });

        const duration = Date.now() - startedAt;
        const result: StepResult = {
          id: step.id,
          agent: step.agent,
          task: step.task,
          status: 'completed',
          outputType: agent.output.type,
          output,
          duration,
        };
        results.set(step.id, result);
        completed.add(step.id);
        reporter?.dagStepComplete(step.id, step.agent, duration);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const duration = Date.now() - startedAt;
        results.set(step.id, {
          id: step.id,
          agent: step.agent,
          task: step.task,
          status: 'failed',
          error: message,
          duration,
        });
        failed.add(step.id);
        reporter?.dagStepFailed(step.id, step.agent, message);
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
