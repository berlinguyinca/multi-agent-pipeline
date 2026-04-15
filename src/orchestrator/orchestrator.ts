// src/orchestrator/orchestrator.ts
import type { AgentAdapter, AdapterConfig } from '../types/adapter.js';
import type { AgentDefinition } from '../types/agent-definition.js';
import type { AdapterDefaultsMap } from '../types/config.js';
import type { DAGPlan, StepResult, StepStatus } from '../types/dag.js';
import { getReadySteps } from '../types/dag.js';
import { createToolRegistry } from '../tools/registry.js';
import { injectToolCatalog } from '../tools/inject.js';
import { runWithFailover } from '../adapters/failover-runner.js';
import type { VerboseReporter } from '../utils/verbose-reporter.js';
import { runSecurityGate } from '../security/gate.js';
import type { SecurityConfig } from '../security/types.js';
import { shouldGateStep } from '../security/should-gate.js';

export interface DAGExecutionResult {
  success: boolean;
  steps: StepResult[];
}

type AdapterFactory = (config: AdapterConfig) => AgentAdapter;

export interface DAGSecurityOptions {
  config: SecurityConfig;
  createReviewAdapter?: () => AgentAdapter;
}

export interface DAGRetryOptions {
  stepTimeoutMs?: number;
  maxStepRetries?: number;
  retryDelayMs?: number;
  adapterDefaults?: AdapterDefaultsMap;
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  const msg = err.message.toLowerCase();
  // Don't retry security failures, dependency failures, or cancellations
  if (msg.includes('security gate failed')) return false;
  if (msg.includes('dependency failed')) return false;
  if (msg.includes('execution cancelled')) return false;
  return true;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

export async function executeDAG(
  plan: DAGPlan,
  agents: Map<string, AgentDefinition>,
  createAdapter: AdapterFactory,
  reporter?: VerboseReporter,
  security?: DAGSecurityOptions,
  signal?: AbortSignal,
  onOutputChunk?: (stepId: string, chunk: string) => void,
  retry?: DAGRetryOptions,
): Promise<DAGExecutionResult> {
  const maxRetries = retry?.maxStepRetries ?? 0;
  const retryDelayMs = retry?.retryDelayMs ?? 3_000;
  const stepTimeoutMs = retry?.stepTimeoutMs ?? 0;
  const adapterDefaults = retry?.adapterDefaults;
  const results = new Map<string, StepResult>();
  const completed = new Set<string>();
  const failed = new Set<string>();
  const running = new Set<string>();
  const allIds = new Set(plan.plan.map((s) => s.id));
  const activeAdapters = new Set<AgentAdapter>();

  const abortActiveAdapters = () => {
    for (const adapter of activeAdapters) {
      adapter.cancel();
    }
  };

  signal?.addEventListener('abort', abortActiveAdapters);

  try {
    while (completed.size + failed.size < allIds.size) {
      if (signal?.aborted) {
        break;
      }

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
        if (signal?.aborted) {
          return;
        }

        running.add(step.id);
        const agent = agents.get(step.agent)!;
        const startedAt = Date.now();
        reporter?.dagStepStart(step.id, step.agent, step.task);

        let lastError: string | undefined;
        let attempts = 0;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (signal?.aborted) break;
          attempts = attempt + 1;

          if (attempt > 0) {
            reporter?.dagStepRetry(step.id, step.agent, attempt, lastError ?? 'unknown');
            await delay(retryDelayMs, signal);
            if (signal?.aborted) break;
          }

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

            // Per-step timeout: create a child AbortController that aborts
            // when either the parent signal fires or the step timeout elapses.
            const stepController = new AbortController();
            let stepTimer: ReturnType<typeof setTimeout> | undefined;
            const abortFromParent = () => stepController.abort();
            signal?.addEventListener('abort', abortFromParent, { once: true });
            if (stepTimeoutMs > 0) {
              stepTimer = setTimeout(() => stepController.abort(), stepTimeoutMs);
            }

            // Resolve thinking: agent-level > adapter-default > undefined
            const resolvedThink = agent.think ?? adapterDefaults?.[agent.adapter]?.think;

            let output: string;
            try {
              output = await runWithFailover(configs, createAdapter, async (adapter) => {
                activeAdapters.add(adapter);
                try {
                  let out = '';
                  for await (const chunk of adapter.run(
                    context,
                    {
                      signal: stepController.signal,
                      ...(resolvedThink !== undefined ? { think: resolvedThink, hideThinking: !resolvedThink } : {}),
                    },
                  )) {
                    out += chunk;
                    reporter?.onChunk(chunk.length);
                    onOutputChunk?.(step.id, chunk);
                  }

                  if (stepController.signal.aborted) {
                    throw new Error(
                      signal?.aborted ? 'Execution cancelled' : 'Step timed out',
                    );
                  }

                  return out.trim();
                } finally {
                  activeAdapters.delete(adapter);
                }
              });
            } finally {
              if (stepTimer !== undefined) clearTimeout(stepTimer);
              signal?.removeEventListener('abort', abortFromParent);
            }

            const duration = Date.now() - startedAt;
            const result: StepResult = {
              id: step.id,
              agent: step.agent,
              task: step.task,
              status: 'completed',
              outputType: agent.output.type,
              output,
              duration,
              attempts,
            };

            if (security && shouldGateStep(agent) && output) {
              reporter?.securityGateStart(step.id, step.agent);
              const securityStartedAt = Date.now();
              const securityResult = await runSecurityGate({
                content: output,
                agentName: step.agent,
                task: step.task,
                config: security.config,
                createReviewAdapter:
                  security.createReviewAdapter ??
                  (() =>
                    createAdapter({
                      type: security.config.adapter,
                      model: security.config.model,
                    })),
              });

              if (!securityResult.passed) {
                results.set(step.id, {
                  ...result,
                  status: 'failed',
                  securityPassed: false,
                  securityFindings: securityResult.findings,
                  error: `Security gate failed with ${securityResult.findings.length} finding${securityResult.findings.length === 1 ? '' : 's'}`,
                });
                failed.add(step.id);
                reporter?.securityGateFailed(step.id, securityResult.findings.length);
                return;
              }

              result.securityPassed = true;
              result.securityFindings = securityResult.findings;
              reporter?.securityGatePassed(step.id, Date.now() - securityStartedAt);
            }

            results.set(step.id, result);
            completed.add(step.id);
            reporter?.dagStepComplete(step.id, step.agent, duration);
            lastError = undefined;
            break; // Success — exit retry loop
          } catch (err: unknown) {
            lastError = err instanceof Error ? err.message : String(err);
            if (!isRetryable(err) || attempt >= maxRetries) {
              const duration = Date.now() - startedAt;
              results.set(step.id, {
                id: step.id,
                agent: step.agent,
                task: step.task,
                status: 'failed',
                error: lastError,
                duration,
                attempts,
              });
              failed.add(step.id);
              reporter?.dagStepFailed(step.id, step.agent, lastError);
              break; // Non-retryable or retries exhausted — exit retry loop
            }
          }
        }

        running.delete(step.id);
      });

      await Promise.all(executions);
    }
  } finally {
    signal?.removeEventListener('abort', abortActiveAdapters);
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
